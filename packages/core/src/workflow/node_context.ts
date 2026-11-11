/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provenance: Lifted from `google/adk-js` (commit `8dad457`, v2.4.0)
 * `core/src/workflow/node_context.ts`.
 * Extended with ACR Hyperfusion fields (`workflowId`, `graphTopologyHash`,
 * `executionAuthority`, `sideEffectDispatched`, and `requestInput`).
 */

import { AsyncQueue } from './async_queue.js';
import type { BaseNode } from './base_node.js';
import { NodeInterruptedError } from './errors.js';
import type { RouteValue, RunnableNode } from './graph.js';
import { executeChildNode, RunNodeOptions } from './node_runner.js';
import { RequestInput, RequestInputParams } from './request_input.js';
import type {
  ScheduleDynamicNode,
  ScheduleDynamicNodeOptions,
} from './schedule_dynamic_node.js';
import {
  createEventActions,
  Event,
  EventActions,
  ExecutionAuthorityLevel,
  InvocationContext,
  joinBranchExecutionAuthority,
  SchemaLike,
  State,
} from './shims.js';
import { buildNode } from './utils/workflow_graph_utils.js';

/**
 * The result of running a node: the fields a caller (and the engine's
 * completion handling) reads off a finished run.
 */
export interface NodeResult {
  /** The structured output the node produced (if any). */
  output: unknown;
  /** The route key(s) the node emitted, if any (array = multi-route). */
  route?: RouteValue | RouteValue[];
  /** The branch the node ran on. */
  branch?: string;
  /** Interrupt ids the node is blocked on (empty when it completed). */
  interruptIds: string[];
  /** ACR Extension 2 & 5: Execution authority after this node ran. */
  executionAuthority?: ExecutionAuthorityLevel;
}

/**
 * Options for constructing a {@link NodeContext}.
 */
export interface NodeContextOptions {
  invocationContext: InvocationContext;
  channel: AsyncQueue<Event>;
  /** Dotted node path of the owning node (empty string for the root). */
  nodePath: string;
  /** Deterministic run id of the owning node. */
  runId: string;
  /** Responses for resuming interrupted child nodes, keyed by interrupt id. */
  resumeInputs?: Record<string, unknown>;
  /** Scope tag isolating this node's events from peer scopes. */
  isolationScope?: string;
  /** Accumulator for event actions (state delta, etc). */
  actions?: EventActions;
  /**
   * Declares the keys this node may write to `ctx.state` and their types.
   */
  stateSchema?: SchemaLike;
  /** ACR Extension 5: Owning workflow identifier. */
  workflowId?: string;
  /** ACR Extension 5: Canonical RFC 8785 JCS + SHA-256 hash of the workflow graph topology. */
  graphTopologyHash?: string;
  /** ACR Extension 2: Execution authority inherited along this branch. */
  executionAuthority?: ExecutionAuthorityLevel;
}

/**
 * The execution context for a workflow node.
 */
export class NodeContext implements NodeResult {
  readonly invocationContext: InvocationContext;
  readonly channel: AsyncQueue<Event>;
  readonly nodePath: string;
  readonly runId: string;
  readonly workflowId: string;
  graphTopologyHash: string;

  outputForAncestors: readonly string[] = [];
  outputDelegated = false;
  readonly actions: EventActions;
  resumeInputs: Record<string, unknown>;
  isolationScope?: string;

  /** The structured output produced by the node during its run. */
  output: unknown = undefined;

  /** The route key(s) emitted by the node, if any (array = multi-route). */
  route?: RouteValue | RouteValue[];

  /** Interrupt ids the node is currently blocked on (HITL). */
  interruptIds: string[] = [];

  /**
   * The failure a node reported by emitting an error event rather than by
   * throwing. Read back at the end of the attempt; cleared per attempt.
   */
  reportedError?: { errorCode?: string; errorMessage?: string };

  /** Abort signal for the current node run. */
  abortSignal?: AbortSignal;

  /** The dynamic-node scheduler for this subtree. */
  scheduler?: ScheduleDynamicNode;

  /** The current attempt number (1-based) for the running node. */
  attemptCount = 1;

  /** ACR Extension 2 & 5: Execution authority for this branch. */
  executionAuthority: ExecutionAuthorityLevel;

  /**
   * ACR Extension 3: Marks whether a side-effecting command was already
   * dispatched during the current attempt so `NodeTimeoutError` never triggers
   * a blind retry.
   */
  sideEffectDispatched = false;

  readonly stateSchema?: SchemaLike;

  private readonly _state: State;
  private readonly dynamicRunCounters = new Map<string, number>();
  private readonly autoRunIds = new Map<string, Set<string>>();
  private readonly numericCustomRunIds = new Map<string, Set<string>>();

