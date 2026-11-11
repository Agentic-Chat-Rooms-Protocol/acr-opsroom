/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provenance: Lifted from `google/adk-js` (commit `8dad457`, v2.4.0)
 * `core/src/workflow/retry_config.ts`.
 */

/**
 * An error constructor usable in {@link RetryConfig.exceptions}.
 */
export type ErrorClass = new (...args: never[]) => Error;

/**
 * Configuration for retrying a node.
 *
 * Delays are expressed in **seconds** (fractions allowed) to match ADK
 * semantics across Python and TypeScript.
 */
export interface RetryConfig {
  /** Maximum number of attempts, including the original request. Defaults to 5. */
  maxAttempts?: number;
  /** Initial delay before the first retry, in seconds. Defaults to 1.0. */
  initialDelay?: number;
  /** Maximum delay between retries, in seconds. Defaults to 60.0. */
  maxDelay?: number;
  /** Multiplier by which the delay increases after each attempt. Defaults to 2.0. */
  backoffFactor?: number;
  /** Randomness factor for the delay. Defaults to 1.0. Use 0.0 to remove randomness. */
  jitter?: number;
  /** Exceptions to retry on. `undefined`/`null` means retry on all retryable errors. */
  exceptions?: Array<string | ErrorClass> | null;
}

/**
 * Normalizes the `exceptions` field of a {@link RetryConfig} to a list of error
 * class name strings.
 */
export function normalizeRetryExceptions(
  exceptions?: Array<string | ErrorClass> | null
): string[] | undefined {
  if (exceptions === undefined || exceptions === null) {
    return undefined;
  }
  return exceptions.map((item) => {
    if (typeof item === 'string') {
      return item;
    }
    if (typeof item === 'function' && item.name) {
      return item.name;
    }
    throw new Error(
      `exceptions must contain error class names (string) or error classes, got: ${String(
        item
      )}`
    );
  });
}

/**
 * A {@link RetryConfig} whose `exceptions` filter has been normalized to error
 * class-name strings once, up front.
 */
export interface PreparedRetryConfig {
  readonly maxAttempts?: number;
  readonly initialDelay?: number;
  readonly maxDelay?: number;
  readonly backoffFactor?: number;
  readonly jitter?: number;
  readonly exceptions?: readonly string[];
}

/**
 * Validates and normalizes a {@link RetryConfig} once, at config-acceptance time.
 */
export function prepareRetryConfig(config: RetryConfig): PreparedRetryConfig {
  return {
    maxAttempts: config.maxAttempts,
    initialDelay: config.initialDelay,
    maxDelay: config.maxDelay,
    backoffFactor: config.backoffFactor,
    jitter: config.jitter,
    exceptions: normalizeRetryExceptions(config.exceptions),
  };
}
