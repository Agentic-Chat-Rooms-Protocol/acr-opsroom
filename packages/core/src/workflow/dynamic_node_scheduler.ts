/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provenance: Lifted from `google/adk-js` (commit `8dad457`, v2.4.0)
 * `core/src/workflow/dynamic_node_scheduler.ts`.
 */

import { BaseNode } from './base_node.js';
import { isCompactedEvent } from './context/compacted_event.js';
import {
  DynamicNodeFailError,
  isDynamicNodeFailError,
  isNodeInterruptedError,
  isNodeOutcomeUnknownError,
  isNodePrivilegeEscalationError,
  isStaleGenerationFenceError,
} from './errors.js';
import { NodeContext, NodeResult } from './node_context.js';
import { executeChildNode } from './node_runner.js';
import { createNodeState } from './node_state.js';
import { NodeStatus } from './node_status.js';
import {
  DynamicNodeRun,
  DynamicNodeState,
  ScheduleDynamicNode,
  ScheduleDynamicNodeOptions,
} from './schedule_dynamic_node.js';
import {
  ExecutionAuthorityLevel,
  joinBranchExecutionAuthority,
} from './shims.js';
import {
  eventsForCurrentRun,
  isFastForwardable,
  makeFastForwardResult,
  reconstructNodeStatesByPath,
  type RehydratedNode,
} from './utils/rehydration_utils.js';

export interface DynamicNodeSchedulerOptions {
  state: DynamicNodeState;
  abortSignal?: AbortSignal;
}

/**
 * Handles `ctx.runNode()` calls for a {@link Workflow} subtree.
 * Caches `priorStatesByPath` per invocation turn (refreshing only if a new
 * `CompactedEvent` is committed) for $O(1)$ per-step rehydration lookups.
 */
export class DynamicNodeScheduler implements ScheduleDynamicNode {
  private priorStatesCache?: {
    invocationId: string;
    lastCompactedId?: string;
    states: Map<string, RehydratedNode>;
  };
  private reconstructCount = 0;

  constructor(
    private readonly state: DynamicNodeState,
    private readonly abortSignal?: AbortSignal
  ) {}

  /** Number of times `reconstructNodeStatesByPath` was computed by this scheduler. */
  getPriorStatesReconstructCount(): number {
    return this.reconstructCount;
  }

  private getPriorState(
    ctx: NodeContext,
    nodePath: string
  ): RehydratedNode | undefined {
    const events = ctx.session?.events ?? [];
    let lastCompactedId: string | undefined;
    for (let i = events.length - 1; i >= 0; i--) {
      if (isCompactedEvent(events[i])) {
        lastCompactedId = events[i].id;
        break;
      }
    }

    if (
      !this.priorStatesCache ||
      this.priorStatesCache.invocationId !== ctx.invocationId ||
      this.priorStatesCache.lastCompactedId !== lastCompactedId
    ) {
      this.reconstructCount += 1;
      const states = reconstructNodeStatesByPath(
        eventsForCurrentRun(events, ctx.invocationId)
      );
      this.priorStatesCache = {
        invocationId: ctx.invocationId,
        lastCompactedId,
        states,
      };
    }

    return this.priorStatesCache.states.get(nodePath);
  }

  async schedule(
    ctx: NodeContext,
    node: BaseNode,
    input: unknown,
    options: ScheduleDynamicNodeOptions
  ): Promise<NodeContext | NodeResult> {
    const initialAuthority =
      options.overrideExecutionAuthority ?? ctx.executionAuthority;
    const result = await this.scheduleRun(
      ctx,
      node,
      input,
      options,
      initialAuthority
    );
    for (const id of result.interruptIds) {
      if (!ctx.interruptIds.includes(id)) {
        ctx.interruptIds.push(id);
      }
    }
    return result;
  }

  private async scheduleRun(
    ctx: NodeContext,
    node: BaseNode,
    input: unknown,
    options: ScheduleDynamicNodeOptions,
    initialAuthority: ExecutionAuthorityLevel
  ): Promise<NodeContext | NodeResult> {
    const name = options.nodeName ?? node.name;
    const runId = options.runId;
    const nodePath = ctx.nodePath
      ? `${ctx.nodePath}.${name}@${runId}`
      : `${name}@${runId}`;

    const existing = this.state.runs.get(nodePath);
    if (existing?.task) {
      const taskResult = await existing.task;
      if (taskResult.executionAuthority !== undefined) {
        ctx.executionAuthority = joinBranchExecutionAuthority(
          ctx.executionAuthority,
          taskResult.executionAuthority,
          initialAuthority
        );
      }
      return taskResult;
    }
    if (existing?.result) {
      return this.handBack(ctx, existing.result, options, initialAuthority);
    }

    if (!this.state.runs.has(nodePath)) {
      const prior = this.getPriorState(ctx, nodePath);
      if (prior && isFastForwardable(prior)) {
        return this.completeWithoutRunning(
          ctx,
          { nodePath, runId, options },
          makeFastForwardResult(ctx, prior),
          initialAuthority
        );
      }
      const handoff = this.resumeHandoff(ctx, node, prior);
      if (handoff) {
        return this.completeWithoutRunning(
          ctx,
          { nodePath, runId, options },
          handoff,
          initialAuthority
        );
      }
    }

    return this.runFresh(
      ctx,
      node,
      input,
      name,
      runId,
      nodePath,
      options,
      initialAuthority
    );
  }

