/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Hyperfused into ACR OpsRoom Core from google/adk-js v2.4.0 (commit 8dad457)
 * `core/src/plugins/reflect_retry_model_plugin.ts`.
 */

import {
  REFLECT_AND_RETRY_RESPONSE_TYPE,
  ScopedFailureTracker,
  TrackingScope,
} from './_reflect_retry_utils.js';
import { BasePlugin, LlmRequestShim, LlmResponseShim } from './base_plugin.js';

export const ADK_HANDLE_MODEL_ERROR_TOOL_NAME = 'adk_handle_model_error';
export const RESERVED_TOOL_CALL_ERROR_TYPE =
  'RESERVED_MODEL_ERROR_TOOL_CALLED';

/**
 * FinishReason enum mirroring @google/genai without external runtime dependency.
 */
export enum FinishReason {
  FINISH_REASON_UNSPECIFIED = 'FINISH_REASON_UNSPECIFIED',
  STOP = 'STOP',
  MAX_TOKENS = 'MAX_TOKENS',
  SAFETY = 'SAFETY',
  RECITATION = 'RECITATION',
  LANGUAGE = 'LANGUAGE',
  OTHER = 'OTHER',
  BLOCKLIST = 'BLOCKLIST',
  PROHIBITED_CONTENT = 'PROHIBITED_CONTENT',
  SPII = 'SPII',
  MALFORMED_FUNCTION_CALL = 'MALFORMED_FUNCTION_CALL',
  IMAGE_SAFETY = 'IMAGE_SAFETY',
  UNEXPECTED_TOOL_CALL = 'UNEXPECTED_TOOL_CALL',
}

export const DEFAULT_HANDLED_FINISH_REASONS: ReadonlySet<string> = new Set([
  FinishReason.MALFORMED_FUNCTION_CALL,
  FinishReason.UNEXPECTED_TOOL_CALL,
]);

export interface ReflectAndRetryModelPluginOptions {
  name?: string;
  maxRetries?: number;
  trackingScope?: TrackingScope;
  handledFinishReasons?: Set<string>;
}

/**
 * Provides self-healing recovery for model-level tool generation errors
 * (e.g. `MALFORMED_FUNCTION_CALL` or `UNEXPECTED_TOOL_CALL`).
 */
export class ReflectAndRetryModelPlugin extends BasePlugin {
  private readonly maxRetries: number;
  private readonly trackingScope: TrackingScope;
  private readonly handledFinishReasons: ReadonlySet<string>;
  private readonly tracker = new ScopedFailureTracker();

  constructor(options: ReflectAndRetryModelPluginOptions = {}) {
    super(options.name ?? 'reflect_retry_model_plugin');
    const maxRetries = options.maxRetries ?? 3;
    if (maxRetries < 0 || !Number.isInteger(maxRetries)) {
      throw new Error(
        `maxRetries must be a non-negative integer, got: ${maxRetries}`
      );
    }
    this.maxRetries = maxRetries;
    this.trackingScope = options.trackingScope ?? TrackingScope.INVOCATION;
    this.handledFinishReasons =
      options.handledFinishReasons ?? DEFAULT_HANDLED_FINISH_REASONS;
  }

  override async beforeModelCallback({
    llmRequest,
  }: {
    callbackContext: { invocationId?: string; session?: { id?: string } };
    llmRequest: LlmRequestShim;
  }): Promise<LlmResponseShim | undefined> {
    if (!llmRequest.contents || llmRequest.contents.length === 0) {
      return undefined;
    }

    for (let i = 0; i < llmRequest.contents.length; i++) {
      const content = llmRequest.contents[i];
      if (content.role === 'model' && content.parts) {
        for (const part of content.parts) {
          if (part.functionCall?.name === ADK_HANDLE_MODEL_ERROR_TOOL_NAME) {
            const args = part.functionCall.args as
              | Record<string, unknown>
              | undefined;
            if (args?.['__adk_synthetic_error__'] === true) {
              const guidance =
                (args['reflection_guidance'] as string) ??
                'Please fix the malformed function call and try again.';
              llmRequest.contents[i] = {
                role: 'user',
                parts: [{ text: guidance }],
              };
            }
          }
        }
      }
    }

    return undefined;
  }

  override async afterModelCallback({
    callbackContext,
    llmResponse,
  }: {
    callbackContext: { invocationId?: string; session?: { id?: string } };
    llmResponse: LlmResponseShim;
  }): Promise<LlmResponseShim | undefined> {
    const scopeKey =
      this.trackingScope === TrackingScope.INVOCATION
        ? (callbackContext.invocationId ?? '__global_model_scope__')
        : '__global_model_scope__';
    const itemKey = 'model_generation';

    return this.tracker.runLocked(scopeKey, async () => {
      if (llmResponse.content?.parts) {
        for (const part of llmResponse.content.parts) {
          if (part.functionCall?.name === ADK_HANDLE_MODEL_ERROR_TOOL_NAME) {
            const args = part.functionCall.args as
              | Record<string, unknown>
              | undefined;
            if (args?.['__adk_synthetic_error__'] !== true) {
              return this.handleModelFailure(
                scopeKey,
                itemKey,
                RESERVED_TOOL_CALL_ERROR_TYPE,
                `The model attempted to call reserved internal tool "${ADK_HANDLE_MODEL_ERROR_TOOL_NAME}".`
              );
            }
          }
        }
      }

      if (
        llmResponse.finishReason &&
        this.handledFinishReasons.has(llmResponse.finishReason)
      ) {
        const details =
          llmResponse.errorMessage ??
          `Model generation stopped with finishReason: ${llmResponse.finishReason}`;
        return this.handleModelFailure(
          scopeKey,
          itemKey,
          llmResponse.finishReason,
          details
        );
      }

      this.tracker.reset(scopeKey, itemKey);
      return undefined;
    });
  }

  private handleModelFailure(
    scopeKey: string,
    itemKey: string,
    errorType: string,
    errorDetails: string
  ): LlmResponseShim | undefined {
    if (this.maxRetries === 0) {
      return undefined;
    }

    const retryCount = this.tracker.increment(scopeKey, itemKey);
    if (retryCount > this.maxRetries) {
      this.tracker.reset(scopeKey, itemKey);
      return undefined;
    }

    const guidance = `[System Error Recovery - Attempt ${retryCount} of ${this.maxRetries}]
Your previous response failed with error type \`${errorType}\`:
${errorDetails}

**Reflection Guidance:**
1. Review the tool declarations and ensure the function name and JSON arguments are valid.
2. Do not call reserved internal tools.
3. Please formulate a valid response or tool call now.`;

    return {
      content: {
        role: 'model',
        parts: [
          {
            functionCall: {
              name: ADK_HANDLE_MODEL_ERROR_TOOL_NAME,
              args: {
                __adk_synthetic_error__: true,
                response_type: REFLECT_AND_RETRY_RESPONSE_TYPE,
                error_type: errorType,
                error_details: errorDetails,
                retry_count: retryCount,
                reflection_guidance: guidance,
              },
            },
          },
        ],
      },
      finishReason: FinishReason.STOP,
    };
  }
}
