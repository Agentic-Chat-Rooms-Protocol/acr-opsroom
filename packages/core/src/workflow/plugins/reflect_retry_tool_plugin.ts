/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Hyperfused into ACR OpsRoom Core from google/adk-js v2.4.0 (commit 8dad457)
 * `core/src/plugins/reflect_retry_tool_plugin.ts`.
 */

import { BaseTool, ToolContextShim } from '../shims.js';
import {
  REFLECT_AND_RETRY_RESPONSE_TYPE,
  resolveScopeKey,
  ScopedFailureTracker,
  ToolFailureResponse,
  TrackingScope,
} from './_reflect_retry_utils.js';
import { BasePlugin } from './base_plugin.js';

/**
 * Configuration options for ReflectAndRetryToolPlugin.
 */
export interface ReflectAndRetryToolPluginOptions {
  /**Plugin instance name. Defaults to 'reflect_retry_tool_plugin'.*/
  name?: string;
  /**
   * Maximum number of consecutive retries allowed per tool before giving up.
   * Must be a non-negative integer. Defaults to 3.
   */
  maxRetries?: number;
  /**
   * Whether to throw an exception if maxRetries is exceeded during `onToolErrorCallback`.
   * Defaults to true.
   */
  throwExceptionIfRetryExceeded?: boolean;
  /**
   * Scope for tracking failure counts. Defaults to `TrackingScope.INVOCATION`.
   */
  trackingScope?: TrackingScope;
}

/**
 * Provides self-healing, concurrent-safe error recovery for tool calls by
 * intercepting tool failures and guiding the LLM to reflect and retry.
 */
export class ReflectAndRetryToolPlugin extends BasePlugin {
  protected readonly maxRetries: number;
  protected readonly throwExceptionIfRetryExceeded: boolean;
  protected readonly trackingScope: TrackingScope;
  protected readonly tracker = new ScopedFailureTracker();

  constructor(options: ReflectAndRetryToolPluginOptions = {}) {
    super(options.name ?? 'reflect_retry_tool_plugin');

    const maxRetries = options.maxRetries ?? 3;
    if (maxRetries < 0 || !Number.isInteger(maxRetries)) {
      throw new Error(
        `maxRetries must be a non-negative integer, got: ${maxRetries}`
      );
    }

    this.maxRetries = maxRetries;
    this.throwExceptionIfRetryExceeded =
      options.throwExceptionIfRetryExceeded ?? true;
    this.trackingScope = options.trackingScope ?? TrackingScope.INVOCATION;
  }

  override async afterToolCallback({
    tool,
    toolArgs,
    toolContext,
    result,
  }: {
    tool: BaseTool;
    toolArgs: Record<string, unknown>;
    toolContext: ToolContextShim;
    result: Record<string, unknown>;
  }): Promise<Record<string, unknown> | undefined> {
    if (
      result &&
      typeof result === 'object' &&
      result['response_type'] === REFLECT_AND_RETRY_RESPONSE_TYPE
    ) {
      return undefined;
    }

    const scopeKey = resolveScopeKey(toolContext, this.trackingScope);

    return this.tracker.runLocked(scopeKey, async () => {
      const error = await this.extractErrorFromResult({
        tool,
        toolArgs,
        toolContext,
        result,
      });

      if (!error) {
        this.tracker.reset(scopeKey, tool.name);
        return undefined;
      }

      return this.handleToolError(
        scopeKey,
        tool,
        toolArgs,
        toolContext,
        error,
        false
      );
    });
  }

  override async onToolErrorCallback({
    tool,
    toolArgs,
    toolContext,
    error,
  }: {
    tool: BaseTool;
    toolArgs: Record<string, unknown>;
    toolContext: ToolContextShim;
    error: Error;
  }): Promise<Record<string, unknown> | undefined> {
    const scopeKey = resolveScopeKey(toolContext, this.trackingScope);

    return this.tracker.runLocked(scopeKey, async () => {
      return this.handleToolError(
        scopeKey,
        tool,
        toolArgs,
        toolContext,
        error,
        true
      );
    });
  }

