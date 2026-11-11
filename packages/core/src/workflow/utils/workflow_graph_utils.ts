/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provenance: Lifted from `google/adk-js` (commit `8dad457`, v2.4.0)
 * `core/src/workflow/utils/workflow_graph_utils.ts`.
 */

import { BaseNode, isBaseNode, START } from '../base_node.js';
import { NodeLike } from '../graph.js';
import { prepareRetryConfig, RetryConfig } from '../retry_config.js';
import { AuthConfig, SchemaLike } from '../shims.js';

/**
 * Property overrides applied when building a node from a {@link NodeLike}.
 */
export interface BuildNodeOptions {
  name?: string;
  description?: string;
  rerunOnResume?: boolean;
  retryConfig?: RetryConfig;
  timeout?: number;
  inputSchema?: SchemaLike;
  outputSchema?: SchemaLike;
  stateSchema?: SchemaLike;
  authConfig?: AuthConfig;
  /** Runs the node's subtree in an isolated conversation scope. */
  isolationScope?: string | true;
  /** If true, wrap the built node in a parallel worker. */
  parallelWorker?: boolean;
  /** Concurrency limit for the parallel worker (requires `parallelWorker`). */
  maxParallelWorkers?: number;
  /** ACR Extension 3: Marks whether this node performs external mutations. */
  sideEffecting?: boolean;
}

/**
 * Converts a matched {@link NodeLike} value into a concrete {@link BaseNode}.
 */
export interface NodeBuilder {
  match(value: unknown): boolean;
  build(value: NodeLike, options: BuildNodeOptions): BaseNode;
}

/**
 * Wraps an already-built node in a parallel worker.
 */
export type ParallelWorkerFactory = (
  inner: BaseNode,
  options: { maxParallelWorkers?: number }
) => BaseNode;

const registeredBuilders: NodeBuilder[] = [];
let parallelWorkerFactory: ParallelWorkerFactory | undefined;

export function registerNodeBuilder(builder: NodeBuilder): void {
  if (!registeredBuilders.includes(builder)) {
    registeredBuilders.push(builder);
  }
}

export function setParallelWorkerFactory(factory: ParallelWorkerFactory): void {
  parallelWorkerFactory = factory;
}

/**
 * Returns whether a value is a plain object literal (a `RoutingMap`) rather than
 * a class instance such as a node/tool/agent.
 */
export function isPlainObject(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Returns whether a value can be converted into a workflow node via
 * {@link buildNode}.
 */
export function isNodeLike(value: unknown): value is NodeLike {
  return (
    value === 'START' ||
    isBaseNode(value) ||
    typeof value === 'function' ||
    registeredBuilders.some((builder) => builder.match(value))
  );
}

/**
 * Converts a {@link NodeLike} into a concrete {@link BaseNode}.
 */
export function buildNode(
  nodeLike: NodeLike,
  options: BuildNodeOptions = {}
): BaseNode {
  if (options.maxParallelWorkers !== undefined && !options.parallelWorker) {
    throw new Error(
      'maxParallelWorkers can only be set when parallelWorker is true.'
    );
  }

  const built = buildInnerNode(nodeLike, options);

  if (options.parallelWorker) {
    if (nodeLike === 'START') {
      throw new Error('ParallelWorker cannot wrap a START node.');
    }
    if (!parallelWorkerFactory) {
      throw new Error(
        'parallelWorker was requested but no ParallelWorker is available.'
      );
    }
    return parallelWorkerFactory(built, {
      maxParallelWorkers: options.maxParallelWorkers,
    });
  }
  return built;
}

function buildInnerNode(
  nodeLike: NodeLike,
  options: BuildNodeOptions
): BaseNode {
  if (nodeLike === 'START') {
    return START;
  }
  if (isBaseNode(nodeLike)) {
    return cloneWithOverrides(nodeLike, options);
  }
  for (const builder of registeredBuilders) {
    if (builder.match(nodeLike)) {
      return builder.build(nodeLike, options);
    }
  }
  throw new Error(
    `build_node: unsupported node-like value of type ${typeof nodeLike}.`
  );
}

const OVERRIDABLE_KEYS = [
  'name',
  'description',
  'rerunOnResume',
  'retryConfig',
  'timeout',
  'inputSchema',
  'outputSchema',
  'stateSchema',
  'isolationScope',
  'sideEffecting',
] as const satisfies ReadonlyArray<keyof BuildNodeOptions & keyof BaseNode>;

const NODE_DECLARED_KEYS = ['authConfig'] as const satisfies ReadonlyArray<
  Exclude<keyof BuildNodeOptions, keyof BaseNode>
>;

function cloneWithOverrides(
  node: BaseNode,
  options: BuildNodeOptions
): BaseNode {
  const overrides: Record<string, unknown> = {};
  for (const key of OVERRIDABLE_KEYS) {
    if (options[key] !== undefined) {
      overrides[key] = options[key];
    }
  }
  for (const key of NODE_DECLARED_KEYS) {
    if (options[key] !== undefined && key in node) {
      overrides[key] = options[key];
    }
  }
  if (Object.keys(overrides).length === 0) {
    return node;
  }

  if (typeof overrides['name'] === 'string') {
    const name = overrides['name'].trim();
    if (!name) {
      throw new Error('Node name must be a non-empty string.');
    }
    overrides['name'] = name;
  }

  const clone = Object.create(
    Object.getPrototypeOf(node) as object
  ) as BaseNode;
  Object.assign(clone, node, overrides);
  if ('retryConfig' in overrides) {
    Object.assign(clone, {
      preparedRetryConfig: clone.retryConfig
        ? prepareRetryConfig(clone.retryConfig)
        : undefined,
    });
  }
  return clone;
}
