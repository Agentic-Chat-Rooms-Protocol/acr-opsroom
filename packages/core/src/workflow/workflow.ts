/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provenance: Lifted from `google/adk-js` (commit `8dad457`, v2.4.0)
 * `core/src/workflow/workflow.ts`.
 * Extended with ACR Hyperfusion Extensions 1–5:
 * - Extension 2: Branch-scoped `executionAuthority` propagation & JoinNode authority intersection
 * - Extension 3: `NodeOutcomeUnknownError` interception and `'__OUTCOME_UNKNOWN__'` edge routing
 * - Extension 5: `topologyHash` propagation to `NodeContext` and `verifySessionAuditIntegrity`
 */

import { BaseNode, BaseNodeConfig } from './base_node.js';
import { commonPrefixOf } from './branch_path.js';
import { DynamicNodeScheduler } from './dynamic_node_scheduler.js';
import {
  isInvocationAbortedError,
  isNodeOutcomeUnknownError,
} from './errors.js';
import {
  createGraphFromEdgeItems,
  EdgeItem,
  Graph,
  OUTCOME_UNKNOWN_ROUTE,
  RouteValue,
} from './graph.js';
import { NodeContext, NodeResult } from './node_context.js';
import {
  claimNodeErrorReport,
  createNodeErrorEvent,
} from './node_error_event.js';
import { executeChildNode } from './node_runner.js';
import { createNodeState, NodeState } from './node_state.js';
import { NodeStatus } from './node_status.js';
import { DynamicNodeState } from './schedule_dynamic_node.js';
import {
  Event,
  ExecutionAuthorityLevel,
  intersectExecutionAuthorities,
  recordWorkflowInvocation,
} from './shims.js';
import { Trigger } from './trigger.js';
import {
  eventsForCurrentRun,
  isFastForwardable,
  makeFastForwardResult,
  reconstructNodeRuns,
  RehydratedNode,
  resolvedInterruptResponses,
  verifySessionAuditIntegrity,
} from './utils/rehydration_utils.js';

const WORKFLOW_SIGNATURE_SYMBOL = Symbol.for('google.adk.workflow.workflow');

export type DynamicEntry = (
  ctx: NodeContext,
  input: unknown
) => unknown | Promise<unknown>;

export type WorkflowConfig = BaseNodeConfig & {
  /**
   * Maximum number of graph-scheduled nodes running in parallel.
   */
  maxConcurrency?: number;
  /**
   * ACR Extension 2: Initial execution authority for the workflow.
   * When set to `'NONE'` (e.g. from an untrusted webhook intake boundary),
   * side-effecting nodes are blocked until an ancestor `ByzantineQuorumNode`
   * or `PasskeyConsentNode` elevates the branch's authority.
   */
  initialExecutionAuthority?: ExecutionAuthorityLevel;
} & (
    | {
        edges: EdgeItem[];
        dynamicEntry?: never;
      }
    | {
        dynamicEntry: DynamicEntry;
        edges?: never;
      }
  );

class LoopState {
  readonly nodes = new Map<string, NodeState>();
  readonly nodeOutputs = new Map<string, unknown>();
  readonly nodeBranches = new Map<string, string>();
  readonly nodeAuthorities = new Map<string, ExecutionAuthorityLevel>();
  readonly triggerBuffer = new Map<string, Trigger[]>();
  readonly pending = new Map<string, Promise<CompletedTask>>();
  readonly interruptIds = new Set<string>();
  rehydrated: Map<string, RehydratedNode[]> = new Map();

  activated: Set<string> = new Set();
  errorShutDown = false;
  abortSignal?: AbortSignal;
}

interface CompletedTask {
  name: string;
  childCtx?: NodeContext | NodeResult;
  error?: unknown;
}

/**
 * A graph-based workflow node. `runImpl()` IS the orchestration loop:
 * SETUP (seed START triggers) → LOOP (schedule ready nodes, handle
 * completions) → FINALIZE (collect the terminal output).
 */
export class Workflow extends BaseNode {
  readonly [WORKFLOW_SIGNATURE_SYMBOL] = true;

  readonly graph?: Graph;
  readonly dynamicEntry?: DynamicEntry;
  readonly maxConcurrency?: number;
  readonly initialExecutionAuthority?: ExecutionAuthorityLevel;

