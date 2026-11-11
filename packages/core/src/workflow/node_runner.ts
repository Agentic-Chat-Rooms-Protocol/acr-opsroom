/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provenance: Lifted from `google/adk-js` (commit `8dad457`, v2.4.0)
 * `core/src/workflow/node_runner.ts`.
 * Extended with ACR Hyperfusion Extensions 1–5:
 * - Extension 1 & 4: `FencedStateCommitter` + `applyEventStateDelta` causal & generational fencing
 * - Extension 2: `executionAuthority` branch propagation
 * - Extension 3: Side-effecting timeout interception (`NodeOutcomeUnknownError`) & non-retry
 */

import { BaseNode } from './base_node.js';
import { createSubBranch } from './branch_path.js';
import {
  InvocationAbortedError,
  isDynamicNodeFailError,
  isInvocationAbortedError,
  isNodeInterruptedError,
  isNodeTimeoutError,
  NodeOutcomeUnknownError,
  NodeReportedError,
  NodeTimeoutError,
} from './errors.js';
import { NodeContext } from './node_context.js';
import { claimNodeErrorReport, isNodeErrorEvent } from './node_error_event.js';
import { createNodeState, NodeState } from './node_state.js';
import { NodeStatus } from './node_status.js';
import {
  applyEventStateDelta,
  createEvent,
  Event,
  ExecutionAuthorityLevel,
  InvocationContext,
  type NodeInvocationScope,
  recordNodeInvocation,
} from './shims.js';
import { getRetryDelaySeconds, shouldRetryNode } from './utils/retry_utils.js';

/**
 * Options controlling a single `ctx.runNode(...)` execution.
 */
export interface RunNodeOptions {
  /** Deterministic tracking name; defaults to `node.name`. */
  nodeName?: string;
  /** Unique id for this specific run. */
  runId?: string;
  /** If true, the child's output replaces the caller's output. */
  useAsOutput?: boolean;
  /** If true, run the child in an isolated sub-branch. */
  useSubBranch?: boolean;
  /** Explicit branch, overriding the default/sub-branch computation. */
  overrideBranch?: string;
  /** Explicit isolation scope, overriding inheritance from the parent. */
  overrideIsolationScope?: string;
  /** Explicit node path for the child. */
  overrideNodePath?: string;
  /** ACR Extension 2: Explicit execution authority override. */
  overrideExecutionAuthority?: ExecutionAuthorityLevel;
}

/** Parameters for {@link executeChildNode}. */
export interface ExecuteChildNodeParams {
  parent: NodeContext;
  node: BaseNode;
  input: unknown;
  options?: RunNodeOptions;
  abortSignal?: AbortSignal;
  nodeState?: NodeState;
  resumeInputs?: Record<string, unknown>;
}

/**
 * Executes a child node on behalf of `parent.runNode(...)`.
 */
export function executeChildNode(
  params: ExecuteChildNodeParams
): Promise<NodeContext> {
  const { parent, node, options = {} } = params;
  const nodeName = options.nodeName ?? node.name;
  const nodePath =
    options.overrideNodePath ??
    (parent.nodePath ? `${parent.nodePath}.${nodeName}` : nodeName);

  const scope = recordNodeInvocation({
    node,
    nodeName,
    sessionId: parent.invocationContext.session.id,
  });

  return scope.run(() => runChildNode({ params, nodeName, nodePath, scope }));
}

interface RunChildNodeParams {
  params: ExecuteChildNodeParams;
  nodeName: string;
  nodePath: string;
  scope: NodeInvocationScope;
}

