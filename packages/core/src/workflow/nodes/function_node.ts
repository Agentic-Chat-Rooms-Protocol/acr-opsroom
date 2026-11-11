/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provenance: Lifted from `google/adk-js` (commit `8dad457`, v2.4.0)
 * `core/src/workflow/nodes/function_node.ts`.
 */

import { BaseNode, BaseNodeConfig, isContent, toContent } from '../base_node.js';
import { NodeContext } from '../node_context.js';
import { isRequestInput, RequestInput } from '../request_input.js';
import { AuthConfig, createEvent, Event, isEvent } from '../shims.js';
import { carryDeltaStamp } from '../state_write_order.js';
import {
  createAuthRequestEvent,
  hasAuthCredential,
  processAuthResume,
} from '../utils/hitl_utils.js';

/**
 * A value a {@link FunctionNodeHandler} may return or yield.
 */
export type FunctionNodeReturnItem<TOutput = unknown> =
  | TOutput
  | Event
  | RequestInput
  | null
  | undefined
  | void;

export type FunctionNodeResult<TOutput = unknown> =
  FunctionNodeReturnItem<TOutput>;

/**
 * The handler wrapped by a {@link FunctionNode}.
 */
export type FunctionNodeHandler<TInput = unknown, TOutput = unknown> = (
  ctx: NodeContext,
  input: TInput
) =>
  | FunctionNodeResult<TOutput>
  | Promise<FunctionNodeResult<TOutput>>
  | Generator<FunctionNodeResult<TOutput>, void, unknown>
  | AsyncGenerator<FunctionNodeResult<TOutput>, void, unknown>;

/**
 * Options for a {@link FunctionNode}.
 */
export interface FunctionNodeConfig
  extends Partial<Omit<BaseNodeConfig, 'name'>> {
  name?: string;
  authConfig?: AuthConfig;
}

/**
 * A node that wraps a plain function, async function, or (sync/async) generator.
 */
export class FunctionNode<TInput = unknown, TOutput = unknown> extends BaseNode<
  TInput,
  TOutput
> {
  readonly authConfig?: AuthConfig;
  private readonly handler: FunctionNodeHandler<TInput, TOutput>;
  private readonly attachedStateByCtx = new WeakMap<
    NodeContext,
    Map<string, unknown>
  >();

  constructor(
    nameOrConfig:
      | string
      | (FunctionNodeConfig & {
          name: string;
          handler: FunctionNodeHandler<TInput, TOutput>;
        }),
    handler?: FunctionNodeHandler<TInput, TOutput>,
    config: FunctionNodeConfig = {}
  ) {
    if (typeof nameOrConfig === 'object' && nameOrConfig !== null) {
      const { name, handler: fn, ...rest } = nameOrConfig;
      if (typeof fn !== 'function') {
        throw new TypeError('FunctionNode handler must be a function.');
      }
      super({ ...rest, name });
      this.handler = fn;
      this.authConfig = rest.authConfig;
      return;
    }

    if (typeof handler !== 'function') {
      throw new TypeError('FunctionNode handler must be a function.');
    }
    super({ ...config, name: nameOrConfig });
    this.handler = handler;
    this.authConfig = config.authConfig;
  }

  protected async *runImpl(
    ctx: NodeContext,
    input: TInput
  ): AsyncGenerator<Event | TOutput | unknown, void, void> {
    if (this.authConfig) {
      const authRequest = await this.runAuthGate(ctx);
      if (authRequest) {
        yield authRequest;
        return;
      }
    }

    const result = this.handler(ctx, input);

    if (isAsyncIterable(result)) {
      for await (const item of result) {
        yield item;
      }
    } else if (isSyncGenerator(result)) {
      for (const item of result) {
        yield item;
      }
    } else {
      yield await (result as Promise<FunctionNodeResult<TOutput>>);
    }

    yield undefined;
  }

  private async runAuthGate(ctx: NodeContext): Promise<Event | undefined> {
    const authConfig = this.authConfig!;
    if (hasAuthCredential(authConfig, ctx.state)) {
      return undefined;
    }
    const resumeResponse = ctx.resumeInputs[authConfig.credentialKey];
    if (resumeResponse !== undefined) {
      await processAuthResume({
        responseData: resumeResponse,
        authConfig,
        state: ctx.state,
      });
      if (hasAuthCredential(authConfig, ctx.state)) {
        return undefined;
      }
    }
    return createAuthRequestEvent(authConfig, authConfig.credentialKey);
  }

  private pendingStateDelta(
    ctx: NodeContext
  ): Record<string, unknown> | undefined {
    let shadow = this.attachedStateByCtx.get(ctx);
    if (!shadow) {
      shadow = new Map<string, unknown>();
      this.attachedStateByCtx.set(ctx, shadow);
    }
    const delta: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(ctx.actions.stateDelta)) {
      if (!shadow.has(key) || shadow.get(key) !== value) {
        delta[key] = value;
        shadow.set(key, value);
        carryDeltaStamp(ctx.actions.stateDelta, delta, key);
      }
    }
    return Object.keys(delta).length > 0 ? delta : undefined;
  }

  private applyEmittedState(
    ctx: NodeContext,
    delta: Record<string, unknown> | undefined
  ): void {
    if (!delta || Object.keys(delta).length === 0) {
      return;
    }
    ctx.state.update(delta);
    const shadow = this.attachedStateByCtx.get(ctx);
    if (shadow) {
      for (const [key, value] of Object.entries(delta)) {
        shadow.set(key, value);
      }
    }
  }

  protected override toEvent(ctx: NodeContext, data: unknown): Event | null {
    if (isRequestInput(data)) {
      return null;
    }
    const stateDelta = this.pendingStateDelta(ctx);

    if (data === null || data === undefined) {
      return stateDelta
        ? createEvent({
            author: this.name,
            invocationId: ctx.invocationId,
            branch: ctx.branch,
            actions: { stateDelta },
          })
        : null;
    }

    if (isEvent(data)) {
      const event = data as Event;
      if (event.output !== undefined) {
        event.output = this.validateOutput(event.output);
      }
      if (stateDelta) {
        event.actions.stateDelta = {
          ...stateDelta,
          ...event.actions.stateDelta,
        };
      }
      this.applyEmittedState(ctx, event.actions.stateDelta);
      return event;
    }

    if (isContent(data)) {
      return createEvent({
        author: this.name,
        invocationId: ctx.invocationId,
        branch: ctx.branch,
        content: data,
        actions: stateDelta ? { stateDelta } : undefined,
      });
    }

    const output = this.validateOutput(data);
    return createEvent({
      author: this.name,
      invocationId: ctx.invocationId,
      branch: ctx.branch,
      content: toContent(output),
      output,
      actions: stateDelta ? { stateDelta } : undefined,
    });
  }
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    value != null &&
    typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] ===
      'function'
  );
}

function isSyncGenerator(value: unknown): value is Generator<unknown> {
  return (
    value != null &&
    typeof (value as Iterable<unknown>)[Symbol.iterator] === 'function' &&
    typeof (value as Generator<unknown>).next === 'function'
  );
}
