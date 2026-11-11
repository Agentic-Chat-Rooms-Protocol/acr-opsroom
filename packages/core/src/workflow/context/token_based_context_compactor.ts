/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Hyperfused into ACR OpsRoom Core from google/adk-js v2.4.0 (commit 8dad457)
 * with CheckpointManifest preservation and audit ledger commitment.
 */

import { getEventTokens, InvocationContext } from '../shims.js';
import {
  BaseContextCompactor,
  ContextCompactionTrigger,
} from './base_context_compactor.js';
import { attachCheckpointManifestAndAudit } from './checkpoint_safe_context_compactor.js';
import { calculateRetainStartIndex, getActiveEvents } from './compaction_utils.js';
import { BaseSummarizer } from './summarizers/base_summarizer.js';
import { LlmSummarizer, SummarizerLlmLike } from './summarizers/llm_summarizer.js';

/**
 * Configuration options for TokenBasedContextCompactor.
 */
export interface TokenBasedContextCompactorOptions {
  /**
   * The token count threshold that triggers compaction.
   */
  tokenThreshold: number;
  /**
   * The number of most recent events to retain uncompacted after compaction.
   */
  eventRetentionSize: number;
  /**
   * Either a custom BaseSummarizer instance or an LLM instance to use with a
   * default LlmSummarizer.
   */
  summarizer?:
    | BaseSummarizer
    | SummarizerLlmLike
    | ((prompt: string) => Promise<string> | string);
}

/**
 * Compacts context based on a token threshold while retaining a specified
 * number of recent events and preserving all workflow node checkpoints.
 */
export class TokenBasedContextCompactor implements BaseContextCompactor {
  private readonly tokenThreshold: number;
  private readonly eventRetentionSize: number;
  private readonly summarizer: BaseSummarizer;

  constructor(options: TokenBasedContextCompactorOptions) {
    this.tokenThreshold = options.tokenThreshold;
    this.eventRetentionSize = options.eventRetentionSize;

    if (options.summarizer && 'summarizeEvents' in options.summarizer) {
      this.summarizer = options.summarizer;
    } else {
      this.summarizer = new LlmSummarizer({ llm: options.summarizer });
    }
  }

  async shouldCompact(
    invocationContext: InvocationContext,
    trigger: ContextCompactionTrigger
  ): Promise<boolean> {
    if (trigger !== ContextCompactionTrigger.BeforeInvocation) {
      return false;
    }

    const activeEvents = getActiveEvents(
      invocationContext.session.events,
      invocationContext.isolationScope
    );

    if (activeEvents.length <= this.eventRetentionSize) {
      return false;
    }

    let totalTokens = 0;
    for (const event of activeEvents) {
      totalTokens += getEventTokens(event);
    }

    return totalTokens >= this.tokenThreshold;
  }

  async compact(invocationContext: InvocationContext): Promise<void> {
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
    const compactedEvent = await this.summarizer.summarizeEvents(eventsToCompact);

    if (compactedEvent) {
      if (scope) {
        compactedEvent.isolationScope = scope;
      }
      attachCheckpointManifestAndAudit({
        compactedEvent,
        eventsToCompact,
        invocationContext,
      });
      invocationContext.session.events.push(compactedEvent);
    }
  }
}
