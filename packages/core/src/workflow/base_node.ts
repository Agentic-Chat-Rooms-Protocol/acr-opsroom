/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provenance: Lifted from `google/adk-js` (commit `8dad457`, v2.4.0)
 * `core/src/workflow/base_node.ts`.
 */

import { NodeSchemaValidationError } from './errors.js';
import type { NodeContext } from './node_context.js';
import { isRequestInput } from './request_input.js';
import {
  PreparedRetryConfig,
  prepareRetryConfig,
  RetryConfig,
} from './retry_config.js';
import {
  BaseTool,
  createEvent,
  Event,
  isContent,
  isEvent,
  parseWithSchema,
  SchemaLike,
  toContent,
} from './shims.js';
import { createRequestInputEvent } from './utils/hitl_utils.js';

const BASE_NODE_SIGNATURE_SYMBOL = Symbol.for('google.adk.workflow.baseNode');

export interface AsToolConfig {
  name?: string;
  description?: string;
}

type NodeToolFactory = (
  node: BaseNode<any, any>,
  config?: AsToolConfig
) => BaseTool;

let registeredNodeToolFactory: NodeToolFactory | undefined;

export function registerNodeToolFactory(factory: NodeToolFactory): void {
  registeredNodeToolFactory = factory;
}

export { isContent, toContent };

/**
 * Configuration shared by all workflow nodes.
 */
export interface BaseNodeConfig {
  /** Canonical, unique-within-a-graph node name. */
  name: string;
  /** Human-readable description (used when a node is exposed as a tool). */
  description?: string;
  /**
   * If true, the node re-executes when a workflow resumes even if it already
   * completed in a prior turn. Default false.
   */
  rerunOnResume?: boolean;
  /**
   * If true, the node only produces its output once all of its predecessors
   * have triggered it (fan-in / join semantics). Default false.
   */
  waitForOutput?: boolean;
  /** Optional retry configuration for transient failures. */
  retryConfig?: RetryConfig;
  /** Maximum time, in seconds, for this node to complete. */
  timeout?: number;
  /** Optional schema validating the node input. */
  inputSchema?: SchemaLike;
  /** Optional schema validating the node output. */
  outputSchema?: SchemaLike;
  /** Optional schema validating relevant session state. */
  stateSchema?: SchemaLike;
  /**
   * Runs this node's subtree in an isolated conversation scope.
   */
  isolationScope?: string | true;
  /**
   * ACR Extension 3 (`DurableCommandWal`): Marks whether this node performs
   * external mutations so `shouldRetryNode` never blindly retries on `NodeTimeoutError`.
   */
  sideEffecting?: boolean;
}

/**
 * Abstract base class for all nodes in an ADK / ACR workflow.
 */
export abstract class BaseNode<TInput = unknown, TOutput = unknown> {
  readonly [BASE_NODE_SIGNATURE_SYMBOL] = true;

  readonly name: string;
  readonly description: string;
  readonly rerunOnResume: boolean;
  readonly waitForOutput: boolean;
  readonly retryConfig?: RetryConfig;
  readonly preparedRetryConfig?: PreparedRetryConfig;
  readonly timeout?: number;
  readonly inputSchema?: SchemaLike;
  readonly outputSchema?: SchemaLike;
  readonly stateSchema?: SchemaLike;
  readonly isolationScope?: string | true;
  readonly sideEffecting: boolean;

  constructor(config: BaseNodeConfig) {
    if (
      !config.name ||
      typeof config.name !== 'string' ||
      config.name.trim().length === 0
    ) {
      throw new Error('Node name must be a non-empty string.');
    }
    this.name = config.name.trim();
    this.description = config.description ?? '';
    this.rerunOnResume = config.rerunOnResume ?? false;
    this.waitForOutput = config.waitForOutput ?? false;
    this.retryConfig = config.retryConfig;
    this.preparedRetryConfig = config.retryConfig
      ? prepareRetryConfig(config.retryConfig)
      : undefined;
    this.timeout = config.timeout;
    this.inputSchema = config.inputSchema;
    this.outputSchema = config.outputSchema;
    this.stateSchema = config.stateSchema;
    this.isolationScope = config.isolationScope;
    this.sideEffecting = config.sideEffecting ?? false;
  }

  /**
   * Whether this node must wait for ALL of its predecessors to trigger before
   * it runs (fan-in barrier). Overridden by `JoinNode`.
   */
  get requiresAllPredecessors(): boolean {
    return false;
  }

  /**
   * Exposes this node (or `Workflow`) as a callable `NodeTool` that propagates
   * `workflowId`, `graphTopologyHash`, scoped `nodePath`, interrupts, and
   * elevated `executionAuthority` across the tool boundary.
   */
  asTool(config?: AsToolConfig): BaseTool {
    if (!registeredNodeToolFactory) {
      throw new Error('NodeTool factory has not been registered.');
    }
    return registeredNodeToolFactory(this, config);
  }

  protected abstract runImpl(
    ctx: NodeContext,
    input: TInput
  ): AsyncGenerator<Event | TOutput | unknown, void, void>;

  async *run(
    ctx: NodeContext,
    input: TInput
  ): AsyncGenerator<Event, void, void> {
    const validatedInput = this.validateInput(input);
    for await (const item of this.runImpl(ctx, validatedInput)) {
      if (isRequestInput(item)) {
        yield createRequestInputEvent(item);
        continue;
      }
      const event = this.toEvent(ctx, item);
      if (event) {
        yield event;
      }
    }
  }

  protected validateInput(input: TInput): TInput {
    if (isContent(input)) {
      return input;
    }
    try {
      return parseWithSchema(this.inputSchema, input);
    } catch (e) {
      throw new NodeSchemaValidationError({
        nodeName: this.name,
        direction: 'input',
        cause: e,
      });
    }
  }

  protected validateOutput(output: unknown): unknown {
    if (isContent(output)) {
      return output;
    }
    try {
      return parseWithSchema(this.outputSchema, output);
    } catch (e) {
      throw new NodeSchemaValidationError({
        nodeName: this.name,
        direction: 'output',
        cause: e,
      });
    }
  }

  protected toEvent(ctx: NodeContext, data: unknown): Event | null {
    if (data === null || data === undefined) {
      return null;
    }
    if (isEvent(data)) {
      const event = data as Event;
      if (event.output !== undefined) {
        event.output = this.validateOutput(event.output);
      }
      return event;
    }
    const output = this.validateOutput(data);
    return createEvent({
      author: this.name,
      invocationId: ctx.invocationContext.invocationId,
      branch: ctx.branch,
      content: toContent(output),
      output,
    });
  }
}

export function isBaseNode(value: unknown): value is BaseNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    BASE_NODE_SIGNATURE_SYMBOL in value &&
    (value as BaseNode)[BASE_NODE_SIGNATURE_SYMBOL] === true
  );
}

class StartNode extends BaseNode {
  // eslint-disable-next-line require-yield
  protected async *runImpl(): AsyncGenerator<Event, void, void> {
    throw new Error('START node is never executed.');
  }
}

/** The workflow entry-point sentinel node (name `__START__`). */
export const START: BaseNode = new StartNode({ name: '__START__' });
