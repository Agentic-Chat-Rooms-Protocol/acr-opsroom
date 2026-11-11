/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Hyperfused into ACR OpsRoom Core from google/adk-js v2.4.0 (commit 8dad457)
 * `core/src/plugins/tool_call_integrity_plugin.ts` using browser-safe
 * `crypto-compat.ts` (`hmacSha256Sync`, `timingSafeEqualHex`, `randomBytesHex`).
 */

import {
  hmacSha256Sync,
  randomUuidSync,
  timingSafeEqualHex,
} from '../../crypto-compat.js';
import {
  BaseTool,
  Event,
  FunctionCallPart,
  getFunctionCalls,
  InvocationContext,
  populateClientFunctionCallId,
  ToolContextShim,
  WorkflowContent,
} from '../shims.js';
import { BasePlugin } from './base_plugin.js';
import {
  INTERNAL_METADATA_PREFIX,
  RESTORED_EVENT_KEY,
} from './internal_metadata.js';

/**
 * Key in `Event.customMetadata` holding the map of `{ [functionCall.id]: hmac }`
 * signatures for function calls on that event.
 */
export const TOOL_CALL_HMAC_METADATA_KEY = `${INTERNAL_METADATA_PREFIX}fc_hmac`;

const SIGNATURE_VERSION_PREFIX = 'v1:';

/**
 * Error thrown when a tool call in session history fails integrity verification
 * (missing, malformed, or mismatched HMAC signature).
 */
export class ToolCallIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolCallIntegrityError';
  }
}

export interface ToolCallIntegrityPluginOptions {
  /**
   * Persistent HMAC secret key (string or Uint8Array). Defaults to a 32-byte
   * cryptographically random key per process when omitted.
   */
  secretKey?: string | Uint8Array;
  /**
   * If true (default), `beforeToolCallback` also verifies any matching
   * `functionCall` event in `session.events` immediately before tool/WAL
   * execution.
   */
  verifyBeforeToolExecution?: boolean;
}

let defaultProcessKey: string | undefined;
function getDefaultProcessKey(): string {
  if (!defaultProcessKey) {
    defaultProcessKey = `${randomUuidSync().replace(/-/g, '')}${randomUuidSync().replace(/-/g, '')}`;
  }
  return defaultProcessKey;
}

/**
 * Signs outgoing tool calls with HMAC-SHA256 and verifies tool calls in
 * session history before execution to prevent forged or tampered tool execution.
 */
export class ToolCallIntegrityPlugin extends BasePlugin {
  private readonly secretKey: string;
  private readonly verifyBeforeToolExecution: boolean;

  constructor(options: ToolCallIntegrityPluginOptions = {}) {
    super('adk_tool_call_integrity');
    const rawKey = options.secretKey ?? getDefaultProcessKey();
    this.secretKey =
      typeof rawKey === 'string'
        ? rawKey
        : Buffer.from(rawKey).toString('hex');
    this.verifyBeforeToolExecution = options.verifyBeforeToolExecution ?? true;
  }

  /**
   * Signs all `functionCall` parts on `event` in-place and returns `event`.
   */
  signEvent(invocationContext: InvocationContext, event: Event): Event {
    populateClientFunctionCallId(event);
    const functionCalls = getFunctionCalls(event);
    if (functionCalls.length === 0) {
      return event;
    }

    const existing = event.customMetadata?.[TOOL_CALL_HMAC_METADATA_KEY];
    const hmacs: Record<string, string> = isStringRecord(existing)
      ? { ...existing }
      : {};

    for (const fc of functionCalls) {
      if (!fc.id) {
        throw new ToolCallIntegrityError(
          `Cannot sign tool call '${fc.name}' on event '${event.id}': missing functionCall.id.`
        );
      }
      if (hmacs[fc.id]) {
        continue;
      }
      hmacs[fc.id] = this.computeSignature(invocationContext, event, fc);
    }

    event.customMetadata = {
      ...event.customMetadata,
      [TOOL_CALL_HMAC_METADATA_KEY]: hmacs,
    };
    return event;
  }

