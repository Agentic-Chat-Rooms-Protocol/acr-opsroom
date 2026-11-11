/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provenance: Lifted from `google/adk-js` (commit `8dad457`, v2.4.0)
 * `core/src/workflow/nodes/parallel_worker.ts`.
 */

import { BaseNode } from '../base_node.js';
import { isNodeInterruptedError } from '../errors.js';
import { RunnableNode } from '../graph.js';
import { NodeContext } from '../node_context.js';
import { buildNode } from '../utils/workflow_graph_utils.js';

const DEFAULT_MAX_PARALLEL_WORKERS = 8;

const PARALLEL_WORKER_SIGNATURE_SYMBOL = Symbol.for(
  'google.adk.workflow.parallelWorker'
);

/** Options for a {@link ParallelWorker}. */
export interface ParallelWorkerConfig {
  /**
   * Maximum number of items processed concurrently. Defaults to
   * `DEFAULT_MAX_PARALLEL_WORKERS` (8); pass `Infinity` for unbounded.
   */
  maxParallelWorkers?: number;
}

/**
 * A node that runs a wrapped node once per item of a list input, preserving
 * order, bounded by `maxParallelWorkers`, and stopping on the first error.
 */
export class ParallelWorker extends BaseNode {
  readonly [PARALLEL_WORKER_SIGNATURE_SYMBOL] = true;
  readonly maxParallelWorkers?: number;
  readonly inner: BaseNode;

  constructor(inner: RunnableNode, config: ParallelWorkerConfig = {}) {
    const built = buildNode(inner);
    super({ name: built.name, rerunOnResume: true });
    if (
      config.maxParallelWorkers !== undefined &&
      config.maxParallelWorkers < 1
    ) {
      throw new Error('maxParallelWorkers must be greater than or equal to 1.');
    }
    this.inner = built;
    this.maxParallelWorkers = config.maxParallelWorkers;
  }

  protected async *runImpl(
    ctx: NodeContext,
    input: unknown
  ): AsyncGenerator<unknown, void, void> {
    const items = Array.isArray(input) ? input : [input];
    if (items.length === 0) {
      yield [];
      return;
    }

    const results = new Array<unknown>(items.length);
    const poolSize = Math.min(
      this.maxParallelWorkers ?? DEFAULT_MAX_PARALLEL_WORKERS,
      items.length
    );

    let nextIndex = 0;
    let failed = false;
    let firstError: unknown;
    let interrupted = false;
    const interruptIds: string[] = [];

    const isAborted = (): boolean =>
      ctx.abortSignal?.aborted === true ||
      ctx.invocationContext.abortSignal?.aborted === true;

    const worker = async (): Promise<void> => {
      while (!failed && !interrupted && !isAborted()) {
        const i = nextIndex++;
        if (i >= items.length) {
          break;
        }
        try {
          const child = await ctx.runNode(this.inner, items[i], {
            useSubBranch: true,
            runId: String(i),
            overrideNodePath: `${ctx.nodePath}.${this.inner.name}@${i}`,
          });
          if (child.interruptIds.length > 0) {
            interrupted = true;
            for (const id of child.interruptIds) {
              if (!interruptIds.includes(id)) {
                interruptIds.push(id);
              }
            }
            break;
          }
          results[i] = child.output;
        } catch (err) {
          if (isNodeInterruptedError(err)) {
            interrupted = true;
            break;
          }
          if (!failed) {
            failed = true;
            firstError = err;
          }
          break;
        }
      }
    };

    await Promise.all(Array.from({ length: poolSize }, () => worker()));

    if (failed) {
      throw firstError;
    }
    if (interrupted) {
      for (const id of interruptIds) {
        if (!ctx.interruptIds.includes(id)) {
          ctx.interruptIds.push(id);
        }
      }
      return;
    }
    if (isAborted()) {
      return;
    }
    yield results;
  }
}

export function isParallelWorker(value: unknown): value is ParallelWorker {
  return (
    typeof value === 'object' &&
    value !== null &&
    PARALLEL_WORKER_SIGNATURE_SYMBOL in value &&
    (value as ParallelWorker)[PARALLEL_WORKER_SIGNATURE_SYMBOL] === true
  );
}
