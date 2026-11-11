/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Hyperfused into ACR OpsRoom Core from google/adk-js v2.4.0 (commit 8dad457).
 */

import { hasThoughts, InvocationContext, pruneThoughts } from '../shims.js';
import {
  BaseContextCompactor,
  ContextCompactionTrigger,
} from './base_context_compactor.js';
import { getActiveEvents } from './compaction_utils.js';

/**
 * Configuration options for TrajectoryThoughtPruningCompactor.
 */
export interface TrajectoryThoughtPruningCompactorOptions {
  /**
   * The number of most recent events to retain with their thoughts intact.
   * Defaults to 1 (retaining thoughts only for the very latest event).
   */
  eventRetentionSize?: number;
}

/**
 * A deterministic, zero-LLM-cost compactor that removes internal reasoning
 * thoughts (`part.thought === true`) from older events in the trajectory.
 */
export class TrajectoryThoughtPruningCompactor implements BaseContextCompactor {
  private readonly eventRetentionSize: number;

  constructor(options: TrajectoryThoughtPruningCompactorOptions = {}) {
    this.eventRetentionSize = options.eventRetentionSize ?? 1;
  }

  shouldCompact(
    invocationContext: InvocationContext,
    trigger: ContextCompactionTrigger
  ): boolean {
    if (
      trigger !== ContextCompactionTrigger.AfterInvocation &&
      trigger !== ContextCompactionTrigger.Manual
    ) {
      return false;
    }

    const activeEvents = getActiveEvents(
      invocationContext.session.events,
      invocationContext.isolationScope
    );
    const pruneEndIndex = activeEvents.length - this.eventRetentionSize;

    if (pruneEndIndex <= 0) {
      return false;
    }

    for (let i = 0; i < pruneEndIndex; i++) {
      if (hasThoughts(activeEvents[i])) {
        return true;
      }
    }

    return false;
  }

  compact(invocationContext: InvocationContext): void {
    const activeEvents = getActiveEvents(
      invocationContext.session.events,
      invocationContext.isolationScope
    );
    const pruneEndIndex = activeEvents.length - this.eventRetentionSize;

    if (pruneEndIndex <= 0) {
      return;
    }

    for (let i = 0; i < pruneEndIndex; i++) {
      pruneThoughts(activeEvents[i]);
    }
  }
}
