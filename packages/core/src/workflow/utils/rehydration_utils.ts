/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provenance: Lifted from `google/adk-js` (commit `8dad457`, v2.4.0)
 * `core/src/workflow/utils/rehydration_utils.ts`.
 * Extended with `verifySessionAuditIntegrity` (`CryptographicAuditLedger`)
 * and `executionAuthority` preservation on fast-forward.
 */

import { CryptographicAuditLedger } from '../../audit-ledger.js';
import { isCompactedEvent } from '../context/compacted_event.js';
import { getActiveEvents } from '../context/compaction_utils.js';
import { RouteValue } from '../graph.js';
import type { NodeContext, NodeResult } from '../node_context.js';
import { Event, ExecutionAuthorityLevel } from '../shims.js';
import {
  interruptResponseMismatch,
  REQUEST_INPUT_FUNCTION_CALL_NAME,
  requiresUserInput,
  responseSchemasByInterruptId,
} from './hitl_utils.js';

const RESULT_KEY = 'result';

/** Reconstructed state for a single node, keyed by node name. */
export interface RehydratedNode {
  /** The node's cached output from a prior run, if it produced one. */
  output?: unknown;
  /** The route(s) the node emitted, if any (array = multi-route). */
  route?: RouteValue | RouteValue[];
  /** The branch the node ran on. */
  branch?: string;
  /** The input the node was invoked with (captured when it interrupted). */
  input?: unknown;
  /** Interrupt ids the node raised. */
  interruptIds: Set<string>;
  /** Resolved interrupt responses, keyed by interrupt id. */
  resolvedResponses: Map<string, unknown>;
  /** ACR Extension 2 & 5: Execution authority recorded on the prior run. */
  executionAuthority?: ExecutionAuthorityLevel;
}

/**
 * Verifies the cryptographic hash chain of an optional {@link CryptographicAuditLedger}
 * before trusting rehydrated session history.
 */
export function verifySessionAuditIntegrity(
  ledger?: CryptographicAuditLedger
): void {
  if (!ledger) {
    return;
  }
  if (!ledger.verifyChainIntegrity()) {
    throw new Error(
      'SESSION_AUDIT_INTEGRITY_VIOLATION: Rehydration rejected because CryptographicAuditLedger chain verification failed.'
    );
  }
}

/**
 * Narrows session events to the workflow run still in progress, dropping every
 * earlier run that already finished while preserving `CompactedEvent` checkpoints.
 */
export function eventsForCurrentRun(
  events: Event[],
  currentInvocationId: string
): Event[] {
  const priorRuns: Array<{
    start: number;
    invocationId?: string;
    paused: boolean;
  }> = [];
  let currentStart = events.length;
  let lastInvocationId: string | undefined;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const manifestInvocationId = isCompactedEvent(event)
      ? event.checkpointManifest?.invocationId
      : undefined;
    const invocationId =
      event.invocationId || manifestInvocationId || lastInvocationId;
    if (event.invocationId || manifestInvocationId) {
      lastInvocationId = event.invocationId || manifestInvocationId;
    }
    if (invocationId === currentInvocationId) {
      if (currentStart === events.length) {
        currentStart = i;
      }
      continue;
    }
    const hasCompactedManifest =
      isCompactedEvent(event) && event.checkpointManifest !== undefined;
    if (!event.nodeInfo?.path && !hasCompactedManifest) {
      continue;
    }
    let entry = priorRuns[priorRuns.length - 1];
    if (!entry || entry.invocationId !== invocationId) {
      entry = { start: i, invocationId, paused: false };
      priorRuns.push(entry);
    }
    if (
      raisedInterrupt(event) ||
      (isCompactedEvent(event) && Boolean(event.checkpointManifest?.paused))
    ) {
      entry.paused = true;
    }
  }

  let boundary = currentStart;
  for (let i = priorRuns.length - 1; i >= 0 && priorRuns[i].paused; i--) {
    boundary = priorRuns[i].start;
  }

  return events.slice(boundary);
}