  constructor(opts: NodeContextOptions) {
    this.invocationContext = opts.invocationContext;
    this.channel = opts.channel;
    this.nodePath = opts.nodePath;
    this.runId = opts.runId;
    this.workflowId = opts.workflowId ?? opts.invocationContext.invocationId;
    this.graphTopologyHash = opts.graphTopologyHash ?? '';
    this.executionAuthority =
      opts.executionAuthority ?? opts.invocationContext.executionAuthority;
    this.resumeInputs = opts.resumeInputs ?? {};
    this.isolationScope = opts.isolationScope;
    this.actions = opts.actions ?? createEventActions();
    this.stateSchema = opts.stateSchema;
    this._state = new State(
      opts.invocationContext.session.state,
      this.actions.stateDelta,
      opts.stateSchema
    );
  }

  /** Delta-aware session state; writes accumulate in `actions.stateDelta`. */
  get state(): State {
    return this._state;
  }

  /** The branch of the owning invocation context. */
  get branch(): string | undefined {
    return this.invocationContext.branch;
  }

  /** The current invocation id. */
  get invocationId(): string {
    return this.invocationContext.invocationId;
  }

  /** The current session. */
  get session() {
    return this.invocationContext.session;
  }

  getInvocationContext(): InvocationContext {
    return this.invocationContext;
  }

  /** Streams a single event out through the workflow's event channel. */
  emit(event: Event): void {
    this.channel.push(event);
  }

  /** Convenience helper to construct a {@link RequestInput} scoped to this node. */
  requestInput(params: RequestInputParams = {}): RequestInput {
    return new RequestInput({
      ...params,
      interruptId:
        params.interruptId ??
        `${this.nodePath || this.runId}:${this.attemptCount}`,
    });
  }

  /**
   * Runs a child node programmatically, streaming its events through the same
   * channel and resolving to the child's result.
   */
  runNode(
    nodeLike: RunnableNode,
    input?: unknown,
    options?: RunNodeOptions
  ): Promise<NodeContext | NodeResult> {
    const node = buildNode(nodeLike);
    if (this.scheduler) {
      const nodeName = options?.nodeName ?? node.name;
      let runId = options?.runId;
      if (runId !== undefined) {
        assertCustomRunId(runId, nodeName, mapSet(this.autoRunIds, nodeName));
        if (isAutoNumberShaped(runId)) {
          mapSet(this.numericCustomRunIds, nodeName).add(runId);
        }
      }
      if (!runId) {
        assertNoNumericCustomRunIds(
          nodeName,
          mapSet(this.numericCustomRunIds, nodeName)
        );
        const next = (this.dynamicRunCounters.get(nodeName) ?? 0) + 1;
        this.dynamicRunCounters.set(nodeName, next);
        runId = String(next);
        mapSet(this.autoRunIds, nodeName).add(runId);
      }
      return this.scheduleAndUnwind(node, input, {
        ...options,
        nodeName,
        runId,
      });
    }
    return executeChildNode({ parent: this, node, input, options });
  }

  private async scheduleAndUnwind(
    node: BaseNode,
    input: unknown,
    options: ScheduleDynamicNodeOptions
  ): Promise<NodeContext | NodeResult> {
    const initialAuthority =
      options.overrideExecutionAuthority ?? this.executionAuthority;
    const child = await this.scheduler!.schedule(this, node, input, options);
    if (child.interruptIds.length > 0) {
      throw new NodeInterruptedError();
    }
    if (child.executionAuthority !== undefined) {
      this.executionAuthority = joinBranchExecutionAuthority(
        this.executionAuthority,
        child.executionAuthority,
        initialAuthority
      );
    }
    return child;
  }
}

function mapSet(map: Map<string, Set<string>>, key: string): Set<string> {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  return set;
}

function isAutoNumberShaped(runId: string): boolean {
  return /^\d+$/.test(runId);
}

function numericRunIdMixError(nodeName: string, runId: string): Error {
  return new Error(
    `Invalid runId '${runId}' for node '${nodeName}': ADK numbers automatic ` +
      `runs of a node "1", "2", "3", … per context, so an all-digit custom ` +
      `id draws from that same namespace. A later turn that issues a ` +
      `different set of custom ids shifts the automatic sequence onto a ` +
      `checkpoint path an earlier call already wrote, and the call is ` +
      `fast-forwarded to that run's cached output with its own input ` +
      `silently discarded. Give the custom id a non-numeric part, e.g. ` +
      `'${nodeName}-${runId}', or supply an explicit id for every run of ` +
      `this node so ADK never numbers one.`
  );
}

function assertCustomRunId(
  runId: string,
  nodeName: string,
  autoRunIds: ReadonlySet<string>
): void {
  if (runId.trim() === '') {
    throw new Error(
      `Invalid runId for node '${nodeName}': a custom run id cannot be empty. ` +
        `Omit runId to let ADK number the run automatically.`
    );
  }
  if (autoRunIds.size > 0 && isAutoNumberShaped(runId)) {
    throw numericRunIdMixError(nodeName, runId);
  }
}

function assertNoNumericCustomRunIds(
  nodeName: string,
  numericCustomRunIds: ReadonlySet<string>
): void {
  const first = numericCustomRunIds.values().next();
  if (!first.done) {
    throw numericRunIdMixError(nodeName, first.value);
  }
}
