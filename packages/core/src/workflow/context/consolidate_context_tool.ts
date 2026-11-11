/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Hyperfused into ACR OpsRoom Core from google/adk-js v2.4.0 (commit 8dad457).
 */

import { BaseTool, RunAsyncToolRequest } from '../shims.js';
import { PENDING_AGENT_COMPACTION_SUMMARY_KEY } from './agent_controlled_context_compactor.js';

/**
 * A tool that allows an agent to manually trigger context compaction by
 * providing a summary of the current conversation history.
 *
 * Must be used in conjunction with `AgentControlledContextCompactor`.
 */
export class ConsolidateContextTool extends BaseTool {
  constructor() {
    super({
      name: 'consolidate_context',
      description:
        'Consolidates and compacts the current conversation history into a concise summary to free up context window space. Call this tool when a major sub-task is complete or the history is getting long.',
    });
  }

  override async runAsync(
    request: RunAsyncToolRequest
  ): Promise<Record<string, unknown>> {
    const summary = request.args['summary'] as string | undefined;
    if (!summary || !summary.trim()) {
      return {
        status: 'error',
        message: 'A non-empty summary must be provided to consolidate context.',
      };
    }

    request.toolContext.state.set(
      PENDING_AGENT_COMPACTION_SUMMARY_KEY,
      summary.trim()
    );

    return {
      status: 'success',
      message:
        'Context consolidation scheduled. The history will be compacted using your summary.',
    };
  }
}