  constructor(config: WorkflowConfig) {
    super({ ...config, rerunOnResume: config.rerunOnResume ?? true });
    const hasEdges = !!config.edges && config.edges.length > 0;
    if (hasEdges && config.dynamicEntry) {
      throw new Error(
        `Workflow "${this.name}": "edges" and "dynamicEntry" are mutually exclusive.`
      );
    }
    if (!hasEdges && !config.dynamicEntry) {
      throw new Error(
        `Workflow "${this.name}" requires either "edges" or "dynamicEntry".`
      );
    }
    if (
      config.maxConcurrency !== undefined &&
      (!Number.isInteger(config.maxConcurrency) || config.maxConcurrency < 1)
    ) {
      throw new Error(
        `Workflow "${this.name}": "maxConcurrency" must be a positive integer ` +
          `(got ${config.maxConcurrency}).`
      );
    }
    this.maxConcurrency = config.maxConcurrency;
    this.dynamicEntry = config.dynamicEntry;
    this.initialExecutionAuthority = config.initialExecutionAuthority;
    if (config.edges && config.edges.length > 0) {
      this.graph = createGraphFromEdgeItems(config.edges);
    }
  }

  /** Canonical RFC 8785 JCS + SHA-256 hash of the validated graph topology. */
  get topologyHash(): string {
    return this.graph?.topologyHash ?? '';
  }

  protected async *runImpl(
    ctx: NodeContext,
    nodeInput: unknown
  ): AsyncGenerator<Event, void, void> {
    if (this.initialExecutionAuthority !== undefined) {
      ctx.executionAuthority = this.initialExecutionAuthority;
    }
    if (this.graph && !ctx.graphTopologyHash) {
      ctx.graphTopologyHash = this.graph.topologyHash;
    }

    const dynamicState = new DynamicNodeState();
    const abort = createWorkflowAbort(ctx.invocationContext.abortSignal);
    ctx.scheduler = new DynamicNodeScheduler(
      dynamicState,
      abort.controller.signal
    );

    const telemetryScope = recordWorkflowInvocation({
      workflow: this,
      sessionId: ctx.invocationContext.session.id,
    });
    try {
      await telemetryScope.run(() =>
        this.orchestrate(ctx, nodeInput, dynamicState, abort.controller)
      );
    } catch (error: unknown) {
      telemetryScope.end(error);
      throw error;
    } finally {
      abort.dispose();
      telemetryScope.end();
    }
  }

  private async orchestrate(
    ctx: NodeContext,
    nodeInput: unknown,
    dynamicState: DynamicNodeState,
    abortController: AbortController
  ): Promise<void> {
    verifySessionAuditIntegrity(ctx.invocationContext.auditLedger);

    const runEvents = eventsForCurrentRun(
      ctx.session?.events ?? [],
      ctx.invocationId
    );
    const rehydrated = reconstructNodeRuns(
      runEvents,
      ctx.nodePath || undefined
    );
    this.applyResumeInputs(ctx, runEvents);

    if (this.dynamicEntry) {
      await this.runDynamicEntry(ctx, nodeInput, dynamicState);
      return;
    }

    const loop = new LoopState();
    loop.rehydrated = rehydrated;
    loop.abortSignal = abortController.signal;

    this.seedStartTriggers(loop, nodeInput, ctx.executionAuthority);

    await this.runLoop(loop, ctx, abortController);

    if (loop.errorShutDown) {
      return;
    }

    this.collectRemainingInterrupts(loop);
    for (const id of dynamicState.interruptIds) {
      loop.interruptIds.add(id);
    }

    this.finalize(loop, ctx);
  }

  private async runDynamicEntry(
    ctx: NodeContext,
    nodeInput: unknown,
    dynamicState: DynamicNodeState
  ): Promise<void> {
    const output = await this.dynamicEntry!(ctx, nodeInput);
    if (dynamicState.interruptIds.size > 0) {
      ctx.interruptIds = [...dynamicState.interruptIds];
      return;
    }
    if (output !== undefined) {
      ctx.output = output;
    }
  }

  private applyResumeInputs(ctx: NodeContext, runEvents: Event[]): void {
    for (const [interruptId, response] of resolvedInterruptResponses(
      runEvents
    )) {
      ctx.resumeInputs[interruptId] = response;
    }
  }

  private seedStartTriggers(
    loop: LoopState,
    nodeInput: unknown,
    initialAuthority: ExecutionAuthorityLevel
  ): void {
    const startEdges = this.graph!.edges.filter(
      (e) => e.fromNode.name === '__START__'
    );
    const useSubBranch = startEdges.length > 1;
    for (const edge of startEdges) {
      this.pushTrigger(loop, edge.toNode.name, {
        input: nodeInput,
        useSubBranch,
        executionAuthority: initialAuthority,
      });
    }
  }