  /**
   * Verifies all `functionCall` parts on `event`, throwing `ToolCallIntegrityError`
   * on any missing, malformed, or tampered signature.
   */
  verifyEvent(invocationContext: InvocationContext, event: Event): void {
    const functionCalls = getFunctionCalls(event);
    if (functionCalls.length === 0) {
      return;
    }

    const hmacs = event.customMetadata?.[TOOL_CALL_HMAC_METADATA_KEY];
    if (!isStringRecord(hmacs)) {
      this.recordViolation(invocationContext, event, 'missing HMAC metadata');
      throw new ToolCallIntegrityError(
        `Tool call integrity check failed for event '${event.id}': missing HMAC metadata.`
      );
    }

    for (const fc of functionCalls) {
      if (!fc.id) {
        this.recordViolation(
          invocationContext,
          event,
          `tool call '${fc.name}' is missing an id`
        );
        throw new ToolCallIntegrityError(
          `Tool call integrity check failed for event '${event.id}': tool call '${fc.name}' is missing an id.`
        );
      }
      const actual = hmacs[fc.id];
      if (
        typeof actual !== 'string' ||
        !actual.startsWith(SIGNATURE_VERSION_PREFIX)
      ) {
        this.recordViolation(
          invocationContext,
          event,
          `missing or malformed signature for tool call '${fc.name}' (id='${fc.id}')`
        );
        throw new ToolCallIntegrityError(
          `Tool call integrity check failed for tool call '${fc.name}' (id='${fc.id}') on event '${event.id}': missing or malformed signature.`
        );
      }
      const expected = this.computeSignature(invocationContext, event, fc);
      const actualHex = actual.slice(SIGNATURE_VERSION_PREFIX.length);
      const expectedHex = expected.slice(SIGNATURE_VERSION_PREFIX.length);

      if (!timingSafeEqualHex(actualHex, expectedHex)) {
        this.recordViolation(
          invocationContext,
          event,
          `signature mismatch for tool call '${fc.name}' (id='${fc.id}')`
        );
        throw new ToolCallIntegrityError(
          `Tool call integrity check failed for tool call '${fc.name}' (id='${fc.id}') on event '${event.id}': signature mismatch.`
        );
      }
    }
  }

  override async beforeRunCallback({
    invocationContext,
  }: {
    invocationContext: InvocationContext;
  }): Promise<WorkflowContent | undefined> {
    for (const event of invocationContext.session.events) {
      if (event.customMetadata?.[RESTORED_EVENT_KEY] !== true) {
        continue;
      }
      this.verifyEvent(invocationContext, event);
    }
    return undefined;
  }

  override async onEventCallback({
    invocationContext,
    event,
  }: {
    invocationContext: InvocationContext;
    event: Event;
  }): Promise<Event | undefined> {
    if (event.partial) {
      return undefined;
    }
    const functionCalls = getFunctionCalls(event);
    if (functionCalls.length === 0) {
      return undefined;
    }
    return this.signEvent(invocationContext, event);
  }

  override async beforeToolCallback({
    tool,
    toolArgs,
    toolContext,
  }: {
    tool: BaseTool;
    toolArgs: Record<string, unknown>;
    toolContext: ToolContextShim;
  }): Promise<Record<string, unknown> | undefined> {
    if (!this.verifyBeforeToolExecution) {
      return undefined;
    }

    const ic = toolContext.invocationContext;
    const events = ic.session?.events ?? [];
    let matchedEvent: Event | undefined;
    let matchedCall: FunctionCallPart | undefined;

    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      const calls = getFunctionCalls(ev);
      for (const fc of calls) {
        if (toolContext.functionCallId && fc.id === toolContext.functionCallId) {
          matchedEvent = ev;
          matchedCall = fc;
          break;
        }
      }
      if (matchedEvent) {
        break;
      }
    }

    if (!matchedEvent) {
      for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i];
        const calls = getFunctionCalls(ev);
        for (const fc of calls) {
          if (fc.name === tool.name) {
            matchedEvent = ev;
            matchedCall = fc;
            break;
          }
        }
        if (matchedEvent) {
          break;
        }
      }
    }

    if (matchedEvent && matchedCall) {
      this.verifyEvent(ic, matchedEvent);
      const signedArgsCanon = canonicalizeJson(matchedCall.args ?? {});
      const actualArgsCanon = canonicalizeJson(toolArgs ?? {});
      if (signedArgsCanon !== actualArgsCanon) {
        this.recordViolation(
          ic,
          matchedEvent,
          `toolArgs tampered after signing for tool '${tool.name}'`
        );
        throw new ToolCallIntegrityError(
          `Tool call integrity check failed for tool call '${tool.name}' (id='${matchedCall.id}'): toolArgs do not match signed functionCall.args.`
        );
      }
    }

    return undefined;
  }

  computeSignature(
    invocationContext: InvocationContext,
    event: Event,
    fc: FunctionCallPart
  ): string {
    const payload = canonicalizeJson({
      app_name: invocationContext.session.appName ?? 'acr-opsroom',
      user_id: invocationContext.session.userId ?? 'acr-operator',
      session_id: invocationContext.session.id,
      invocation_id: event.invocationId,
      branch: event.branch ?? null,
      author: event.author ?? null,
      name: fc.name ?? null,
      id: fc.id ?? null,
      args: fc.args ?? {},
    });
    const digest = hmacSha256Sync(this.secretKey, payload);
    return `${SIGNATURE_VERSION_PREFIX}${digest}`;
  }

  private recordViolation(
    invocationContext: InvocationContext,
    event: Event,
    reason: string
  ): void {
    if (invocationContext.auditLedger) {
      invocationContext.auditLedger.appendBlock(
        invocationContext.session.id,
        'TOOL_CALL_INTEGRITY_VIOLATION',
        `plugin:${this.name}`,
        {
          eventId: event.id,
          invocationId: event.invocationId,
          author: event.author,
          reason,
        }
      );
    }
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((v) => typeof v === 'string');
}

function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJson).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalizeJson(v)}`);
  return `{${entries.join(',')}}`;
}
