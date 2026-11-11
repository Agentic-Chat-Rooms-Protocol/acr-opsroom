/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provenance: Lifted and adapted from `google/adk-js` (commit `8dad457`, v2.4.0)
 * `core/src/workflow/utils/retry_utils.ts`.
 * Hardened for ACR Extension 3 (`DurableCommandWal`): forbids blind retry on
 * `NodeTimeoutError` when a node is side-effecting or has already dispatched
 * a side effect, as well as `NodeOutcomeUnknownError`, `StaleGenerationFenceError`,
 * and `NodePrivilegeEscalationError`.
 */

import {
  isNodeOutcomeUnknownError,
  isNodePrivilegeEscalationError,
  isNodeTimeoutError,
  isStaleGenerationFenceError,
} from '../errors.js';
import { NodeState } from '../node_state.js';
import { PreparedRetryConfig } from '../retry_config.js';

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_INITIAL_DELAY_SECONDS = 1.0;
const DEFAULT_MAX_DELAY_SECONDS = 60.0;
const DEFAULT_BACKOFF_FACTOR = 2.0;
const DEFAULT_JITTER = 1.0;

/**
 * Resolves every runtime name a thrown value can be matched by: its class name
 * and any `name` assigned on top of it.
 */
export function errorNames(error: unknown): string[] {
  if (error instanceof Error) {
    const names = [error.constructor?.name, error.name].filter(
      (name): name is string => !!name
    );
    return [...new Set(names)];
  }
  if (typeof error === 'object' && error !== null) {
    return [error.constructor?.name ?? 'Object'];
  }
  return [typeof error];
}

/**
 * Resolves the most specific runtime name of a thrown value, for reporting.
 */
export function errorName(error: unknown): string {
  const [className, assigned] = errorNames(error);
  if (className === 'Error' && assigned) {
    return assigned;
  }
  return className;
}

/** Parameters for {@link shouldRetryNode}. */
export interface ShouldRetryNodeParams {
  /** The error thrown by the node. */
  error: unknown;
  /** The node's prepared (normalized) retry configuration. */
  retryConfig: PreparedRetryConfig;
  /** The current node state (its `attemptCount` is 1-based). */
  nodeState: NodeState;
  /** ACR Extension 3: Whether the node performs external side effects. */
  sideEffecting?: boolean;
}

/**
 * Checks if a failed node should be retried based on its retry config.
 *
 * ACR Extension 3 Invariant:
 * - Never blindly retry `NodeOutcomeUnknownError`, `StaleGenerationFenceError`,
 *   or `NodePrivilegeEscalationError`.
 * - Never blindly retry `NodeTimeoutError` when `sideEffecting` is true or
 *   `nodeState.sideEffectDispatched` is true (must reconcile via WAL instead).
 */
export function shouldRetryNode({
  error,
  retryConfig,
  nodeState,
  sideEffecting = false,
}: ShouldRetryNodeParams): boolean {
  if (
    isNodeOutcomeUnknownError(error) ||
    isStaleGenerationFenceError(error) ||
    isNodePrivilegeEscalationError(error)
  ) {
    return false;
  }

  if (
    isNodeTimeoutError(error) &&
    (sideEffecting || nodeState.sideEffectDispatched === true)
  ) {
    return false;
  }

  const attemptCount = nodeState.attemptCount;
  const maxAttempts = retryConfig.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  if (attemptCount >= maxAttempts) {
    return false;
  }

  const exceptions = retryConfig.exceptions;
  if (
    exceptions !== undefined &&
    !errorNames(error).some((name) => exceptions.includes(name))
  ) {
    return false;
  }

  return true;
}

/** Parameters for {@link getRetryDelaySeconds}. */
export interface GetRetryDelaySecondsParams {
  retryConfig: PreparedRetryConfig;
  nodeState: NodeState;
  randomFn?: () => number;
}

/**
 * Calculates the delay, in seconds, before retrying a node.
 */
export function getRetryDelaySeconds({
  retryConfig,
  nodeState,
  randomFn = Math.random,
}: GetRetryDelaySecondsParams): number {
  const initialDelay =
    retryConfig.initialDelay ?? DEFAULT_INITIAL_DELAY_SECONDS;
  const maxDelay = retryConfig.maxDelay ?? DEFAULT_MAX_DELAY_SECONDS;
  const backoffFactor = retryConfig.backoffFactor ?? DEFAULT_BACKOFF_FACTOR;
  const jitter = retryConfig.jitter ?? DEFAULT_JITTER;

  const attemptCount = nodeState.attemptCount || 1;
  const attemptForCalc = Math.max(0, attemptCount - 1);

  let delay = initialDelay * Math.pow(backoffFactor, attemptForCalc);

  if (jitter > 0.0) {
    delay = Math.min(delay, maxDelay / (1.0 + jitter));
    const span = jitter * delay;
    const randomOffset = -span + randomFn() * (2 * span);
    delay = Math.max(0.0, delay + randomOffset);
  }

  return Math.min(delay, maxDelay);
}
