/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Hyperfused into ACR OpsRoom Core from google/adk-js v2.4.0 (commit 8dad457)
 * with zero external runtime dependencies and CheckpointManifest preservation.
 */

import { Event, stringifyContent, WorkflowContent } from '../../shims.js';
import {
  CompactedEvent,
  createCompactedEvent,
  isCompactedEvent,
} from '../compacted_event.js';
import { buildCheckpointManifest } from '../compaction_utils.js';
import { BaseSummarizer } from './base_summarizer.js';

export const DEFAULT_PROMPT_TEMPLATE = `The following is a conversation history between a user and an AI agent. Please summarize the conversation, focusing on key information, decisions made, and any pending tasks or questions. Keep the summary concise and informative.

{conversation_history}`;

/**
 * Minimal LLM interface matching ADK's BaseLlm.generateContentAsync.
 */
export interface SummarizerLlmLike {
  generateContentAsync(
    request: {
      contents: WorkflowContent[];
      config?: { systemInstruction?: string };
    },
    stream?: boolean
  ): AsyncGenerator<{ content?: WorkflowContent }, void, unknown>;
}

/**
 * Configuration options for LlmSummarizer.
 */
export interface LlmSummarizerOptions {
  /**
   * The LLM instance to use for generating the summary, or an optional
   * deterministic summary generator when running in offline/air-gapped mode.
   */
  llm?:
    | SummarizerLlmLike
    | ((prompt: string, events: Event[]) => Promise<string> | string);
  /**
   * Custom prompt template for the summarization request.
   * Must include the `{conversation_history}` placeholder.
   */
  promptTemplate?: string;
  /**
   * Optional system instruction to guide the LLM's summarization behavior.
   */
  systemInstruction?: string;
}

/**
 * Summarizes a sequence of events using an LLM (or deterministic fallback).
 */
export class LlmSummarizer implements BaseSummarizer {
  private readonly llm?:
    | SummarizerLlmLike
    | ((prompt: string, events: Event[]) => Promise<string> | string);
  private readonly promptTemplate: string;
  private readonly systemInstruction?: string;

  constructor(options: LlmSummarizerOptions = {}) {
    this.llm = options.llm;
    this.promptTemplate = options.promptTemplate ?? DEFAULT_PROMPT_TEMPLATE;
    this.systemInstruction = options.systemInstruction;
  }

  async summarizeEvents(events: Event[]): Promise<CompactedEvent | undefined> {
    if (events.length === 0) {
      return undefined;
    }

    const formattedHistory = this.formatEventsForPrompt(events);
    if (!formattedHistory.trim()) {
      return undefined;
    }

    const prompt = this.promptTemplate.replace(
      '{conversation_history}',
      formattedHistory
    );

    let summaryText = '';

    if (typeof this.llm === 'function') {
      summaryText = await this.llm(prompt, events);
    } else if (
      this.llm &&
      typeof this.llm.generateContentAsync === 'function'
    ) {
      const llmRequest = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: this.systemInstruction
          ? { systemInstruction: this.systemInstruction }
          : undefined,
      };
      for await (const response of this.llm.generateContentAsync(
        llmRequest,
        false
      )) {
        if (response.content?.parts) {
          for (const part of response.content.parts) {
            if (part.text) {
              summaryText += part.text;
            }
          }
        }
      }
    } else {
      // Deterministic zero-dependency structured summary fallback
      summaryText = `[Compacted ${events.length} events]\n${formattedHistory}`;
    }

    if (!summaryText.trim()) {
      return undefined;
    }

    const startTime = events[0].timestamp;
    const endTime = events[events.length - 1].timestamp;
    const compactedEventIds = this.collectCompactedEventIds(events);
    const checkpointManifest = buildCheckpointManifest(events);

    return createCompactedEvent({
      invocationId: events[events.length - 1].invocationId,
      author: 'system',
      startTime,
      endTime,
      compactedContent: {
        role: 'model',
        parts: [{ text: summaryText.trim() }],
      },
      compactedEventIds,
      checkpointManifest,
    });
  }

  private collectCompactedEventIds(events: Event[]): string[] {
    const ids = new Set<string>();
    for (const event of events) {
      if (isCompactedEvent(event) && event.compactedEventIds) {
        for (const priorId of event.compactedEventIds) {
          ids.add(priorId);
        }
      }
      if (event.id) {
        ids.add(event.id);
      }
    }
    return [...ids];
  }

  private formatEventsForPrompt(events: Event[]): string {
    const lines: string[] = [];

    for (const event of events) {
      if (isCompactedEvent(event)) {
        const text = stringifyContent(event.compactedContent).trim();
        if (text) {
          lines.push(`[Previous Summary]: ${text}`);
        }
      } else {
        const text = stringifyContent(event).trim();
        if (text) {
          const role = event.author || event.content?.role || 'unknown';
          lines.push(`${role}: ${text}`);
        } else if (event.nodeInfo?.runId && event.actions?.nodeState) {
          const path = event.nodeInfo.path ?? event.author ?? 'node';
          lines.push(
            `${path} (${event.actions.nodeState}): ${JSON.stringify(
              event.nodeInfo.output ?? event.nodeInfo.input ?? {}
            )}`
          );
        }
      }
    }

    return lines.join('\n');
  }
}
