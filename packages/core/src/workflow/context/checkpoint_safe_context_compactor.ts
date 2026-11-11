/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * ACR Hyperfusion Extension: CheckpointSafeContextCompactor.
 * Guarantees that context compaction preserves all @runId checkpoints,
 * predecessor outputs, and elevated executionAuthority across Compaction boundaries,
 * and records EVENT_COMPACTION_COMMITTED on the CryptographicAuditLedger.
 */

import { Event, InvocationContext } from '../shims.js';
import {
  BaseContextCompactor,
  ContextCompactionTrigger,
} from './base_context_compactor.js';
import { CompactedEvent, isCompactedEvent } from './compacted_event.js';
import { buildCheckpointManifest, getActiveEvents } from './compaction_utils.js';

/**
 * Enriches a `CompactedEvent` with deterministic `compactedEventIds` and a
 * `checkpointManifest` extracted from `eventsToCompact`, and appends an
 * `EVENT_COMPACTION_COMMITTED` block to `invocationContext.auditLedger` if present.
 */
export function attachCheckpointManifestAndAudit(params: {
  compactedEvent: CompactedEvent;
  eventsToCompact: Event[];
  invocationContext: InvocationContext;
}): CompactedEvent {
  const { compactedEvent, eventsToCompact, invocationContext } = params;

  const ids = new Set<string>(compactedEvent.compactedEventIds ?? []);
  for (const ev of eventsToCompact) {
    if (isCompactedEvent(ev) && ev.compactedEventIds) {
      for (const id of ev.compactedEventIds) {
        ids.add(id);
      }
    }
    if (ev.id) {
      ids.add(ev.id);
    }
  }
  compactedEvent.compactedEventIds = [...ids];

  if (!compactedEvent.checkpointManifest) {
    compactedEvent.checkpointManifest =
      buildCheckpointManifest(eventsToCompact);
  }
  if (!compactedEvent.checkpointManifest.invocationId) {
    compactedEvent.checkpointManifest.invocationId =
      invocationContext.invocationId;
  }
  if (!compactedEvent.invocationId) {
    compactedEvent.invocationId = invocationContext.invocationId;
  }

  if (invocationContext.auditLedger) {
    invocationContext.auditLedger.appendBlock(
      invocationContext.session.id,
      'EVENT_COMPACTION_COMMITTED',
      'system:context-compactor',
      {
        invocationId: invocationContext.invocationId,
        compactedEventId: compactedEvent.id,
        compactedCount: eventsToCompact.length,
        startTime: compactedEvent.startTime,
        endTime: compactedEvent.endTime,
        checkpointNodePaths: Object.keys(
          compactedEvent.checkpointManifest.runsByPath
        ),
        highestAuthority: compactedEvent.checkpointManifest.highestAuthority,
      }
    );
  }

  return compactedEvent;
}

export interface CheckpointSafeContextCompactorOptions {
  /**
   * Underlying compactor strategy (e.g. `AnchoredContextCompactor`,
   * `TokenBasedContextCompactor`, or `AgentControlledContextCompactor`).
   */
  delegate: BaseContextCompactor;
}

/**
 * Decorator / wrapper around any `BaseContextCompactor` that guarantees
 * checkpoint-safe manifest attachment and `EVENT_COMPACTION_COMMITTED`
 * cryptographic audit logging even for custom user-supplied compactors.
 */
export class CheckpointSafeContextCompactor implements BaseContextCompactor {
  readonly delegate: BaseContextCompactor;

  constructor(options: CheckpointSafeContextCompactorOptions | BaseContextCompactor) {
    this.delegate = 'delegate' in options ? options.delegate : options;
  }

  async shouldCompact(
    invocationContext: InvocationContext,
    trigger: ContextCompactionTrigger
  ): Promise<boolean> {
    return await this.delegate.shouldCompact(invocationContext, trigger);
  }

  async compact(invocationContext: InvocationContext): Promise<void> {
    const scope = invocationContext.isolationScope;
    const preCompactionActive = getActiveEvents(
      invocationContext.session.events,
      scope
    );
    const prevLength = invocationContext.session.events.length;

    await this.delegate.compact(invocationContext);

    const events = invocationContext.session.events;
    if (events.length > prevLength) {
      const lastEvent = events[events.length - 1];
      if (isCompactedEvent(lastEvent) && !lastEvent.checkpointManifest) {
        const postActive = getActiveEvents(events, scope);
        const retainedIds = new Set(
          postActive.filter((e) => e !== lastEvent).map((e) => e.id)
        );
        const eventsToCompact = preCompactionActive.filter(
          (e) => !retainedIds.has(e.id)
        );
        attachCheckpointManifestAndAudit({
          compactedEvent: lastEvent,
          eventsToCompact,
          invocationContext,
        });
      }
    }
  }
}