async function runChildNode({
  params: {
    parent,
    node,
    input,
    options = {},
    abortSignal,
    nodeState: callerNodeState,
    resumeInputs,
  },
  nodeName,
  nodePath,
  scope,
}: RunChildNodeParams): Promise<NodeContext> {
  const runId = options.runId ?? nodeName;

  let branch = parent.branch;
  if (options.overrideBranch !== undefined) {
    branch = options.overrideBranch;
  } else if (options.useSubBranch) {
    branch = createSubBranch(parent.branch, {
      name: nodeName,
      runId: options.runId,
    });
  }

  const declaredScope =
    node.isolationScope === true ? `${nodePath}@${runId}` : node.isolationScope;
  const isolationScope =
    options.overrideIsolationScope ?? declaredScope ?? parent.isolationScope;

  const effectiveAbortSignal =
    abortSignal ?? parent.invocationContext.abortSignal;

  const effectiveAuthority =
    options.overrideExecutionAuthority ?? parent.executionAuthority;

  const childIc =
    branch === parent.invocationContext.branch &&
    effectiveAbortSignal === parent.invocationContext.abortSignal &&
    isolationScope === parent.invocationContext.isolationScope &&
    effectiveAuthority === parent.invocationContext.executionAuthority
      ? parent.invocationContext
      : parent.invocationContext.clone({
          branch,
          abortSignal: effectiveAbortSignal,
          isolationScope,
          executionAuthority: effectiveAuthority,
        });

  const child = new NodeContext({
    invocationContext: childIc,
    channel: parent.channel,
    nodePath,
    runId,
    workflowId: parent.workflowId,
    graphTopologyHash: parent.graphTopologyHash,
    executionAuthority: effectiveAuthority,
    resumeInputs: resumeInputs ?? parent.resumeInputs,
    isolationScope,
    stateSchema: node.stateSchema ?? parent.stateSchema,
  });
  child.scheduler = parent.scheduler;

  if (options.useAsOutput) {
    child.outputForAncestors = [
      parent.nodePath,
      ...parent.outputForAncestors,
    ].filter((path) => path !== '');
  }

  const nodeState =
    callerNodeState ??
    createNodeState({
      status: NodeStatus.RUNNING,
      input,
      runId,
    });

  const pluginManager = child.invocationContext.pluginManager;

  try {
    if (pluginManager?.hasPlugins) {
      const skipOutput = await pluginManager.runBeforeNodeCallback({
        node,
        nodeContext: child,
        input,
      });
      if (skipOutput !== undefined) {
        child.output = skipOutput;
        if (options.useAsOutput) {
          parent.output = child.output;
          parent.route = child.route;
        }
        return child;
      }
    }

    let succeeded = false;
    let inputRecorded = false;
    while (!succeeded) {
      resetState(child);
      child.attemptCount = nodeState.attemptCount;
      try {
        inputRecorded = await runOnce({
          node,
          child,
          input,
          nodeName,
          branch,
          isolationScope,
          scope,
        });
        failIfNodeReportedError(child, nodeName);
        succeeded = true;
      } catch (err) {
        if (child.sideEffectDispatched) {
          nodeState.sideEffectDispatched = true;
        }

        if (isNodeInterruptedError(err)) {
          succeeded = true;
          break;
        }
        if (isInvocationAbortedError(err) || isDynamicNodeFailError(err)) {
          throw err;
        }

        // ACR Extension 3: If a side-effecting node times out after dispatching
        // an external side effect, convert to NodeOutcomeUnknownError and never retry.
        if (
          isNodeTimeoutError(err) &&
          (node.sideEffecting || nodeState.sideEffectDispatched === true)
        ) {
          throw new NodeOutcomeUnknownError({
            nodeName,
            commandId: `${child.workflowId}:${child.nodePath}:${child.runId}`,
            idempotencyKey: `${child.workflowId}:${child.nodePath}:${child.runId}`,
            reason: err.message,
          });
        }

        const retryConfig = node.preparedRetryConfig;
        if (
          !retryConfig ||
          !shouldRetryNode({
            error: err,
            retryConfig,
            nodeState,
            sideEffecting: node.sideEffecting,
          })
        ) {
          throw err;
        }
        const delaySeconds = getRetryDelaySeconds({ retryConfig, nodeState });
        nodeState.attemptCount += 1;
        await delay(delaySeconds * 1000, effectiveAbortSignal);
      }
    }

    if (!inputRecorded && child.interruptIds.length > 0) {
      recordInputForResume({ child, nodeName, branch, isolationScope, input });
    }

    if (pluginManager?.hasPlugins) {
      const replacedOutput = await pluginManager.runAfterNodeCallback({
        node,
        nodeContext: child,
        output: child.output,
      });
      if (replacedOutput !== undefined) {
        child.output = replacedOutput;
      }
    }

    if (options.useAsOutput) {
      parent.output = child.output;
      parent.route = child.route;
      parent.outputDelegated = true;
      parent.executionAuthority = child.executionAuthority;
    }

    return child;
  } catch (err) {
    scope.end(err);
    throw err;
  } finally {
    scope.end();
  }
}

