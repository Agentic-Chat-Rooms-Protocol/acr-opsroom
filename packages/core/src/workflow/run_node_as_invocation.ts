/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provenance: Lifted from `google/adk-js` (commit `8dad457`, v2.4.0)
 * `core/src/workflow/run_node_as_invocation.ts`.
 * Extended with `executeWorkflow` convenience runner.
 */

import { CryptographicAuditLedger } from '../audit-ledger.js';
import { buildAbortEvents } from './abort_events.js';
import { AsyncQueue } from './async_queue.js';
import { BaseNode, toContent } from './base_node.js';
import { isInvocationAbortedError } from './errors.js';
import type { RouteValue, RunnableNode } from './graph.js';
import { NodeContext } from './node_context.js';
import { BasePlugin } from './plugins/base_plugin.js';
import { PluginManager } from './plugins/plugin_manager.js';
import {
  Content,
  createEvent,
  createInvocationContext,
  createWorkflowSession,
  Event,
  ExecutionAuthorityLevel,
  FencedStateCommitter,
  InvocationContext,
  PluginManagerShim,
  WorkflowSession,
} from './shims.js';
import {
  eventsForCurrentRun,
  reconstructNodeStates,
} from './utils/rehydration_utils.js';
import { buildNode, isNodeLike } from './utils/workflow_graph_utils.js';
import { isWorkflow, Workflow } from './workflow.js';

export type RunnableRoot = BaseNode | Workflow;

export interface RunNodeAsInvocationOptions {
  author?: string;
}

/**
 * Runs a node as a whole invocation, turning it into a stream of events.
 */
export async function* runNodeAsInvocation(
  node: BaseNode,
  ic: InvocationContext,
  options: RunNodeAsInvocationOptions = {}
): AsyncGenerator<Event, void, void> {
  const author = options.author ?? node.name;
  const channel = new AsyncQueue<Event>();
  const activeIc = ic.eventQueue ? ic : ic.clone({ eventQueue: channel });

  if (
    activeIc.pluginManager?.hasPlugins &&
    activeIc.pluginManager.runBeforeRunCallback
  ) {
    await activeIc.pluginManager.runBeforeRunCallback({
      invocationContext: activeIc,
    });
  }

  const root = new NodeContext({
    invocationContext: activeIc,
    channel,
    nodePath: '',
    runId: author,
    workflowId: node.name,
    graphTopologyHash: isWorkflow(node) ? node.topologyHash : '',
    executionAuthority: activeIc.executionAuthority,
    resumeInputs: resumeInputsFromPlainText(activeIc),
  });

  const input = extractNodeInput(activeIc.userContent);

  let interrupted = false;
  let caughtAbort = false;
  const settle = (async () => {
    try {
      const nodeCtx = await root.runNode(node, input, { useAsOutput: true });
      interrupted = nodeCtx.interruptIds.length > 0;
      channel.close();
    } catch (err) {
      if (isInvocationAbortedError(err) || activeIc.abortSignal?.aborted) {
        caughtAbort = true;
        channel.close();
        return;
      }
      channel.fail(err);
    }
  })();

  let lastOutput: unknown;
  let sawOutput = false;

  try {
    for await (const rawEvent of channel) {
      let event = rawEvent;
      if (
        activeIc.pluginManager?.hasPlugins &&
        activeIc.pluginManager.runOnEventCallback
      ) {
        const modified = await activeIc.pluginManager.runOnEventCallback({
          invocationContext: activeIc,
          event,
        });
        if (modified !== undefined) {
          event = modified;
        }
      }
      if (event.output !== undefined) {
        lastOutput = event.output;
        sawOutput = true;
      }
      if (activeIc.session?.events) {
        activeIc.session.events.push(event);
      }
      yield event;
    }
    await settle;
  } finally {
    channel.close();
    await settle;
  }

  if (caughtAbort || activeIc.abortSignal?.aborted) {
    for (const abortEvent of buildAbortEvents(activeIc)) {
      if (activeIc.session?.events) {
        activeIc.session.events.push(abortEvent);
      }
      yield abortEvent;
    }
    return;
  }

  const alreadyLast = sawOutput && Object.is(lastOutput, root.output);
  if (!interrupted && root.output !== undefined && !alreadyLast) {
    const finalEvent = createEvent({
      author,
      invocationId: activeIc.invocationId,
      branch: activeIc.branch,
      content: toContent(root.output),
      output: root.output,
    });
    if (activeIc.session?.events) {
      activeIc.session.events.push(finalEvent);
    }
    yield finalEvent;
  }
}

export interface ExecuteWorkflowOptions {
  session?: WorkflowSession;
  invocationId?: string;
  abortSignal?: AbortSignal;
  executionAuthority?: ExecutionAuthorityLevel;
  fencedCommitter?: FencedStateCommitter;
  auditLedger?: CryptographicAuditLedger;
  pluginManager?: PluginManagerShim;
  plugins?: BasePlugin[];
  /**
   * Optional interrupt replies `{ [interruptId]: value }` to append as a user
   * FunctionResponse turn before running/resuming the workflow.
   */
  interruptResponses?: Record<string, unknown>;
  /**
   * Optional plain-text resume reply.
   */
  plainTextResume?: string;
}

export interface ExecuteWorkflowResult<TOutput = unknown> {
  output?: TOutput;
  route?: RouteValue | RouteValue[];
  events: Event[];
  interruptIds: string[];
  paused: boolean;
  session: WorkflowSession;
  executionAuthority: ExecutionAuthorityLevel;
}

/**
 * Convenience helper to run or resume a {@link BaseNode} / {@link Workflow} to
 * completion (or pause) and collect its output, emitted events, and pending
 * interrupt IDs.
 */
