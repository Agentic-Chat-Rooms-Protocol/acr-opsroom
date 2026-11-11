/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provenance: Lifted from `google/adk-js` (commit `8dad457`, v2.4.0)
 * `core/src/workflow/utils/hitl_utils.ts`.
 */

import { RequestInput } from '../request_input.js';
import {
  AuthConfig,
  compileJsonSchema,
  createEvent,
  Event,
  Part,
  State,
  toJsonSchema,
} from '../shims.js';

export const REQUEST_INPUT_FUNCTION_CALL_NAME = 'adk_request_input';
export const REQUEST_CREDENTIAL_FUNCTION_CALL_NAME = 'adk_request_credential';
export const REQUEST_EUC_FUNCTION_CALL_NAME = REQUEST_CREDENTIAL_FUNCTION_CALL_NAME;
export const REQUEST_CONFIRMATION_FUNCTION_CALL_NAME = 'adk_request_confirmation';

const RESPONSE_SCHEMA_ARG = 'response_schema';

/**
 * Creates an interrupt {@link Event} from a {@link RequestInput}.
 */
export function createRequestInputEvent(requestInput: RequestInput): Event {
  const args: Record<string, unknown> = {
    interruptId: requestInput.interruptId,
    payload: requestInput.payload ?? null,
    message: requestInput.message ?? null,
    [RESPONSE_SCHEMA_ARG]: requestInput.responseSchema
      ? toJsonSchema(requestInput.responseSchema)
      : null,
  };

  return createEvent({
    content: {
      role: 'model',
      parts: [
        {
          functionCall: {
            name: REQUEST_INPUT_FUNCTION_CALL_NAME,
            args,
            id: requestInput.interruptId,
          },
        },
      ],
    },
    longRunningToolIds: [requestInput.interruptId],
  });
}

/**
 * Collects the `responseSchema` each pending interrupt declared, keyed by
 * interrupt id.
 */
export function responseSchemasByInterruptId(
  events: Event[]
): Map<string, unknown> {
  const schemas = new Map<string, unknown>();
  for (const event of events) {
    for (const part of event.content?.parts ?? []) {
      const fc = part.functionCall;
      if (fc?.name !== REQUEST_INPUT_FUNCTION_CALL_NAME || !fc.id) {
        continue;
      }
      const schema = (fc.args as Record<string, unknown> | undefined)?.[
        RESPONSE_SCHEMA_ARG
      ];
      if (schema) {
        schemas.set(fc.id, schema);
      }
    }
  }
  return schemas;
}

/**
 * Checks a structured reply against the `responseSchema` its interrupt declared.
 */
export function interruptResponseMismatch(
  interruptId: string,
  value: unknown,
  jsonSchema: unknown
): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const validator = compileJsonSchema(jsonSchema);
  if (!validator) {
    return undefined;
  }
  const result = validator.safeParse(value);
  if (result.success) {
    return undefined;
  }
  const issues = result.error.issues
    .map((issue) => {
      const at = issue.path.length ? ` at '${issue.path.join('.')}'` : '';
      return `${issue.message}${at}`;
    })
    .join('; ');
  return (
    `The reply to interrupt '${interruptId}' does not match the ` +
    `responseSchema it declared: ${issues}. A structured reply must either ` +
    `match that schema, or wrap a bare value as {result: <value>}; a ` +
    `plain-text reply is accepted as-is and is not checked. The interrupt is ` +
    `still waiting, so you can answer it again.`
  );
}

/** Returns whether an event contains a `request_input` function call. */
export function hasRequestInputFunctionCall(event: Event): boolean {
  return (event.content?.parts ?? []).some(
    (p) => p.functionCall?.name === REQUEST_INPUT_FUNCTION_CALL_NAME
  );
}

/** Returns whether an event contains an `adk_request_credential` function call. */
export function hasAuthRequestFunctionCall(event: Event): boolean {
  return (event.content?.parts ?? []).some(
    (p) => p.functionCall?.name === REQUEST_CREDENTIAL_FUNCTION_CALL_NAME
  );
}

/** Whether an event paused the run for user input, credentials, or confirmation. */
export function requiresUserInput(event: Event): boolean {
  return (event.content?.parts ?? []).some(
    (p) =>
      p.functionCall?.name === REQUEST_INPUT_FUNCTION_CALL_NAME ||
      p.functionCall?.name === REQUEST_CREDENTIAL_FUNCTION_CALL_NAME ||
      p.functionCall?.name === REQUEST_CONFIRMATION_FUNCTION_CALL_NAME
  );
}

/** Extracts interrupt ids from `request_input` function calls in an event. */
export function getRequestInputInterruptIds(event: Event): string[] {
  const ids: string[] = [];
  for (const part of event.content?.parts ?? []) {
    const fc = part.functionCall;
    if (fc && fc.name === REQUEST_INPUT_FUNCTION_CALL_NAME && fc.id) {
      ids.push(fc.id);
    }
  }
  return ids;
}

/**
 * Creates a `FunctionResponse` part answering a `request_input` interrupt.
 */
export function createRequestInputResponse(
  interruptId: string,
  response: Record<string, unknown>
): Part {
  return {
    functionResponse: {
      id: interruptId,
      name: REQUEST_INPUT_FUNCTION_CALL_NAME,
      response,
    },
  };
}

export function hasAuthCredential(
  authConfig: AuthConfig,
  state: State
): boolean {
  return state.get(`temp:${authConfig.credentialKey}`) !== undefined ||
    state.get(authConfig.credentialKey) !== undefined;
}

export function createAuthRequestEvent(
  authConfig: AuthConfig,
  interruptId: string
): Event {
  return createEvent({
    content: {
      role: 'model',
      parts: [
        {
          functionCall: {
            name: REQUEST_CREDENTIAL_FUNCTION_CALL_NAME,
            id: interruptId,
            args: {
              functionCallId: interruptId,
              authConfig,
              message:
                authConfig.description ??
                `Authentication required for ${authConfig.credentialKey}`,
            },
          },
        },
      ],
    },
    longRunningToolIds: [interruptId],
  });
}

export async function processAuthResume(params: {
  responseData: unknown;
  authConfig: AuthConfig;
  state: State;
}): Promise<void> {
  if (params.responseData !== undefined && params.responseData !== null) {
    params.state.set(params.authConfig.credentialKey, params.responseData);
  }
}
