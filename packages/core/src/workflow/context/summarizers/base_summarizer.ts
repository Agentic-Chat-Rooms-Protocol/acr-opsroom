/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Hyperfused into ACR OpsRoom Core from google/adk-js v2.4.0 (commit 8dad457).
 */

import { Event } from '../../shims.js';
import { CompactedEvent } from '../compacted_event.js';

/**
 * Abstract base interface for summarizing a sequence of events.
 */
export interface BaseSummarizer {
  /**
   * Summarizes the provided list of events into a single CompactedEvent.
   */
  summarizeEvents(events: Event[]): Promise<CompactedEvent | undefined>;
}
