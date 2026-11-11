/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Hyperfused into ACR OpsRoom Core from google/adk-js v2.4.0 (commit 8dad457)
 * with deterministic compactedEventIds filtering and CheckpointManifest builder.
 */

import { RouteValue } from '../graph.js';
import {
  elevateExecutionAuthority,
  Event,
  ExecutionAuthorityLevel,
  getFunctionCalls,
  getFunctionResponses,
} from '../shims.js';
import { requiresUserInput } from '../utils/hitl_utils.js';
import {
  nodeNameFromPath,
  type RehydratedNode,
} from '../utils/rehydration_utils.js';
import {
  CompactedEvent,
  CompactedEventCheckpointManifest,
  isCompactedEvent,
} from './compacted_event.js';

/**
 * Checks if an event is visible in a given isolation scope.
 */
export function isEventVisibleInIsolationScope(
  event: Event,
  isolationScope?: string
): boolean {
  if (!event.isolationScope) {
    return true;
  }
  if (!isolationScope) {
    return false;
  }
  return (
    isolationScope === event.isolationScope ||
    isolationScope.startsWith(`${event.isolationScope}/`)
  );
}

/**
 * Filters a list of session events to return only the currently "active" events
 * for a given isolationScope.
 *
 * If one or more CompactedEvents exist in the scope, the latest one replaces all
 * events up to its `endTime` (or explicitly listed in `compactedEventIds`).
 * The returned list starts with that latest CompactedEvent, followed by any
 * active events not folded into that compaction.
 */
export function getActiveEvents(
  events: Event[],
  isolationScope?: string
): Event[] {
  const visibleEvents = events.filter((e) =>
    isEventVisibleInIsolationScope(e, isolationScope)
  );

  let latestCompactedIndex = -1;
  for (let i = visibleEvents.length - 1; i >= 0; i--) {
    const e = visibleEvents[i];
    if (isCompactedEvent(e) && e.isolationScope === isolationScope) {
      latestCompactedIndex = i;
      break;
    }
  }

  if (latestCompactedIndex === -1) {
    return visibleEvents;
  }

  const latest = visibleEvents[latestCompactedIndex] as CompactedEvent;
  if (latest.compactedEventIds && latest.compactedEventIds.length > 0) {
    const compactedIdSet = new Set(latest.compactedEventIds);
    const postCompactionEvents = visibleEvents.filter(
      (e) => e !== latest && !isCompactedEvent(e) && !compactedIdSet.has(e.id)
    );
    return [latest, ...postCompactionEvents];
  }

  const postCompactionEvents = visibleEvents.filter(
    (e) => e !== latest && e.timestamp > latest.endTime
  );

  return [latest, ...postCompactionEvents];
}

/**
 * Identifies the IDs of function calls that do not have a corresponding
 * function response in the provided events list.
 */
export function findOpenToolCallIds(events: Event[]): Set<string> {
  const openIds = new Set<string>();
  for (const event of events) {
    for (const call of getFunctionCalls(event)) {
      if (call.id) {
        openIds.add(call.id);
      }
    }
    for (const resp of getFunctionResponses(event)) {
      if (resp.id) {
        openIds.delete(resp.id);
      }
    }
  }
  return openIds;
}

/**
 * Calculates the index from which events must be retained to preserve both the
 * requested retention size and any open tool calls.
 */
export function calculateRetainStartIndex(
  activeEvents: Event[],
  retentionSize: number
): number {
  let retainStartIndex = Math.max(0, activeEvents.length - retentionSize);

  const openToolIds = findOpenToolCallIds(activeEvents);
  if (openToolIds.size > 0) {
    for (let i = 0; i < retainStartIndex; i++) {
      const calls = getFunctionCalls(activeEvents[i]);
      if (calls.some((call) => call.id && openToolIds.has(call.id))) {
        retainStartIndex = i;
        break;
      }
    }
  }

  return retainStartIndex;
}

function isRunClosed(node: RehydratedNode): boolean {
  return (
    node.output !== undefined ||
    node.route !== undefined ||
    node.interruptIds.size > 0
  );
}

function cloneRehydratedNode(node: RehydratedNode): RehydratedNode {
  return {
    ...(node.output !== undefined ? { output: node.output } : {}),
    ...(node.route !== undefined ? { route: node.route } : {}),
    ...(node.branch !== undefined ? { branch: node.branch } : {}),
    ...(node.input !== undefined ? { input: node.input } : {}),
    ...(node.executionAuthority !== undefined
      ? { executionAuthority: node.executionAuthority }
      : {}),
    interruptIds: new Set(node.interruptIds),
    resolvedResponses: new Map(node.resolvedResponses),
  };
}

/**
 * Extracts all node-run checkpoints (`runsByPath`), predecessor outputs (`outputsByNode`),
 * invocation boundary metadata, and highest elevated `executionAuthority` from the
 * events being compacted so dynamic graphs and rehydration never lose checkpoint state.
 */
