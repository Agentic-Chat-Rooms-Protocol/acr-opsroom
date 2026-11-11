/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Hyperfused into ACR OpsRoom Core from google/adk-js v2.4.0 (commit 8dad457)
 * `core/src/plugins/_reflect_retry_utils.ts`.
 */

import { ToolContextShim } from '../shims.js';

export const REFLECT_AND_RETRY_RESPONSE_TYPE =
  'ERROR_HANDLED_BY_REFLECT_AND_RETRY_PLUGIN';
export const GLOBAL_SCOPE_KEY = '__global_reflect_and_retry_scope__';

/**
 * Defines the lifecycle scope for tracking failures.
 */
export enum TrackingScope {
  INVOCATION = 'invocation',
  GLOBAL = 'global',
}

/**
 * Structured response injected into the conversation history when a tool fails,
 * prompting the model to reflect on the error and retry.
 */
export interface ToolFailureResponse {
  response_type: string;
  error_type: string;
  error_details: string;
  retry_count: number;
  reflection_guidance: string;
  [key: string]: unknown;
}

/**
 * Resolves the tracking key based on the configured scope and current context.
 */
export function resolveScopeKey(
  context:
    | ToolContextShim
    | { invocationId?: string; invocationContext?: { invocationId: string } },
  trackingScope: TrackingScope
): string {
  if (trackingScope === TrackingScope.INVOCATION) {
    return (
      context.invocationId ??
      context.invocationContext?.invocationId ??
      GLOBAL_SCOPE_KEY
    );
  }
  return GLOBAL_SCOPE_KEY;
}

/**
 * Concurrency-safe failure counter scoped by key and identifier (tool or model).
 */
export class ScopedFailureTracker {
  private readonly counts = new Map<string, Map<string, number>>();
  private readonly locks = new Map<string, Promise<void>>();

  async runLocked<T>(scopeKey: string, fn: () => Promise<T> | T): Promise<T> {
    const prevLock = this.locks.get(scopeKey) ?? Promise.resolve();
    let releaseLock!: () => void;
    const nextLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    this.locks.set(scopeKey, prevLock.then(() => nextLock));

    await prevLock;
    try {
      return await fn();
    } finally {
      releaseLock();
      if (this.locks.get(scopeKey) === nextLock) {
        this.locks.delete(scopeKey);
      }
    }
  }

  increment(scopeKey: string, itemName: string): number {
    let scopeMap = this.counts.get(scopeKey);
    if (!scopeMap) {
      scopeMap = new Map<string, number>();
      this.counts.set(scopeKey, scopeMap);
    }
    const current = (scopeMap.get(itemName) ?? 0) + 1;
    scopeMap.set(itemName, current);
    return current;
  }

  reset(scopeKey: string, itemName: string): void {
    const scopeMap = this.counts.get(scopeKey);
    if (scopeMap) {
      scopeMap.delete(itemName);
      if (scopeMap.size === 0) {
        this.counts.delete(scopeKey);
      }
    }
  }

  getCount(scopeKey: string, itemName: string): number {
    return this.counts.get(scopeKey)?.get(itemName) ?? 0;
  }
}
