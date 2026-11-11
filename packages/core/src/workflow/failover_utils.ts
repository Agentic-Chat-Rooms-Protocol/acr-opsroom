/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provenance: Lifted from `google/adk-js` (commit `8dad457`, v2.4.0)
 * `core/src/utils/failover_utils.ts`.
 * Extended with `RoutedNode` workflow node wrapper.
 */

import { BaseNode, BaseNodeConfig } from './base_node.js';
import { NodeContext } from './node_context.js';
import { Event } from './shims.js';

/**
 * Type definition for a function that selects an item based on the context.
 */
export type Router<T, C> = (
  items: Readonly<Record<string, T>>,
  context: C,
  errorContext?: { failedKeys: ReadonlySet<string>; lastError: unknown }
) => Promise<string | undefined> | string | undefined;

/**
 * Runs a core operation with selection and failover support.
 * Only fails over to `router(items, context, { failedKeys, lastError })` when
 * `!firstYielded` (before the first event is emitted), preventing mid-stream
 * partial-event duplication.
 */
export async function* runWithRouting<T, C, TYield>(
  items: Readonly<Record<string, T>>,
  context: C,
  router: Router<T, C>,
  runFn: (item: T) => AsyncGenerator<TYield, void, void> | Promise<TYield>
): AsyncGenerator<TYield, void, void> {
  const initialKey = await router(items, context);
  if (!initialKey) {
    throw new Error('Initial routing failed, no item selected.');
  }

  let selectedKey = initialKey;
  let selectedItem = items[selectedKey];
  if (!selectedItem) {
    throw new Error(`Item not found for key: ${selectedKey}`);
  }

  const triedKeys = new Set<string>([selectedKey]);

  while (true) {
    let firstYielded = false;

    try {
      const generatorOrPromise = runFn(selectedItem);
      if (isAsyncGenerator(generatorOrPromise)) {
        for await (const result of generatorOrPromise) {
          yield result;
          firstYielded = true;
        }
        return;
      }

      const result = await generatorOrPromise;
      yield result;
      return;
    } catch (error) {
      if (!firstYielded) {
        const nextKey = await router(items, context, {
          failedKeys: triedKeys,
          lastError: error,
        });

        if (nextKey === undefined) {
          throw error;
        }

        if (triedKeys.has(nextKey)) {
          throw error;
        }

        selectedKey = nextKey;
        selectedItem = items[selectedKey];
        if (!selectedItem) {
          throw new Error(`Item not found for key: ${selectedKey}`);
        }
        triedKeys.add(selectedKey);
      } else {
        throw error;
      }
    }
  }
}

function isAsyncGenerator(
  obj: unknown
): obj is AsyncGenerator<unknown, void, void> {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof (obj as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function'
  );
}

export interface RoutedNodeConfig<TNode extends BaseNode = BaseNode>
  extends BaseNodeConfig {
  candidates: Readonly<Record<string, TNode>>;
  router: Router<TNode, NodeContext>;
}

/**
 * A workflow node that wraps a set of candidate nodes and uses {@link runWithRouting}
 * for dynamic model/agent selection and pre-first-event failover.
 */
export class RoutedNode<TNode extends BaseNode = BaseNode> extends BaseNode {
  readonly candidates: Readonly<Record<string, TNode>>;
  readonly router: Router<TNode, NodeContext>;

  constructor(config: RoutedNodeConfig<TNode>) {
    super(config);
    this.candidates = config.candidates;
    this.router = config.router;
  }

  protected async *runImpl(
    ctx: NodeContext,
    input: unknown
  ): AsyncGenerator<Event, void, void> {
    yield* runWithRouting(this.candidates, ctx, this.router, (candidate) =>
      candidate.run(ctx, input)
    );
  }
}