export function buildCheckpointManifest(
  eventsToCompact: Event[]
): CompactedEventCheckpointManifest {
  const runsMap = new Map<string, RehydratedNode[]>();
  const interruptOwner = new Map<string, RehydratedNode>();
  const outputsByNode: Record<string, unknown> = {};
  let invocationId = '';
  let paused = false;
  let highestAuthority: ExecutionAuthorityLevel | undefined = undefined;

  const getOrCreateOpenRun = (fullPath: string): RehydratedNode => {
    let runs = runsMap.get(fullPath);
    if (!runs) {
      runs = [];
      runsMap.set(fullPath, runs);
    }
    const open = runs[runs.length - 1];
    if (open && !isRunClosed(open)) {
      return open;
    }
    const run: RehydratedNode = {
      interruptIds: new Set(),
      resolvedResponses: new Map(),
    };
    runs.push(run);
    return run;
  };

  for (const event of eventsToCompact) {
    if (event.invocationId) {
      invocationId = event.invocationId;
    }
    if (requiresUserInput(event)) {
      paused = true;
    }

    if (isCompactedEvent(event) && event.checkpointManifest) {
      const prior = event.checkpointManifest;
      if (prior.invocationId && !invocationId) {
        invocationId = prior.invocationId;
      }
      if (prior.paused) {
        paused = true;
      }
      if (prior.highestAuthority) {
        highestAuthority = highestAuthority
          ? elevateExecutionAuthority(highestAuthority, prior.highestAuthority)
          : prior.highestAuthority;
      }
      for (const [k, v] of Object.entries(prior.outputsByNode)) {
        outputsByNode[k] = v;
      }
      for (const [fullPath, runs] of Object.entries(prior.runsByPath)) {
        let list = runsMap.get(fullPath);
        if (!list) {
          list = [];
          runsMap.set(fullPath, list);
        }
        for (const r of runs) {
          const cloned = cloneRehydratedNode(r);
          list.push(cloned);
          for (const id of cloned.interruptIds) {
            interruptOwner.set(id, cloned);
          }
        }
      }
      continue;
    }

    if (event.author === 'user' && event.content?.parts) {
      for (const part of event.content.parts) {
        const fr = part.functionResponse;
        if (fr?.id && interruptOwner.has(fr.id)) {
          interruptOwner.get(fr.id)!.resolvedResponses.set(fr.id, fr.response);
        }
      }
      continue;
    }

    const fullPath = event.nodeInfo?.path ?? event.author;
    if (!fullPath || fullPath === 'user' || fullPath === 'system') {
      continue;
    }

    const node = getOrCreateOpenRun(fullPath);
    if (event.output !== undefined) {
      node.output = event.output;
      node.branch = event.branch;
      outputsByNode[fullPath] = event.output;
      outputsByNode[nodeNameFromPath(fullPath)] = event.output;
      if (event.author) {
        outputsByNode[event.author] = event.output;
      }
      for (const target of event.nodeInfo?.outputFor ?? []) {
        outputsByNode[target] = event.output;
        outputsByNode[nodeNameFromPath(target)] = event.output;
      }
    }
    if (event.route !== undefined) {
      node.route = event.route as RouteValue | RouteValue[];
    }
    for (const id of event.longRunningToolIds ?? []) {
      node.interruptIds.add(id);
      interruptOwner.set(id, node);
    }

    const agentState = event.actions?.agentState;
    if (
      agentState &&
      typeof agentState === 'object' &&
      !Array.isArray(agentState)
    ) {
      if ('input' in agentState) {
        node.input = agentState['input'];
      }
      if (typeof agentState['executionAuthority'] === 'string') {
        const auth =
          agentState['executionAuthority'] as ExecutionAuthorityLevel;
        node.executionAuthority = node.executionAuthority
          ? elevateExecutionAuthority(node.executionAuthority, auth)
          : auth;
        if (auth !== 'SYSTEM') {
          highestAuthority = highestAuthority
            ? elevateExecutionAuthority(highestAuthority, auth)
            : auth;
        }
      }
    }
    if (event.nodeInfo?.executionAuthority) {
      const auth = event.nodeInfo.executionAuthority;
      node.executionAuthority = node.executionAuthority
        ? elevateExecutionAuthority(node.executionAuthority, auth)
        : auth;
      if (auth !== 'SYSTEM') {
        highestAuthority = highestAuthority
          ? elevateExecutionAuthority(highestAuthority, auth)
          : auth;
      }
    }
  }

  const runsByPath: Record<string, RehydratedNode[]> = {};
  for (const [fullPath, runs] of runsMap.entries()) {
    runsByPath[fullPath] = runs;
  }

  return {
    invocationId,
    paused,
    runsByPath,
    outputsByNode,
    ...(highestAuthority ? { highestAuthority } : {}),
  };
}