function raisedInterrupt(event: Event): boolean {
  return requiresUserInput(event);
}

/**
 * Scans session events and reconstructs per-node state (outputs, routes, raised
 * interrupts, and resolved interrupt responses).
 */
export function reconstructNodeStates(
  events: Event[],
  parentPath?: string
): Map<string, RehydratedNode> {
  if (parentPath) {
    return reconstruct(events, (event) =>
      event.nodeInfo?.path
        ? directChildName(event.nodeInfo.path, parentPath)
        : undefined
    );
  }
  return reconstruct(events, (event) =>
    event.nodeInfo?.path ? nodeNameFromPath(event.nodeInfo.path) : event.author
  );
}

/**
 * Like {@link reconstructNodeStates} but keyed by the full node path
 * (`wf.node@runId`), so distinct dynamic (`ctx.runNode`) iterations are tracked
 * separately for per-run resume/dedup.
 */
export function reconstructNodeStatesByPath(
  events: Event[]
): Map<string, RehydratedNode> {
  return reconstruct(events, (event) => event.nodeInfo?.path ?? event.author);
}

/**
 * Every interrupt raised in `events` that now has an accepted reply, as
 * interrupt id -> value.
 */
export function resolvedInterruptResponses(
  events: Event[]
): Map<string, unknown> {
  const responseSchemas = responseSchemasByInterruptId(events);
  const newestUserTurn = lastUserEvent(events);
  const raised = new Set<string>();
  const open = new Set<string>();
  const resolved = new Map<string, unknown>();

  for (const event of events) {
    if (isCompactedEvent(event) && event.checkpointManifest) {
      for (const runs of Object.values(event.checkpointManifest.runsByPath)) {
        for (const run of runs) {
          for (const id of run.interruptIds) {
            raised.add(id);
            open.add(id);
          }
          for (const [id, val] of run.resolvedResponses) {
            open.delete(id);
            resolved.set(id, val);
          }
        }
      }
      continue;
    }
    if (event.author === 'user' && event.content?.parts) {
      for (const part of event.content.parts) {
        const fr = part.functionResponse;
        if (!fr?.id) {
          continue;
        }
        if (!open.has(fr.id)) {
          if (
            fr.name === REQUEST_INPUT_FUNCTION_CALL_NAME &&
            event === newestUserTurn
          ) {
            throw new Error(
              raised.has(fr.id)
                ? alreadyAnsweredMessage(fr.id, open)
                : unroutableReplyMessage(fr.id, open)
            );
          }
          continue;
        }
        const schema = responseSchemas.get(fr.id);
        const response = unwrapResponse(fr.response, schema);
        const mismatch = interruptResponseMismatch(fr.id, response, schema);
        if (mismatch) {
          if (event === newestUserTurn) {
            throw new Error(mismatch);
          }
          continue;
        }
        open.delete(fr.id);
        resolved.set(fr.id, response);
      }
      continue;
    }
    for (const id of event.longRunningToolIds ?? []) {
      raised.add(id);
      open.add(id);
    }
  }

  return resolved;
}

function waitingList(open: ReadonlySet<string>): string {
  return open.size
    ? `Still waiting: ${[...open].map((id) => `'${id}'`).join(', ')}.`
    : 'This run has no interrupt waiting for an answer.';
}

function unroutableReplyMessage(
  interruptId: string,
  open: ReadonlySet<string>
): string {
  return (
    `The reply carries interrupt id '${interruptId}', which does not match ` +
    `any interrupt this run raised. ${waitingList(open)} A reply must use the ` +
    `id from the 'adk_request_input' function call it answers. Nothing was ` +
    `resolved, so any waiting interrupt can still be answered.`
  );
}