  private async runLoop(
    loop: LoopState,
    ctx: NodeContext,
    abortController: AbortController
  ): Promise<void> {
    for (;;) {
      this.scheduleReadyNodes(loop, ctx);

      if (loop.pending.size === 0) {
        break;
      }

      const result = await Promise.race(loop.pending.values());
      loop.pending.delete(result.name);

      if (result.error) {
        const nodeState = loop.nodes.get(result.name);

        // ACR Extension 3: If the node threw NodeOutcomeUnknownError and the graph
        // defines an outgoing '__OUTCOME_UNKNOWN__' route from this node, route to
        // that recovery/quarantine branch instead of crashing or blindly retrying!
        if (isNodeOutcomeUnknownError(result.error)) {
          if (nodeState) {
            nodeState.status = NodeStatus.OUTCOME_UNKNOWN;
          }
          const unknownTargets = this.graph!.getNextPendingNodes(
            result.name,
            OUTCOME_UNKNOWN_ROUTE
          );
          if (unknownTargets.length > 0) {
            const unknownPayload = {
              status: 'OUTCOME_UNKNOWN',
              nodeName: result.error.nodeName,
              commandId: result.error.commandId,
              idempotencyKey: result.error.idempotencyKey,
              message: result.error.message,
            };
            loop.nodeOutputs.set(result.name, unknownPayload);
            loop.nodeBranches.set(result.name, ctx.branch ?? '');
            this.bufferDownstreamTriggers(
              loop,
              result.name,
              unknownPayload,
              OUTCOME_UNKNOWN_ROUTE,
              ctx.branch,
              ctx.executionAuthority
            );
            continue;
          }
        } else if (nodeState) {
          nodeState.status = NodeStatus.FAILED;
        }

        this.reportNodeError(loop, ctx, result.name, result.error);
        loop.errorShutDown = true;
        await this.cleanupPending(loop, abortController);
        throw result.error;
      }

      await this.handleCompletion(loop, ctx, result.name, result.childCtx!);
    }
  }

  private reportNodeError(
    loop: LoopState,
    ctx: NodeContext,
    nodeName: string,
    error: unknown
  ): void {
    if (isInvocationAbortedError(error) || loop.abortSignal?.aborted) {
      return;
    }
    if (!claimNodeErrorReport(error, ctx.invocationId)) {
      return;
    }
    ctx.emit(
      createNodeErrorEvent({
        error,
        attemptCount: loop.nodes.get(nodeName)?.attemptCount ?? 1,
        author: nodeName,
        invocationId: ctx.invocationId,
        nodeInfo: {
          path: ctx.nodePath ? `${ctx.nodePath}.${nodeName}` : nodeName,
        },
        branch: ctx.branch,
        isolationScope: ctx.isolationScope,
      })
    );
  }

  private scheduleReadyNodes(loop: LoopState, ctx: NodeContext): void {
    for (const nodeName of [...loop.triggerBuffer.keys()]) {
      if (loop.pending.has(nodeName)) {
        continue;
      }
      const state = loop.nodes.get(nodeName);
      if (state) {
        if (state.status === NodeStatus.RUNNING) {
          continue;
        }
        if (
          state.status === NodeStatus.WAITING &&
          state.interrupts.length > 0
        ) {
          continue;
        }
      }
      if (this.atConcurrencyLimit(loop)) {
        break;
      }

      const trigger = this.popTrigger(loop, nodeName);
      if (!trigger) {
        continue;
      }
      this.prepareNodeStateForStarting(loop, nodeName, trigger);
      this.startNodeTask(loop, ctx, nodeName, trigger);
    }
  }

  private atConcurrencyLimit(loop: LoopState): boolean {
    return (
      this.maxConcurrency !== undefined &&
      loop.pending.size >= this.maxConcurrency
    );
  }

  private prepareNodeStateForStarting(
    loop: LoopState,
    nodeName: string,
    trigger: Trigger
  ): void {
    const existing = loop.nodes.get(nodeName);
    const state = createNodeState({
      runCounter: existing?.runCounter ?? 0,
    });
    state.input = trigger.input;
    state.status = NodeStatus.RUNNING;
    loop.nodes.set(nodeName, state);
  }