  protected async extractErrorFromResult(_params: {
    tool: BaseTool;
    toolArgs: Record<string, unknown>;
    toolContext: ToolContextShim;
    result: Record<string, unknown>;
  }): Promise<unknown | undefined> {
    return undefined;
  }

  protected handleToolError(
    scopeKey: string,
    tool: BaseTool,
    toolArgs: Record<string, unknown>,
    _toolContext: ToolContextShim,
    error: unknown,
    isException: boolean
  ): Record<string, unknown> | undefined {
    if (this.maxRetries === 0) {
      if (isException && this.throwExceptionIfRetryExceeded) {
        throw error instanceof Error ? error : new Error(String(error));
      }
      return this.createToolReflectionExhaustedResponse(
        tool,
        toolArgs,
        error,
        0
      );
    }

    const retryCount = this.tracker.increment(scopeKey, tool.name);

    if (retryCount > this.maxRetries) {
      this.tracker.reset(scopeKey, tool.name);
      if (isException && this.throwExceptionIfRetryExceeded) {
        throw error instanceof Error ? error : new Error(String(error));
      }
      return this.createToolReflectionExhaustedResponse(
        tool,
        toolArgs,
        error,
        retryCount
      );
    }

    return this.createToolReflectionResponse(
      tool,
      toolArgs,
      error,
      retryCount
    );
  }

  protected createToolReflectionResponse(
    tool: BaseTool,
    toolArgs: Record<string, unknown>,
    error: unknown,
    retryCount: number
  ): ToolFailureResponse {
    const argsStr = JSON.stringify(toolArgs, null, 2);
    const errDetails = this.formatErrorDetails(error);
    const errType = error instanceof Error ? error.name : typeof error;

    const guidance = `The call to tool \`${tool.name}\` failed on attempt ${retryCount} of ${this.maxRetries}.

**Arguments Used:**
\`\`\`json
${argsStr}
\`\`\`

**Error Details:**
${errDetails}

**Reflection Guidance:**
1. Analyze the error message and the arguments you provided.
2. Check if any required parameters are missing, have the wrong type, or contain invalid values.
3. Verify if a prerequisite step or different tool needs to be called first.
4. Formulate a corrected tool call and try again. Do not repeat the exact same invalid call.`;

    return {
      response_type: REFLECT_AND_RETRY_RESPONSE_TYPE,
      error_type: errType,
      error_details: errDetails,
      retry_count: retryCount,
      reflection_guidance: guidance,
    };
  }

  protected createToolReflectionExhaustedResponse(
    tool: BaseTool,
    toolArgs: Record<string, unknown>,
    error: unknown,
    retryCount: number
  ): ToolFailureResponse {
    const argsStr = JSON.stringify(toolArgs, null, 2);
    const errDetails = this.formatErrorDetails(error);
    const errType = error instanceof Error ? error.name : typeof error;

    const guidance = `The call to tool \`${tool.name}\` has failed and the maximum retry limit (${this.maxRetries}) has been reached.

**Last Arguments Used:**
\`\`\`json
${argsStr}
\`\`\`

**Error Details:**
${errDetails}

**Action Required:**
Do **NOT** retry calling \`${tool.name}\` with the same approach. Either try an alternative tool/strategy to accomplish the goal, or inform the user clearly about the failure and why it could not be completed.`;

    return {
      response_type: REFLECT_AND_RETRY_RESPONSE_TYPE,
      error_type: errType,
      error_details: errDetails,
      retry_count: retryCount,
      reflection_guidance: guidance,
    };
  }

  protected formatErrorDetails(error: unknown): string {
    if (error instanceof Error) {
      return `${error.name}: ${error.message}`;
    }
    if (typeof error === 'string') {
      return error;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
}
