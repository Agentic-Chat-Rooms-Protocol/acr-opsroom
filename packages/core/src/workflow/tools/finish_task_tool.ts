/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Hyperfused into ACR OpsRoom Core from google/adk-js v2.4.0 (commit 8dad457).
 */

import {
  BaseTool,
  parseWithSchema,
  RunAsyncToolRequest,
  SchemaLike,
} from '../shims.js';

export const FINISH_TASK_TOOL_NAME = 'finish_task';

export const FINISH_TASK_SUCCESS_RESULT = {
  status: 'Task marked as completed.',
} as const;

export interface FinishTaskToolOptions {
  /**
   * Optional schema validator (`safeParse`, `parse`, or `(val) => unknown`) for the
   * final task result when `outputSchema` is configured on an agent node.
   */
  outputSchema?: SchemaLike;
}

/**
 * A tool for an agent running in `'task'` mode to signal that it has completed
 * its assigned task and optionally return a structured result.
 */
export class FinishTaskTool extends BaseTool {
  readonly outputSchema?: SchemaLike;

  constructor(options: FinishTaskToolOptions = {}) {
    super({
      name: FINISH_TASK_TOOL_NAME,
      description:
        'Call this tool when you have completely finished the assigned task. Provide the final result or summary of your work.',
    });
    this.outputSchema = options.outputSchema;
  }

  override async runAsync(
    request: RunAsyncToolRequest
  ): Promise<unknown> {
    const rawResult =
      'result' in request.args ? request.args['result'] : request.args;

    if (this.outputSchema) {
      try {
        const parsed = parseWithSchema(this.outputSchema, rawResult);
        if (request.toolContext.actions) {
          request.toolContext.actions.escalate = true;
        }
        return parsed;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          error: `Output validation failed for finish_task: ${msg}`,
        };
      }
    }

    if (request.toolContext.actions) {
      request.toolContext.actions.escalate = true;
    }

    return rawResult !== undefined &&
      !(
        typeof rawResult === 'object' &&
        rawResult !== null &&
        Object.keys(rawResult as Record<string, unknown>).length === 0
      )
      ? rawResult
      : FINISH_TASK_SUCCESS_RESULT;
  }
}