  private startNodeTask(
    loop: LoopState,
    ctx: NodeContext,
    nodeName: string,
    trigger: Trigger
  ): void {
    const node = this.getStaticNode(nodeName);
    const nodeState = loop.nodes.get(nodeName)!;
    const repeatActivation = loop.activated.has(nodeName);
    loop.activated.add(nodeName);

    const prior = loop.rehydrated.get(nodeName)?.shift();
    if (prior && isFastForwardable(prior)) {
      loop.pending.set(
        nodeName,
        Promise.resolve({
          name: nodeName,
          childCtx: makeFastForwardResult(ctx, prior),
        })
      );
      return;
    }

    if (
      prior &&
      !node.rerunOnResume &&
      prior.output === undefined &&
      prior.interruptIds.size > 0
    ) {
      const values = [...prior.interruptIds].map((id) => ctx.resumeInputs[id]);
      if (values.every((v) => v !== undefined)) {
        const output = values.length === 1 ? values[0] : values;
        const resumeResult: NodeResult = {
          output,
          route: undefined,
          branch: prior.branch ?? ctx.branch,
          interruptIds: [],
          executionAuthority:
            prior.executionAuthority ??
            trigger.executionAuthority ??
            ctx.executionAuthority,
        };
        loop.pending.set(
          nodeName,
          Promise.resolve({ name: nodeName, childCtx: resumeResult })
        );
        return;
      }
    }

    let runId = nodeState.runId;
    if (!runId) {
      nodeState.runCounter += 1;
      runId = String(nodeState.runCounter);
      nodeState.runId = runId;
    }

    const resuming =
      prior !== undefined &&
      prior.interruptIds.size > 0 &&
      prior.input !== undefined;
    const nodeInput = resuming ? prior.input : trigger.input;
    const effectiveAuthority =
      (resuming ? prior.executionAuthority : undefined) ??
      trigger.executionAuthority ??
      ctx.executionAuthority;

    const task: Promise<CompletedTask> = executeChildNode({
      parent: ctx,
      node,
      input: nodeInput,
      abortSignal: loop.abortSignal,
      nodeState,
      resumeInputs: repeatActivation ? {} : undefined,
      options: {
        runId,
        useSubBranch: trigger.useSubBranch,
        overrideBranch: trigger.branch,
        overrideIsolationScope: trigger.isolationScope,
        overrideExecutionAuthority: effectiveAuthority,
      },
    }).then(
      (childCtx) => ({ name: nodeName, childCtx }),
      (error) => ({ name: nodeName, error })
    );
    loop.pending.set(nodeName, task);
  }

  private async handleCompletion(
    loop: LoopState,
    ctx: NodeContext,
    nodeName: string,
    childCtx: NodeContext | NodeResult
  ): Promise<void> {
    const nodeState = loop.nodes.get(nodeName)!;
    const node = this.getStaticNode(nodeName);

    if (childCtx.interruptIds.length > 0) {
      nodeState.status = NodeStatus.WAITING;
      nodeState.interrupts = [...childCtx.interruptIds];
      childCtx.interruptIds.forEach((id) => loop.interruptIds.add(id));
      return;
    }

    if (
      node.waitForOutput &&
      childCtx.output === undefined &&
      childCtx.route === undefined
    ) {
      nodeState.status = NodeStatus.WAITING;
      return;
    }

    nodeState.status = NodeStatus.COMPLETED;
    if (childCtx.output !== undefined) {
      loop.nodeOutputs.set(nodeName, childCtx.output);
    }
    loop.nodeBranches.set(nodeName, childCtx.branch ?? '');
    const effectiveAuthority =
      childCtx.executionAuthority ?? ctx.executionAuthority;
    loop.nodeAuthorities.set(nodeName, effectiveAuthority);

    this.bufferDownstreamTriggers(
      loop,
      nodeName,
      childCtx.output,
      childCtx.route,
      childCtx.branch,
      effectiveAuthority
    );
  }

