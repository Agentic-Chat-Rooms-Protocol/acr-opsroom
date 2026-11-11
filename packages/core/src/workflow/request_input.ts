/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provenance: Lifted from `google/adk-js` (commit `8dad457`, v2.4.0)
 * `core/src/workflow/request_input.ts`.
 */

import { randomUuidSync } from '../crypto-compat.js';
import type { SchemaLike } from './shims.js';

const REQUEST_INPUT_SIGNATURE_SYMBOL = Symbol.for(
  'google.adk.workflow.requestInput'
);

/** Parameters for constructing a {@link RequestInput}. */
export interface RequestInputParams {
  /** The interrupt id (usually a function-call id). Auto-generated if omitted. */
  interruptId?: string;
  /** Custom payload provided for resuming. */
  payload?: unknown;
  /** A message to display to the user when requesting input. */
  message?: string;
  /** The expected shape of the reply. */
  responseSchema?: SchemaLike;
}

/**
 * A request for input from the user, yielded/returned by a node to pause a
 * workflow (Human-in-the-Loop).
 */
export class RequestInput {
  readonly [REQUEST_INPUT_SIGNATURE_SYMBOL] = true;

  readonly interruptId: string;
  readonly payload?: unknown;
  readonly message?: string;
  readonly responseSchema?: SchemaLike;

  constructor(params: RequestInputParams = {}) {
    this.interruptId = params.interruptId ?? randomUuidSync();
    this.payload = params.payload;
    this.message = params.message;
    this.responseSchema = params.responseSchema;
  }
}

/**
 * Type guard for {@link RequestInput}.
 */
export function isRequestInput(value: unknown): value is RequestInput {
  return (
    typeof value === 'object' &&
    value !== null &&
    REQUEST_INPUT_SIGNATURE_SYMBOL in value &&
    (value as RequestInput)[REQUEST_INPUT_SIGNATURE_SYMBOL] === true
  );
}