function alreadyAnsweredMessage(
  interruptId: string,
  open: ReadonlySet<string>
): string {
  return (
    `Interrupt '${interruptId}' has already been answered, so this reply ` +
    `resolves nothing. Sending it again does not change the earlier answer, ` +
    `and it would otherwise be served as a new message, restarting the node ` +
    `that asked. ${waitingList(open)}`
  );
}

/**
 * Reconstructs each node's prior runs in order, rather than merging them into
 * one record per node.
 */
export function reconstructNodeRuns(
  events: Event[],
  parentPath?: string
): Map<string, RehydratedNode[]> {
  return reconstructRuns(events, keyFn(parentPath));
}

function keyFn(parentPath?: string): (event: Event) => string | undefined {
  if (parentPath) {
    return (event) =>
      event.nodeInfo?.path
        ? directChildName(event.nodeInfo.path, parentPath)
        : undefined;
  }
  return (event) =>
    event.nodeInfo?.path ? nodeNameFromPath(event.nodeInfo.path) : event.author;
}

function isRunClosed(node: RehydratedNode): boolean {
  return (
    node.output !== undefined ||
    node.route !== undefined ||
    node.interruptIds.size > 0
  );
}

function reconstruct(
  events: Event[],
  keyFor: (event: Event) => string | undefined
): Map<string, RehydratedNode> {
  const merged = new Map<string, RehydratedNode>();
  for (const [key, runs] of reconstructRuns(events, keyFor)) {
    const node: RehydratedNode = {
      interruptIds: new Set(),
      resolvedResponses: new Map(),
    };
    for (const run of runs) {
      if (run.output !== undefined) {
        node.output = run.output;
        node.branch = run.branch;
      }
      if (run.route !== undefined) node.route = run.route;
      if (run.input !== undefined) node.input = run.input;
      if (run.executionAuthority !== undefined) {
        node.executionAuthority = run.executionAuthority;
      }
      for (const id of run.interruptIds) node.interruptIds.add(id);
      for (const [id, value] of run.resolvedResponses) {
        node.resolvedResponses.set(id, value);
      }
    }
    merged.set(key, node);
  }
  return merged;
}

function reconstructRuns(
  events: Event[],
  keyFor: (event: Event) => string | undefined
): Map<string, RehydratedNode[]> {
  const nodes = new Map<string, RehydratedNode[]>();
  const interruptOwner = new Map<string, RehydratedNode>();
  const activeEvents = getActiveEvents(events);
  const resolved = resolvedInterruptResponses(activeEvents);

  const currentRun = (name: string): RehydratedNode => {
    let runs = nodes.get(name);
    if (!runs) {
      runs = [];
      nodes.set(name, runs);
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

  for (const event of activeEvents) {
    if (isCompactedEvent(event) && event.checkpointManifest) {
      for (const [fullPath, manifestRuns] of Object.entries(
        event.checkpointManifest.runsByPath
      )) {
        const syntheticEvent = {
          author: nodeNameFromPath(fullPath),
          nodeInfo: { path: fullPath },
        } as Event;
        const key = keyFor(syntheticEvent);
        if (!key) {
          continue;
        }
        let targetList = nodes.get(key);
        if (!targetList) {
          targetList = [];
          nodes.set(key, targetList);
        }
        for (const r of manifestRuns) {
          const cloned: RehydratedNode = {
            ...(r.output !== undefined ? { output: r.output } : {}),
            ...(r.route !== undefined ? { route: r.route } : {}),
            ...(r.branch !== undefined ? { branch: r.branch } : {}),
            ...(r.input !== undefined ? { input: r.input } : {}),
            ...(r.executionAuthority !== undefined
              ? { executionAuthority: r.executionAuthority }
              : {}),
            interruptIds: new Set(r.interruptIds),
            resolvedResponses: new Map(r.resolvedResponses),
          };
          for (const id of cloned.interruptIds) {
            interruptOwner.set(id, cloned);
            if (resolved.has(id)) {
              cloned.resolvedResponses.set(id, resolved.get(id));
            }
          }
          targetList.push(cloned);
        }
      }
      continue;
    }

    if (event.author === 'user' && event.content?.parts) {
      for (const part of event.content.parts) {
        const fr = part.functionResponse;
        if (fr?.id && interruptOwner.has(fr.id) && resolved.has(fr.id)) {
          interruptOwner
            .get(fr.id)!
            .resolvedResponses.set(fr.id, resolved.get(fr.id));
        }
      }
      continue;
    }

    const key = keyFor(event);
    if (!key) {
      continue;
    }
    const node = currentRun(key);
    if (event.output !== undefined) {
      node.output = event.output;
      node.branch = event.branch;
    }
    if (event.route !== undefined) {
      node.route = event.route as RouteValue | RouteValue[];
    }
    for (const id of event.longRunningToolIds ?? []) {
      node.interruptIds.add(id);
      interruptOwner.set(id, node);
    }
    const agentState = event.actions?.agentState;
    if (isRecord(agentState)) {
      if ('input' in agentState) {
        node.input = agentState.input;
      }
      if (typeof agentState.executionAuthority === 'string') {
        node.executionAuthority =
          agentState.executionAuthority as ExecutionAuthorityLevel;
      }
    }
  }

  return nodes;
}

function lastUserEvent(events: Event[]): Event | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].author === 'user') {
      return events[i];
    }
  }
  return undefined;
}