export async function executeWorkflow<TOutput = unknown>(
  node: BaseNode,
  input?: unknown,
  options: ExecuteWorkflowOptions = {}
): Promise<ExecuteWorkflowResult<TOutput>> {
  const session = options.session ?? createWorkflowSession();

  let userContent: Content | undefined;
  if (
    options.interruptResponses &&
    Object.keys(options.interruptResponses).length > 0
  ) {
    const parts = Object.entries(options.interruptResponses).map(
      ([interruptId, response]) => ({
        functionResponse: {
          id: interruptId,
          name: 'adk_request_input',
          response:
            typeof response === 'object' &&
            response !== null &&
            !Array.isArray(response)
              ? (response as Record<string, unknown>)
              : { result: response },
        },
      })
    );
    userContent = { role: 'user', parts };
    session.events.push(
      createEvent({
        author: 'user',
        invocationId: options.invocationId ?? `inv-resume-${Date.now()}`,
        content: userContent,
      })
    );
  } else if (options.plainTextResume !== undefined) {
    userContent = {
      role: 'user',
      parts: [{ text: options.plainTextResume }],
    };
  } else if (input !== undefined) {
    userContent = toContent(input);
  }

  const pluginManager =
    options.pluginManager ??
    (options.plugins ? new PluginManager(options.plugins) : undefined);

  const channel = new AsyncQueue<Event>();
  const ic = createInvocationContext({
    invocationId: options.invocationId,
    session,
    abortSignal: options.abortSignal,
    userContent,
    pluginManager,
    eventQueue: channel,
    executionAuthority: options.executionAuthority,
    fencedCommitter: options.fencedCommitter,
    auditLedger: options.auditLedger,
  });

  if (pluginManager?.hasPlugins && pluginManager.runBeforeRunCallback) {
    await pluginManager.runBeforeRunCallback({ invocationContext: ic });
  }

  const root = new NodeContext({
    invocationContext: ic,
    channel,
    nodePath: '',
    runId: node.name,
    workflowId: node.name,
    graphTopologyHash: isWorkflow(node) ? node.topologyHash : '',
    executionAuthority: ic.executionAuthority,
    resumeInputs: resumeInputsFromPlainText(ic),
  });

  const events: Event[] = [];
  let childResult:
    | NodeContext
    | {
        output: unknown;
        route?: RouteValue | RouteValue[];
        interruptIds: string[];
        executionAuthority?: ExecutionAuthorityLevel;
      }
    | undefined;

  let caughtAbort = false;
  const settle = (async () => {
    try {
      childResult = await root.runNode(node, input, { useAsOutput: true });
      channel.close();
    } catch (err) {
      if (isInvocationAbortedError(err) || ic.abortSignal?.aborted) {
        caughtAbort = true;
        channel.close();
        return;
      }
      channel.fail(err);
    }
  })();

  try {
    for await (const rawEvent of channel) {
      let event = rawEvent;
      if (pluginManager?.hasPlugins && pluginManager.runOnEventCallback) {
        const modified = await pluginManager.runOnEventCallback({
          invocationContext: ic,
          event,
        });
        if (modified !== undefined) {
          event = modified;
        }
      }
      events.push(event);
      session.events.push(event);
    }
    await settle;
  } finally {
    channel.close();
    await settle;
  }

  if (caughtAbort || ic.abortSignal?.aborted) {
    for (const abortEvent of buildAbortEvents(ic)) {
      events.push(abortEvent);
      session.events.push(abortEvent);
    }
  }

  const interruptIds = childResult?.interruptIds ?? [];
  return {
    output: (childResult?.output ?? root.output) as TOutput | undefined,
    route: childResult?.route ?? root.route,
    events,
    interruptIds,
    paused: interruptIds.length > 0,
    session,
    executionAuthority:
      childResult?.executionAuthority ?? root.executionAuthority,
  };
}

function resumeInputsFromPlainText(
  ic: InvocationContext
): Record<string, unknown> {
  const parts = ic.userContent?.parts ?? [];
  const isPlainText =
    parts.length > 0 && parts.every((p) => typeof p.text === 'string');
  if (!isPlainText) {
    return {};
  }
  const text = parts.map((p) => p.text).join('');

  const pending = new Set<string>();
  const events = eventsForCurrentRun(ic.session?.events ?? [], ic.invocationId);
  for (const nodeState of reconstructNodeStates(events).values()) {
    for (const id of nodeState.interruptIds) {
      if (!nodeState.resolvedResponses.has(id)) {
        pending.add(id);
      }
    }
  }

  if (pending.size !== 1) {
    return {};
  }
  const [id] = pending;
  return { [id]: text };
}

function extractNodeInput(content?: Content): unknown {
  if (!content) {
    return undefined;
  }
  const parts = content.parts ?? [];
  const textParts = parts.filter((p) => typeof p.text === 'string');
  if (textParts.length > 0) {
    return textParts.map((p) => p.text).join('');
  }
  return content;
}

export function isRunnableRoot(value: unknown): value is RunnableRoot {
  return isWorkflow(value);
}

export function asRunnableRoot(root: RunnableNode): RunnableRoot {
  if (isRunnableRoot(root)) {
    return root;
  }
  const value: unknown = root;
  if (!isNodeLike(value) || value === 'START') {
    const described =
      value === 'START'
        ? "the 'START' sentinel"
        : ((value as { constructor?: { name?: string } })?.constructor?.name ??
          typeof value);
    throw new TypeError(
      `Cannot use ${described} as a root: expected a Workflow ` +
        'or a node-like value (a node, a tool, or a function).'
    );
  }
  const built = buildNode(value);
  return new Workflow({
    name: built.name,
    description: built.description,
    edges: [['START', built]],
  });
}