function failIfNodeReportedError(child: NodeContext, nodeName: string): void {
  const reported = child.reportedError;
  if (
    !reported ||
    child.output !== undefined ||
    child.route !== undefined ||
    child.interruptIds.length > 0
  ) {
    return;
  }
  const error = new NodeReportedError({ nodeName, ...reported });
  claimNodeErrorReport(error, child.invocationId);
  throw error;
}

function resetState(childNodeContext: NodeContext): void {
  childNodeContext.output = undefined;
  childNodeContext.route = undefined;
  childNodeContext.interruptIds = [];
  childNodeContext.reportedError = undefined;
  for (const key of Object.keys(childNodeContext.actions.stateDelta)) {
    delete childNodeContext.actions.stateDelta[key];
  }
}

interface RunOnceParams {
  node: BaseNode;
  child: NodeContext;
  input: unknown;
  nodeName: string;
  branch: string | undefined;
  isolationScope: string | undefined;
  scope: NodeInvocationScope;
}

async function runOnce({
  node,
  child,
  input,
  nodeName,
  branch,
  isolationScope,
  scope,
}: RunOnceParams): Promise<boolean> {
  let inputRecorded = false;
  let committedStateDelta = false;
  const committer = child.invocationContext.fencedCommitter;

  const consume = async (event: Event): Promise<void> => {
    enrichEvent({ event, child, nodeName, branch, isolationScope });
    const emittedDelta = event.actions?.stateDelta;
    if (emittedDelta && emittedDelta !== child.actions.stateDelta) {
      child.state.validateDelta(emittedDelta);
    }
    if (emittedDelta && Object.keys(emittedDelta).length > 0) {
      if (committer) {
        await committer.commitMutation({
          resourceUri: committer.resourceUri,
          ownerDid: committer.ownerDid,
          ownershipGeneration: committer.ownershipGeneration,
          fencingToken: committer.fencingToken,
          delta: emittedDelta,
          nodeName,
        });
        committedStateDelta = true;
      }
      applyEventStateDelta(child.invocationContext.session.state, emittedDelta);
    }

    if (event.output !== undefined) {
      child.output = event.output;
      if (child.outputDelegated) {
        const stateDelta = event.actions?.stateDelta;
        if (!stateDelta || Object.keys(stateDelta).length === 0) {
          return;
        }
        event.output = undefined;
        event.content = undefined;
      }
    }
    if (event.route !== undefined) {
      child.route = event.route;
    }
    if (event.errorCode !== undefined && !isNodeErrorEvent(event)) {
      child.reportedError = {
        errorCode: event.errorCode,
        errorMessage: event.errorMessage,
      };
    }
    if (event.longRunningToolIds && event.longRunningToolIds.length > 0) {
      for (const id of event.longRunningToolIds) {
        if (!child.interruptIds.includes(id)) {
          child.interruptIds.push(id);
        }
      }
      event.actions.agentState = {
        ...(event.actions.agentState ?? {}),
        input,
        executionAuthority: child.executionAuthority,
      };
      inputRecorded = true;
    }
    scope.recordEvent(event);
    if (event.partial) {
      child.channel.push(event);
    } else {
      await child.channel.pushAndWait(event);
    }
  };

  const parentSignal = child.invocationContext.abortSignal;
  const hasTimeout = typeof node.timeout === 'number' && node.timeout > 0;

  if (!hasTimeout && !parentSignal) {
    for await (const event of node.run(child, input)) {
      await consume(event);
    }
  } else if (!hasTimeout) {
    child.abortSignal = parentSignal;
    try {
      for await (const event of node.run(child, input)) {
        await consume(event);
      }
    } finally {
      child.abortSignal = undefined;
    }
  } else {
    const timeoutSeconds = node.timeout;
    const controller = new AbortController();
    const onParentAbort = () => controller.abort();
    if (parentSignal?.aborted) {
      controller.abort();
    } else {
      parentSignal?.addEventListener('abort', onParentAbort, { once: true });
    }
    let deadlineFired = false;
    const timer = setTimeout(
      () => {
        deadlineFired = true;
        controller.abort();
      },
      (timeoutSeconds ?? 0) * 1000
    );
    child.abortSignal = controller.signal;

    const aborted = new Promise<never>((_, reject) => {
      const fail = () =>
        reject(
          deadlineFired
            ? new NodeTimeoutError({ nodeName, timeout: timeoutSeconds ?? 0 })
            : new InvocationAbortedError(
                `Invocation aborted while running node '${nodeName}'.`
              )
        );
      if (controller.signal.aborted) {
        fail();
      } else {
        controller.signal.addEventListener('abort', fail, { once: true });
      }
    });

    const iterator = node.run(child, input)[Symbol.asyncIterator]();
    try {
      let result = await Promise.race([iterator.next(), aborted]);
      while (!result.done) {
        await Promise.race([consume(result.value), aborted]);
        result = await Promise.race([iterator.next(), aborted]);
      }
    } finally {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onParentAbort);
      child.abortSignal = undefined;
      void Promise.resolve(iterator.return?.(undefined)).catch(() => {});
    }
  }

  // If the node wrote to ctx.state directly without emitting an event that drained it,
  // validate generational fence on any remaining delta.
  if (
    committer &&
    !committedStateDelta &&
    Object.keys(child.actions.stateDelta).length > 0
  ) {
    await committer.commitMutation({
      resourceUri: committer.resourceUri,
      ownerDid: committer.ownerDid,
      ownershipGeneration: committer.ownershipGeneration,
      fencingToken: committer.fencingToken,
      delta: child.actions.stateDelta,
      nodeName,
    });
  }

  return inputRecorded;
}