/**
 * Whether a rehydrated node can be fast-forwarded on resume: it produced a
 * result — an output or a route — and all of its raised interrupts have been
 * resolved.
 */
export function isFastForwardable(node: RehydratedNode): boolean {
  if (node.output === undefined && node.route === undefined) {
    return false;
  }
  for (const id of node.interruptIds) {
    if (!node.resolvedResponses.has(id)) {
      return false;
    }
  }
  return true;
}

/**
 * Builds the completion result for a fast-forwarded (cached) node on resume.
 */
export function makeFastForwardResult(
  parent: NodeContext,
  prior: RehydratedNode
): NodeResult {
  return {
    output: prior.output,
    route: prior.route,
    branch: prior.branch ?? parent.branch,
    interruptIds: [],
    executionAuthority: prior.executionAuthority ?? parent.executionAuthority,
  };
}

/** Extracts the node name (leaf, without run id) from a dotted node path. */
export function nodeNameFromPath(path: string): string {
  const leaf = path.split(/[./]/).pop() ?? path;
  return leaf.split('@')[0];
}

function directChildName(path: string, parentPath: string): string | undefined {
  const prefix = `${parentPath}.`;
  if (!path.startsWith(prefix)) {
    return undefined;
  }
  const rest = path.slice(prefix.length);
  if (rest.includes('.')) {
    return undefined;
  }
  return rest.split('@')[0];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Unwraps a `{result: value}` FunctionResponse envelope to the bare value.
 */
export function unwrapResponse(
  response: unknown,
  responseSchema?: unknown
): unknown {
  if (
    response &&
    typeof response === 'object' &&
    !Array.isArray(response) &&
    Object.keys(response).length === 1 &&
    RESULT_KEY in response
  ) {
    const value = (response as Record<string, unknown>)[RESULT_KEY];
    if (typeof value !== 'string' || acceptsString(responseSchema)) {
      return value;
    }
    return parseJsonIfPossible(value);
  }
  return response;
}

function acceptsString(jsonSchema: unknown): boolean {
  if (!isRecord(jsonSchema)) {
    return false;
  }
  const type = jsonSchema['type'];
  if (type === 'string') {
    return true;
  }
  if (Array.isArray(type) && type.includes('string')) {
    return true;
  }
  for (const key of ['anyOf', 'oneOf']) {
    const branches = jsonSchema[key];
    if (Array.isArray(branches) && branches.some(acceptsString)) {
      return true;
    }
  }
  return false;
}

function parseJsonIfPossible(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
