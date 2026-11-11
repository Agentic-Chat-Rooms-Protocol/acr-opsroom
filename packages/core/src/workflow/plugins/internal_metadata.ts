/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Hyperfused into ACR OpsRoom Core from google/adk-js v2.4.0 (commit 8dad457)
 * `core/src/events/internal_metadata.ts`.
 */

import { Event, WorkflowSession } from '../shims.js';

/**
 * Reserved prefix for ADK-internal keys in `Event.customMetadata`.
 */
export const INTERNAL_METADATA_PREFIX = '__adk_internal_';

/**
 * Key set to `true` on events returned by `SessionService` when loading an
 * existing session (`getSession` / `appendEvent`).
 */
export const RESTORED_EVENT_KEY = `${INTERNAL_METADATA_PREFIX}restored_event`;

/**
 * Marks `event` as restored from a `SessionService` by setting
 * `RESTORED_EVENT_KEY` in its `customMetadata`. Mutates `event` in place and
 * returns it.
 */
export function markRestored(event: Event): Event {
  event.customMetadata = {
    ...event.customMetadata,
    [RESTORED_EVENT_KEY]: true,
  };
  return event;
}

/**
 * Returns a copy of `customMetadata` with all `__adk_internal_*` keys removed,
 * or `undefined` if no user keys remain.
 */
export function publicMetadata(
  customMetadata: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!customMetadata) {
    return undefined;
  }
  const out: Record<string, unknown> = {};
  let hasKeys = false;
  for (const [k, v] of Object.entries(customMetadata)) {
    if (!k.startsWith(INTERNAL_METADATA_PREFIX)) {
      out[k] = v;
      hasKeys = true;
    }
  }
  return hasKeys ? out : undefined;
}

/**
 * Returns only the `__adk_internal_*` entries from `customMetadata`, or
 * `undefined` if none are present.
 */
export function internalMetadata(
  customMetadata: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!customMetadata) {
    return undefined;
  }
  const out: Record<string, unknown> = {};
  let hasKeys = false;
  for (const [k, v] of Object.entries(customMetadata)) {
    if (k.startsWith(INTERNAL_METADATA_PREFIX)) {
      out[k] = v;
      hasKeys = true;
    }
  }
  return hasKeys ? out : undefined;
}

/**
 * Returns a shallow copy of `event` with `RESTORED_EVENT_KEY` stripped from
 * `customMetadata`, leaving any other internal keys (e.g. HMAC signatures)
 * intact for persistence.
 */
export function withoutRestoredMarker(event: Event): Event {
  if (!event.customMetadata || !(RESTORED_EVENT_KEY in event.customMetadata)) {
    return event;
  }
  const rest = { ...event.customMetadata };
  delete rest[RESTORED_EVENT_KEY];
  return {
    ...event,
    customMetadata: Object.keys(rest).length > 0 ? rest : undefined,
  };
}

/**
 * Returns a shallow copy of `event` with all `__adk_internal_*` keys stripped
 * from `customMetadata`. Returns `event` unchanged if no internal keys are
 * present.
 */
export function publicEvent(event: Event): Event {
  if (!internalMetadata(event.customMetadata)) {
    return event;
  }
  return {
    ...event,
    customMetadata: publicMetadata(event.customMetadata),
  };
}

/**
 * Returns a shallow copy of `session` whose `events` have all
 * `__adk_internal_*` keys stripped from `customMetadata`.
 */
export function publicSession(session: WorkflowSession): WorkflowSession {
  return {
    ...session,
    events: session.events.map(publicEvent),
  };
}

export { publicEvent as withoutInternalMetadata };
