/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provenance: Lifted from `google/adk-js` (commit `8dad457`, v2.4.0)
 * `core/src/workflow/node_builders.ts`.
 */

import { FunctionNode, FunctionNodeHandler } from './nodes/function_node.js';
import { ParallelWorker } from './nodes/parallel_worker.js';
import { ToolNode } from './nodes/tool_node.js';
import { BaseTool, isBaseTool } from './shims.js';
import {
  type NodeBuilder,
  type ParallelWorkerFactory,
  registerNodeBuilder,
  setParallelWorkerFactory,
} from './utils/workflow_graph_utils.js';

/** Builds a {@link FunctionNode} from a plain function. */
export const FUNCTION_BUILDER: NodeBuilder = {
  match: (value) => typeof value === 'function',
  build: (value, options) => {
    const handler = value as FunctionNodeHandler;
    const name = options.name ?? (handler as { name?: string }).name;
    if (!name) {
      throw new Error(
        'node(): the wrapped function has no name; pass {name} explicitly.'
      );
    }
    return new FunctionNode(name, handler, options);
  },
};

/** Builds a {@link ToolNode} from a {@link BaseTool}. */
export const TOOL_BUILDER: NodeBuilder = {
  match: (value) => isBaseTool(value),
  build: (value, options) => new ToolNode(value as BaseTool, options),
};

export const NODE_BUILDERS: readonly NodeBuilder[] = [
  FUNCTION_BUILDER,
  TOOL_BUILDER,
];

export const PARALLEL_WORKER_FACTORY: ParallelWorkerFactory = (
  inner,
  options
) => new ParallelWorker(inner, options);

export function wireDefaultNodeBuilders(): void {
  for (const builder of NODE_BUILDERS) {
    registerNodeBuilder(builder);
  }
  setParallelWorkerFactory(PARALLEL_WORKER_FACTORY);
}

wireDefaultNodeBuilders();
