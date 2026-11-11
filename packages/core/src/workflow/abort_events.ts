/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Hyperfused into ACR OpsRoom Core from google/adk-js v2.4.0 (commit 8dad457)
 * `core/src/events/abort_events.ts`.
 */

import {
  createEvent,
  Event,
  FunctionCallPart,
  getFunctionCalls,
  getFunctionResponses,
  InvocationContext,
} from './shims.js';

export const INVOCATION_ABORTED = 'INVOCATION_ABORTED';
export const ABORT_MESSAGE = 'Invocation was aborted.';

/**
 * Whether `event` is a terminal abort marker emitted by {@link buildAbortEvents}.
 */
export function isAbortEvent(event: Event): boolean {
  return event.errorCode === INVOCATION_ABORTED;
}

/**
 * Builds the events emitted when an invocation is aborted via `AbortSignal`:
 * 1. For each functionCall in the current invocation without a matching
 *    functionResponse, emits a synthetic `functionResponse` event with
 *    `{ aborted: true, error: ABORT_MESSAGE }` so the conversation history
 *    stays valid for subsequent LLM turns.
 * 2. Emits a terminal event with `errorCode: 'INVOCATION_ABORTED'`.
 */
export function buildAbortEvents(ctx: InvocationContext): Event[] {
  const openCalls = findUnmatchedFunctionCalls(
    ctx.session.events,
    ctx.invocationId
  );

  const out: Event[] = [];
  for (const [branch, { author, calls }] of openCalls) {
    out.push(
      createEvent({
        invocationId: ctx.invocationId,
        author,
        branch,
        content: {
          role: 'user',
          parts: calls.map((fc) => ({
            functionResponse: {
              id: fc.id,
              name: fc.name,
              response: { aborted: true, error: ABORT_MESSAGE },
            },
          })),
        },
      })
    );
  }

  out.push(
    createEvent({
      invocationId: ctx.invocationId,
      author: 'system',
      branch: ctx.branch,
      errorCode: INVOCATION_ABORTED,
      errorMessage: ABORT_MESSAGE,
    })
  );

  return out;
}

function findUnmatchedFunctionCalls(
  events: Event[],
  invocationId: string
): Map<string | undefined, { author: string; calls: FunctionCallPart[] }> {
  const answeredIds = new Set<string>();
  for (const event of events) {
    if (event.invocationId !== invocationId) {
      continue;
    }
    for (const fr of getFunctionResponses(event)) {
      if (fr.id) {
        answeredIds.add(fr.id);
      }
    }
  }

  const byBranch = new Map<
    string | undefined,
    { author: string; calls: FunctionCallPart[] }
  >();
  for (const event of events) {
    if (event.invocationId !== invocationId) {
      continue;
    }
    for (const fc of getFunctionCalls(event)) {
      if (fc.id && answeredIds.has(fc.id)) {
        continue;
      }
      let group = byBranch.get(event.branch);
      if (!group) {
        group = { author: event.author ?? 'agent', calls: [] };
        byBranch.set(event.branch, group);
      }
      group.calls.push(fc);
    }
  }
  return byBranch;
}
