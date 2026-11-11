/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * ACR Hyperfusion Extension: WalGuardedReflectRetryPlugin.
 * Combines ADK's self-healing LLM ReflectAndRetryToolPlugin for pre-dispatch
 * schema/validation and read-only tool errors with DurableCommandWal inspection
 * so already-dispatched side-effecting calls ('DISPATCHED' / 'OUTCOME_UNKNOWN')
 * are never blindly retried by the LLM.
 */

import {
  DurableCommandRecord,
  DurableCommandWal,
} from '../../playbooks/playbook_runner.js';
import { BaseTool, ToolContextShim } from '../shims.js';
import {
  ReflectAndRetryToolPlugin,
  ReflectAndRetryToolPluginOptions,
} from './reflect_retry_tool_plugin.js';

export const SIDE_EFFECT_RECONCILIATION_REQUIRED_TYPE =
  'SIDE_EFFECT_RECONCILIATION_REQUIRED';

export interface WalGuardedReflectRetryPluginOptions
  extends ReflectAndRetryToolPluginOptions {
  /**
   * Durable write-ahead log inspected before permitting any LLM reflection
   * retry on a failed tool call.
   */
  wal?: DurableCommandWal<unknown>;
  /**
   * Optional set or list of tool names explicitly classified as side-effecting.
   */
  sideEffectingTools?: Iterable<string>;
  /**
   * Whether a tool result object containing `{ error: string }` or
   * `{ isError: true }` should also trigger reflection (when not blocked by WAL).
   * Defaults to true.
   */
  treatResultErrorFieldAsFailure?: boolean;
}

export interface WalReconciliationBlockedResponse {
  response_type: typeof SIDE_EFFECT_RECONCILIATION_REQUIRED_TYPE;
  error_type: 'SIDE_EFFECT_OUTCOME_UNKNOWN';
  error_details: string;
  command_id?: string;
  idempotency_key?: string;
  wal_state: string;
  retry_blocked: true;
  blind_retry_blocked: true;
  reconciliation_guidance: string;
  [key: string]: unknown;
}

/**
 * WAL-Guarded LLM Reflection & Retry Plugin.
 *
 * - Permits up to `maxRetries` self-healing LLM reflection retries when a tool
 *   fails *before* external dispatch (e.g. schema validation, missing parameter,
 *   or read-only query error).
 * - Blocks LLM reflection retries immediately if `DurableCommandWal` shows the
 *   command was already `'DISPATCHED'` or is in `'OUTCOME_UNKNOWN'`, returning
 *   a deterministic `SIDE_EFFECT_RECONCILIATION_REQUIRED` payload instead of
 *   prompting the LLM to re-invoke the mutating tool.
 */
export class WalGuardedReflectRetryPlugin extends ReflectAndRetryToolPlugin {
  readonly wal?: DurableCommandWal<unknown>;
  private readonly sideEffectingTools: Set<string>;
  private readonly treatResultErrorFieldAsFailure: boolean;

  constructor(options: WalGuardedReflectRetryPluginOptions = {}) {
    super({
      ...options,
      name: options.name ?? 'wal_guarded_reflect_retry_plugin',
    });
    this.wal = options.wal;
    this.sideEffectingTools = new Set(options.sideEffectingTools ?? []);
    this.treatResultErrorFieldAsFailure =
      options.treatResultErrorFieldAsFailure ?? true;
  }

  protected override async extractErrorFromResult({
    result,
  }: {
    tool: BaseTool;
    toolArgs: Record<string, unknown>;
    toolContext: ToolContextShim;
    result: Record<string, unknown>;
  }): Promise<unknown | undefined> {
    if (!this.treatResultErrorFieldAsFailure || !result) {
      return undefined;
    }
    if (
      result['response_type'] === SIDE_EFFECT_RECONCILIATION_REQUIRED_TYPE
    ) {
      return undefined;
    }
    if (typeof result['error'] === 'string' && result['error'].length > 0) {
      return result['error'];
    }
    if (result['isError'] === true) {
      return result['message'] ?? result['error'] ?? 'Tool returned isError=true';
    }
    return undefined;
  }

  protected override handleToolError(
    scopeKey: string,
    tool: BaseTool,
    toolArgs: Record<string, unknown>,
    toolContext: ToolContextShim,
    error: unknown,
    isException: boolean
  ): Record<string, unknown> | undefined {
    const dispatchedRecord = this.findDispatchedWalRecord(
      tool,
      toolArgs,
      toolContext
    );
    const nodeCtx = toolContext.nodeContext as
      | { sideEffectDispatched?: boolean }
      | undefined;

    if (dispatchedRecord || nodeCtx?.sideEffectDispatched === true) {
      this.tracker.reset(scopeKey, tool.name);
      const errDetails = this.formatErrorDetails(error);
      const walState = dispatchedRecord?.state ?? 'OUTCOME_UNKNOWN';

      if (toolContext.invocationContext?.auditLedger) {
        toolContext.invocationContext.auditLedger.appendBlock(
          toolContext.invocationContext.session.id,
          'SIDE_EFFECT_RECONCILIATION_REQUIRED',
          `plugin:${this.name}`,
          {
            toolName: tool.name,
            commandId: dispatchedRecord?.command_id,
            idempotencyKey: dispatchedRecord?.idempotency_key,
            walState,
            errorDetails: errDetails,
          }
        );
      }

      const blockedResponse: WalReconciliationBlockedResponse = {
        response_type: SIDE_EFFECT_RECONCILIATION_REQUIRED_TYPE,
        error_type: 'SIDE_EFFECT_OUTCOME_UNKNOWN',
        error_details: errDetails,
        ...(dispatchedRecord?.command_id
          ? { command_id: dispatchedRecord.command_id }
          : {}),
        ...(dispatchedRecord?.idempotency_key
          ? { idempotency_key: dispatchedRecord.idempotency_key }
          : {}),
        wal_state: walState,
        retry_blocked: true,
        blind_retry_blocked: true,
        reconciliation_guidance:
          `External side-effecting tool \`${tool.name}\` was already recorded as \`${walState}\` in DurableCommandWal. ` +
          `Blind LLM reflection retry is strictly blocked to prevent duplicate execution. ` +
          `Transition to deterministic WAL reconciliation instead of calling \`${tool.name}\` again.`,
      };
      return blockedResponse;
    }

    return super.handleToolError(
      scopeKey,
      tool,
      toolArgs,
      toolContext,
      error,
      isException
    );
  }

  private findDispatchedWalRecord(
    tool: BaseTool,
    toolArgs: Record<string, unknown>,
    toolContext: ToolContextShim
  ): DurableCommandRecord<unknown> | undefined {
    if (!this.wal) {
      return undefined;
    }
    const explicitCommandId =
      typeof toolArgs['commandId'] === 'string'
        ? toolArgs['commandId']
        : toolContext.functionCallId;

    return this.wal.findDispatchedOrUnknownRecord({
      commandId: explicitCommandId,
      toolName: tool.name,
    });
  }
}
