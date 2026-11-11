/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Hyperfused into ACR OpsRoom Core from google/adk-js v2.4.0 (commit 8dad457)
 * with CheckpointManifest preservation and audit ledger commitment.
 */

import { InvocationContext } from '../shims.js';
import {
  BaseContextCompactor,
  ContextCompactionTrigger,
} from './base_context_compactor.js';
import { attachCheckpointManifestAndAudit } from './checkpoint_safe_context_compactor.js';
import { createCompactedEvent, isCompactedEvent } from './compacted_event.js';
import { calculateRetainStartIndex, getActiveEvents } from './compaction_utils.js';

export const PENDING_AGENT_COMPACTION_SUMMARY_KEY =
  '_adk_pending_agent_compaction_summary';

/**
 * Configuration options for AgentControlledContextCompactor.
 */
export interface AgentControlledContextCompactorOptions {
  /**
   * The number of most recent events to retain uncompacted after compaction.
   * Defaults to 2 (typically retaining the ConsolidateContextTool call and response).
   */
  eventRetentionSize?: number;
}

/**
 * Compacts context only when explicitly triggered by the agent via the
 * `ConsolidateContextTool`, while preserving all workflow node checkpoints.
 */
export class AgentControlledContextCompactor implements BaseContextCompactor {
  private readonly eventRetentionSize: number;

  constructor(options: AgentControlledContextCompactorOptions = {}) {
    this.eventRetentionSize = options.eventRetentionSize ?? 2;
  }

  async shouldCompact(
    invocationContext: InvocationContext,
    trigger: ContextCompactionTrigger
  ): Promise<boolean> {
    if (
      trigger !== ContextCompactionTrigger.Manual &&
      trigger !== ContextCompactionTrigger.AfterInvocation
    ) {
      return false;
    }

    const summary = invocationContext.session.state[
      PENDING_AGENT_COMPACTION_SUMMARY_KEY
    ] as string | undefined;

    return Boolean(summary && summary.trim().length > 0);
  }

  async compact(invocationContext: InvocationContext): Promise<void> {
    const summary = invocationContext.session.state[
      PENDING_AGENT_COMPACTION_SUMMARY_KEY
    ] as string | undefined;

    if (!summary || !summary.trim()) {
      return;
    }

    delete invocationContext.session.state[
      PENDING_AGENT_COMPACTION_SUMMARY_KEY
    ];

    const scope = invocationContext.isolationScope;
    const activeEvents = getActiveEvents(
      invocationContext.session.events,
      scope
    );

    const retainStartIndex = calculateRetainStartIndex(
      activeEvents,
      this.eventRetentionSize
    );

    if (retainStartIndex <= 0) {
      return;
    }

    const eventsToCompact = activeEvents.slice(0, retainStartIndex);
    const startTime = eventsToCompact[0].timestamp;
    const endTime = eventsToCompact[eventsToCompact.length - 1].timestamp;

    const compactedEventIds = new Set<string>();
    for (const ev of eventsToCompact) {
      if (isCompactedEvent(ev) && ev.compactedEventIds) {
        for (const id of ev.compactedEventIds) {
          compactedEventIds.add(id);
        }
      }
      if (ev.id) {
        compactedEventIds.add(ev.id);
      }
    }

    const compactedEvent = createCompactedEvent({
      invocationId: invocationContext.invocationId,
      author: 'system',
      startTime,
      endTime,
      compactedContent: {
        role: 'model',
        parts: [{ text: summary.trim() }],
      },
      compactedEventIds: [...compactedEventIds],
      ...(scope ? { isolationScope: scope } : {}),
    });

    attachCheckpointManifestAndAudit({
      compactedEvent,
      eventsToCompact,
      invocationContext,
    });

    invocationContext.session.events.push(compactedEvent);
  }
}
