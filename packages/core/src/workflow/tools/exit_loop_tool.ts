/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Hyperfused into ACR OpsRoom Core from google/adk-js v2.4.0 (commit 8dad457).
 */

import { BaseTool, RunAsyncToolRequest } from '../shims.js';

export const EXIT_LOOP_TOOL_NAME = 'exit_loop';

/**
 * A tool that allows an agent to exit a loop (`LoopAgent` or `task`-mode loop)
 * by setting `actions.escalate = true`.
 */
export class ExitLoopTool extends BaseTool {
  constructor() {
    super({
      name: EXIT_LOOP_TOOL_NAME,
      description:
        'Exits the loop.\n\nCall this function only when you are instructed to do so.',
    });
  }

  override async runAsync({
    toolContext,
  }: RunAsyncToolRequest): Promise<Record<string, unknown>> {
    if (toolContext.actions) {
      toolContext.actions.escalate = true;
      toolContext.actions.skipSummarization = true;
    }
    return { status: 'Loop exited.' };
  }
}

export const EXIT_LOOP = new ExitLoopTool();