interface RecordInputForResumeParams {
  child: NodeContext;
  nodeName: string;
  branch: string | undefined;
  isolationScope: string | undefined;
  input: unknown;
}

function recordInputForResume({
  child,
  nodeName,
  branch,
  isolationScope,
  input,
}: RecordInputForResumeParams): void {
  const event = createEvent({
    author: nodeName,
    invocationId: child.invocationId,
    branch,
    longRunningToolIds: [...child.interruptIds],
    actions: {
      agentState: {
        input,
        executionAuthority: child.executionAuthority,
      },
    },
  });
  enrichEvent({ event, child, nodeName, branch, isolationScope });
  child.channel.push(event);
}

interface EnrichEventParams {
  event: Event;
  child: NodeContext;
  nodeName: string;
  branch: string | undefined;
  isolationScope: string | undefined;
}

function enrichEvent({
  event,
  child,
  nodeName,
  branch,
  isolationScope,
}: EnrichEventParams): void {
  if (!event.author) {
    event.author = nodeName;
  }
  if (!event.invocationId) {
    event.invocationId = child.invocationId;
  }
  event.nodeInfo = { ...(event.nodeInfo ?? {}), path: child.nodePath };
  if (event.output !== undefined) {
    event.nodeInfo.outputFor = [child.nodePath, ...child.outputForAncestors];
  }
  if (branch !== undefined && event.branch === undefined) {
    event.branch = branch;
  }
  if (isolationScope !== undefined && event.isolationScope === undefined) {
    event.isolationScope = isolationScope;
  }
  if (event.actions) {
    event.actions.agentState = {
      ...(event.actions.agentState ?? {}),
      executionAuthority: child.executionAuthority,
    };
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new InvocationAbortedError('Invocation aborted during retry.'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new InvocationAbortedError('Invocation aborted during retry.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
