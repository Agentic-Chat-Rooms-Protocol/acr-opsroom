/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Hyperfused into ACR OpsRoom Core from google/adk-js v2.4.0 (commit 8dad457)
 * `core/src/agents/processors/content_processor_utils.ts`.
 */

import { isCompactedEvent } from './context/compacted_event.js';
import { getActiveEvents } from './context/compaction_utils.js';
import {
  createEvent,
  Event,
  getFunctionCalls,
  getFunctionResponses,
  InvocationContext,
  WorkflowContent,
  WorkflowPart,
} from './shims.js';
import { REQUEST_EUC_FUNCTION_CALL_NAME } from './utils/hitl_utils.js';

/**
 * Resolves the effective isolation scope for a consumer (agent or node).
 *
 * - `isolationScope: true` derives a unique scope from `agentName` (or `defaultScope`).
 * - `isolationScope: '<string>'` uses that explicit scope.
 * - `isolationScope: undefined | false` inherits `defaultScope`.
 */
export function resolveConsumerScope(
  isolationScope: boolean | string | undefined,
  agentName: string,
  defaultScope?: string
): string | undefined {
  if (isolationScope === true) {
    return agentName;
  }
  if (typeof isolationScope === 'string') {
    return isolationScope;
  }
  return defaultScope;
}

/**
 * Filters `events` so that scratchpad events (events tagged with an
 * `isolationScope`) are only visible to consumers whose `consumerScope`
 * matches that exact `isolationScope` (or is a nested sub-scope when
 * `allowSubscope` is true), while shared events (`event.isolationScope === undefined`)
 * remain visible to all consumers.
 */
export function filterByIsolationScope(
  events: Event[],
  consumerScope?: string
): Event[] {
  return events.filter(
    (e) => !e.isolationScope || e.isolationScope === consumerScope
  );
}

/**
 * Extracts active, scope-filtered conversation contents from session events.
 */
export function getContents(params: {
  currentBranch?: string;
  events: Event[];
  agentName?: string;
  isolationScope?: boolean | string;
  defaultScope?: string;
}): WorkflowContent[] {
  const {
    currentBranch,
    events,
    agentName = '',
    isolationScope,
    defaultScope,
  } = params;

  const consumerScope = resolveConsumerScope(
    isolationScope,
    agentName,
    defaultScope
  );

  // Use getActiveEvents first to handle compaction, then enforce strict isolationScope filtering
  const activeEvents = getActiveEvents(events, consumerScope);
  const rawFilteredEvents = filterByIsolationScope(activeEvents, consumerScope)
    .map((e) => {
      if (isCompactedEvent(e)) {
        return createEvent({
          ...e,
          content: e.compactedContent,
        });
      }
      return e;
    })
    .filter((e) => isEventBelongsToBranch(currentBranch, e));

  const contents: WorkflowContent[] = [];
  for (const event of rawFilteredEvents) {
    if (!event.content?.parts || event.content.parts.length === 0) {
      continue;
    }
    removeClientFunctionCallId(event.content);
    contents.push(event.content);
  }
  return contents;
}

/**
 * Gets contents for the current turn only (starting from the latest user turn).
 */
export function getCurrentTurnContents(params: {
  currentBranch?: string;
  events: Event[];
  agentName?: string;
  isolationScope?: boolean | string;
  defaultScope?: string;
}): WorkflowContent[] {
  const {
    currentBranch,
    events,
    agentName = '',
    isolationScope,
    defaultScope,
  } = params;

  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.author === 'user' || isOtherAgentReply(agentName, event)) {
      return getContents({
        currentBranch,
        events: events.slice(i),
        agentName,
        isolationScope,
        defaultScope,
      });
    }
  }
  return [];
}

function isOtherAgentReply(currentAgentName: string, event?: Event): boolean {
  return Boolean(
    currentAgentName &&
      event?.author !== currentAgentName &&
      event?.author !== 'user' &&
      event?.author !== 'system'
  );
}

function isEventBelongsToBranch(
  invocationBranch?: string,
  event?: Event
): boolean {
  if (!invocationBranch || !event?.branch) {
    return true;
  }
  return invocationBranch.startsWith(event.branch);
}

function removeClientFunctionCallId(content?: WorkflowContent): void {
  if (content && content.parts) {
    for (const part of content.parts) {
      if (
        part.functionCall &&
        part.functionCall.id &&
        part.functionCall.id.startsWith('adk-')
      ) {
        part.functionCall.id = undefined;
      }
      if (
        part.functionResponse &&
        part.functionResponse.id &&
        part.functionResponse.id.startsWith('adk-')
      ) {
        part.functionResponse.id = undefined;
      }
    }
  }
}

/**
 * Merges a list of function_response events into one event.
 */
export function mergeFunctionResponseEvents(
  functionResponseEvents: Event[]
): Event {
  if (functionResponseEvents.length === 0) {
    throw new Error('No function response events provided.');
  }

  const mergedEvent = createEvent(functionResponseEvents[0]);
  const partsInMergedEvent: WorkflowPart[] = mergedEvent.content?.parts || [];

  for (const event of functionResponseEvents.slice(1)) {
    if (!event.content || !event.content.parts) {
      throw new Error('Cannot merge an empty function_response event.');
    }

    for (const part of event.content.parts) {
      if (part.functionResponse) {
        const functionCallId = part.functionResponse.id;
        let replaced = false;
        for (let i = 0; i < partsInMergedEvent.length; i++) {
          if (partsInMergedEvent[i].functionResponse?.id === functionCallId) {
            partsInMergedEvent[i] = part;
            replaced = true;
            break;
          }
        }
        if (!replaced) {
          partsInMergedEvent.push(part);
        }
      } else {
        partsInMergedEvent.push(part);
      }
    }

    if (event.actions) {
      for (const [key, flag] of Object.entries(
        event.actions.stateDelta || {}
      )) {
        mergedEvent.actions.stateDelta[key] = flag;
      }
      for (const [key, flag] of Object.entries(
        event.actions.artifactDelta || {}
      )) {
        mergedEvent.actions.artifactDelta[key] = flag;
      }
      for (const [key, value] of Object.entries(
        event.actions.requestedAuthConfigs || {}
      )) {
        mergedEvent.actions.requestedAuthConfigs[key] = value;
      }
      for (const [key, value] of Object.entries(
        event.actions.requestedToolConfirmations || {}
      )) {
        mergedEvent.actions.requestedToolConfirmations[key] = value;
      }
      if (event.actions.transferToAgent) {
        mergedEvent.actions.transferToAgent = event.actions.transferToAgent;
      }
      if (event.actions.escalate) {
        mergedEvent.actions.escalate = event.actions.escalate;
      }
      if (event.actions.skipSummarization) {
        mergedEvent.actions.skipSummarization = event.actions.skipSummarization;
      }
    }
  }

  return mergedEvent;
}

export function isAuthEvent(event: Event): boolean {
  if (!event.content?.parts) {
    return false;
  }
  for (const part of event.content.parts) {
    if (
      part.functionCall?.name === REQUEST_EUC_FUNCTION_CALL_NAME ||
      part.functionResponse?.name === REQUEST_EUC_FUNCTION_CALL_NAME
    ) {
      return true;
    }
  }
  return false;
}

export function getFunctionCallEventsFromHistory(
  invocationContext: InvocationContext
): Event[] {
  return invocationContext.session.events.filter(
    (e) => getFunctionCalls(e).length > 0 || getFunctionResponses(e).length > 0
  );
}