  private completeWithoutRunning(
    ctx: NodeContext,
    run: {
      nodePath: string;
      runId: string;
      options: ScheduleDynamicNodeOptions;
    },
    result: NodeResult,
    initialAuthority: ExecutionAuthorityLevel
  ): NodeResult {
    this.state.runs.set(run.nodePath, {
      state: createNodeState({
        status: NodeStatus.COMPLETED,
        runId: run.runId,
        parentRunId: ctx.runId,
      }),
      output: result.output,
      result,
    });
    return this.handBack(ctx, result, run.options, initialAuthority);
  }

  private handBack(
    ctx: NodeContext,
    result: NodeResult,
    options: ScheduleDynamicNodeOptions,
    initialAuthority: ExecutionAuthorityLevel
  ): NodeResult {
    if (options.useAsOutput) {
      ctx.output = result.output;
      ctx.route = result.route;
    }
    if (result.executionAuthority !== undefined) {
      ctx.executionAuthority = joinBranchExecutionAuthority(
        ctx.executionAuthority,
        result.executionAuthority,
        initialAuthority
      );
    }
    return result;
  }

  private resumeHandoff(
    ctx: NodeContext,
    node: BaseNode,
    prior: RehydratedNode | undefined
  ): NodeResult | undefined {
    if (
      !prior ||
      node.rerunOnResume ||
      prior.output !== undefined ||
      prior.interruptIds.size === 0
    ) {
      return undefined;
    }
    const values = [...prior.interruptIds].map((id) => ctx.resumeInputs[id]);
    if (!values.every((value) => value !== undefined)) {
      return undefined;
    }
    return {
      output: values.length === 1 ? values[0] : values,
      route: undefined,
      branch: prior.branch ?? ctx.branch,
      interruptIds: [],
      executionAuthority: prior.executionAuthority ?? ctx.executionAuthority,
    };
  }

  private async runFresh(
    ctx: NodeContext,
    node: BaseNode,
    input: unknown,
    name: string,
    runId: string,
    nodePath: string,
    options: ScheduleDynamicNodeOptions,
    initialAuthority: ExecutionAuthorityLevel
  ): Promise<NodeContext> {
    const run: DynamicNodeRun = {
      state: createNodeState({
        status: NodeStatus.RUNNING,
        input,
        runId,
        parentRunId: ctx.runId,
      }),
    };
    this.state.runs.set(nodePath, run);

    run.task = executeChildNode({
      parent: ctx,
      node,
      input,
      abortSignal: this.abortSignal,
      options: {
        nodeName: name,
        runId,
        overrideNodePath: nodePath,
        useAsOutput: options.useAsOutput,
        useSubBranch: options.useSubBranch,
        overrideBranch: options.overrideBranch,
        overrideIsolationScope: options.overrideIsolationScope,
        overrideExecutionAuthority: options.overrideExecutionAuthority,
      },
    });

    let childCtx: NodeContext;
    try {
      childCtx = await run.task;
    } catch (err) {
      if (
        isNodeInterruptedError(err) ||
        isDynamicNodeFailError(err) ||
        isNodeOutcomeUnknownError(err) ||
        isStaleGenerationFenceError(err) ||
        isNodePrivilegeEscalationError(err)
      ) {
        if (isNodeOutcomeUnknownError(err)) {
          run.state.status = NodeStatus.OUTCOME_UNKNOWN;
        } else if (!isNodeInterruptedError(err)) {
          run.state.status = NodeStatus.FAILED;
        }
        throw err;
      }
      run.state.status = NodeStatus.FAILED;
      const error = err instanceof Error ? err : new Error(String(err));
      throw new DynamicNodeFailError({
        message: `Dynamic node ${name} failed: ${error.message}`,
        error,
        errorNodePath: nodePath,
      });
    }
    if (childCtx.executionAuthority !== undefined) {
      ctx.executionAuthority = joinBranchExecutionAuthority(
        ctx.executionAuthority,
        childCtx.executionAuthority,
        initialAuthority
      );
    }
    this.recordResult(run, childCtx, node);
    return childCtx;
  }

  private recordResult(
    run: DynamicNodeRun,
    childCtx: NodeContext,
    node: BaseNode
  ): void {
    if (childCtx.interruptIds.length > 0) {
      run.state.status = NodeStatus.WAITING;
      run.state.interrupts = [...childCtx.interruptIds];
      childCtx.interruptIds.forEach((id) => this.state.interruptIds.add(id));
    } else if (
      node.waitForOutput &&
      childCtx.output === undefined &&
      childCtx.route === undefined
    ) {
      run.state.status = NodeStatus.WAITING;
    } else {
      run.state.status = NodeStatus.COMPLETED;
      run.output = childCtx.output;
    }
  }
}
