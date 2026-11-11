/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Hyperfused into ACR OpsRoom Core from google/adk-js v2.4.0 (commit 8dad457).
 */

import { InvocationContext } from '../shims.js';

/**
 * Defines when context compaction should be triggered.
 */
export enum ContextCompactionTrigger {
  BeforeInvocation = 'before_invocation',
  AfterInvocation = 'after_invocation',
  Manual = 'manual',
}

/**
 * Abstract base class for context compaction strategies.
 */
export interface BaseContextCompactor {
  /**
   * Determines whether compaction should be executed for the current context
   * and trigger.
   */
  shouldCompact(
    invocationContext: InvocationContext,
    trigger: ContextCompactionTrigger
  ): Promise<boolean> | boolean;

  /**
   * Compacts the events within the session in the given InvocationContext.
   */
  compact(invocationContext: InvocationContext): Promise<void> | void;
}