  private bufferDownstreamTriggers(
    loop: LoopState,
    nodeName: string,
    output: unknown,
    route: RouteValue | RouteValue[] | undefined,
    branch: string | undefined,
    executionAuthority: ExecutionAuthorityLevel
  ): void {
    const nextNodes = this.graph!.getNextPendingNodes(nodeName, route ?? null);
    const useSubBranch = nextNodes.length > 1;

    for (const targetName of nextNodes) {
      const targetNode = this.getStaticNode(targetName);

      if (targetNode.requiresAllPredecessors) {
        const predecessors = new Set(
          this.graph!.edges.filter((e) => e.toNode.name === targetName).map(
            (e) => e.fromNode.name
          )
        );
        const allCompleted = [...predecessors].every(
          (p) => loop.nodes.get(p)?.status === NodeStatus.COMPLETED
        );
        if (allCompleted) {
          const outputs: Record<string, unknown> = {};
          const authorities: ExecutionAuthorityLevel[] = [];
          for (const p of predecessors) {
            outputs[p] = loop.nodeOutputs.get(p);
            authorities.push(loop.nodeAuthorities.get(p) ?? executionAuthority);
          }
          const branches = [...predecessors].map(
            (p) => loop.nodeBranches.get(p) ?? ''
          );
          const commonBranch = commonPrefixOf(branches);
          this.pushTrigger(loop, targetName, {
            input: outputs,
            useSubBranch: false,
            branch: commonBranch || undefined,
            executionAuthority: intersectExecutionAuthorities(authorities),
          });
        }
      } else {
        this.pushTrigger(loop, targetName, {
          input: output,
          useSubBranch,
          branch,
          executionAuthority,
        });
      }
    }
  }

  private collectRemainingInterrupts(loop: LoopState): void {
    for (const nodeState of loop.nodes.values()) {
      if (
        nodeState.status === NodeStatus.WAITING &&
        nodeState.interrupts.length > 0
      ) {
        nodeState.interrupts.forEach((id) => loop.interruptIds.add(id));
      }
    }
  }

  private finalize(loop: LoopState, ctx: NodeContext): void {
    if (loop.interruptIds.size > 0) {
      ctx.interruptIds = [...loop.interruptIds];
      return;
    }

    const terminalNamesWithOutput = [...this.graph!.terminalNodeNames].filter(
      (name) => loop.nodeOutputs.has(name)
    );
    const terminalOutputs = terminalNamesWithOutput.map((name) =>
      loop.nodeOutputs.get(name)
    );

    if (terminalOutputs.length === 1) {
      ctx.output = terminalOutputs[0];
      const termAuth = loop.nodeAuthorities.get(terminalNamesWithOutput[0]);
      if (termAuth !== undefined) {
        ctx.executionAuthority = termAuth;
      }
    } else if (terminalOutputs.length > 1) {
      throw new Error(
        `Workflow ${this.name}: multiple terminal nodes produced output ` +
          `(${terminalOutputs.length}). A workflow must have at most one terminal output.`
      );
    }
  }

  private pushTrigger(
    loop: LoopState,
    nodeName: string,
    trigger: Trigger
  ): void {
    const buffer = loop.triggerBuffer.get(nodeName);
    if (buffer) {
      buffer.push(trigger);
    } else {
      loop.triggerBuffer.set(nodeName, [trigger]);
    }
  }

  private popTrigger(loop: LoopState, nodeName: string): Trigger | undefined {
    const buffer = loop.triggerBuffer.get(nodeName);
    if (!buffer || buffer.length === 0) {
      return undefined;
    }
    const trigger = buffer.shift()!;
    if (buffer.length === 0) {
      loop.triggerBuffer.delete(nodeName);
    }
    return trigger;
  }

  private getStaticNode(name: string): BaseNode {
    const node = this.graph!.nodes.find((n) => n.name === name);
    if (!node) {
      throw new Error(`Node ${name} not found in graph.`);
    }
    return node;
  }

  private async cleanupPending(
    loop: LoopState,
    abortController: AbortController
  ): Promise<void> {
    abortController.abort();
    const outstanding = [...loop.pending.values()];
    loop.pending.clear();
    await Promise.allSettled(outstanding);
  }
}

export function isWorkflow(value: unknown): value is Workflow {
  return (
    typeof value === 'object' &&
    value !== null &&
    WORKFLOW_SIGNATURE_SYMBOL in value &&
    (value as Workflow)[WORKFLOW_SIGNATURE_SYMBOL] === true
  );
}

function createWorkflowAbort(parentSignal?: AbortSignal): {
  controller: AbortController;
  dispose: () => void;
} {
  const controller = new AbortController();
  if (!parentSignal) {
    return { controller, dispose: () => {} };
  }
  if (parentSignal.aborted) {
    controller.abort();
    return { controller, dispose: () => {} };
  }
  const onParentAbort = () => controller.abort();
  parentSignal.addEventListener('abort', onParentAbort, { once: true });
  return {
    controller,
    dispose: () => parentSignal.removeEventListener('abort', onParentAbort),
  };
}
