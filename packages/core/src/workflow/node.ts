/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provenance: Lifted from `google/adk-js` (commit `8dad457`, v2.4.0)
 * `core/src/workflow/node.ts`.
 */

import { BaseNode } from './base_node.js';
import { NodeLike } from './graph.js';
import { NodeContext } from './node_context.js';
import { Event } from './shims.js';
import { buildNode, BuildNodeOptions } from './utils/workflow_graph_utils.js';

/** Options accepted by {@link node}. */
export type NodeOptions = BuildNodeOptions;

/**
 * Wraps a {@link NodeLike} (function, tool, agent, or existing node) into a
 * {@link BaseNode}, optionally overriding its properties.
 */
export function node(nodeLike: NodeLike, options: NodeOptions = {}): BaseNode {
  return buildNode(nodeLike, options);
}

/**
 * A base class designed for subclassing. Implement {@link runNodeImpl} to
 * provide node logic; subclasses inherit the schema/retry/timeout machinery of
 * {@link BaseNode}.
 */
export abstract class WorkflowNode<
  TInput = unknown,
  TOutput = unknown,
> extends BaseNode<TInput, TOutput> {
  protected abstract runNodeImpl(
    ctx: NodeContext,
    input: TInput
  ): AsyncGenerator<Event | TOutput | unknown, void, void>;

  protected async *runImpl(
    ctx: NodeContext,
    input: TInput
  ): AsyncGenerator<Event | TOutput | unknown, void, void> {
    yield* this.runNodeImpl(ctx, input);
  }
}
