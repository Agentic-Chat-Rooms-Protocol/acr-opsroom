/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provenance: Lifted from `google/adk-js` (commit `8dad457`, v2.4.0)
 * `core/src/workflow/nodes/tool_node.ts`.
 * Decoupled from `agents/functions.ts` so `@acr-js/opsroom-core` maintains zero
 * external runtime dependencies.
 */

import { BaseNode, BaseNodeConfig, isContent } from '../base_node.js';
import { NodeContext } from '../node_context.js';
import {
  BaseTool,
  createEvent,
  Event,
  joinBranchExecutionAuthority,
  ToolContextShim,
} from '../shims.js';
import { isNodeTool } from './node_tool.js';

/** Options for a {@link ToolNode}. */
export interface ToolNodeConfig extends Partial<Omit<BaseNodeConfig, 'name'>> {
  /** Optional name override; defaults to the tool's name. */
  name?: string;
}

/**
 * A node that wraps a {@link BaseTool} (including {@link NodeTool}) and invokes
 * it with the node input as its arguments, running `PluginManager` tool hooks
 * and propagating `executionAuthority` and `interruptIds`.
 */
export class ToolNode extends BaseNode {
  readonly tool: BaseTool;

  constructor(tool: BaseTool, config: ToolNodeConfig = {}) {
    super({
      ...config,
      name: config.name ?? tool.name,
      rerunOnResume: config.rerunOnResume ?? isNodeTool(tool),
    });
    if (tool.isLongRunning && !isNodeTool(tool)) {
      throw new Error(
        `ToolNode does not support long-running tools yet (tool '${tool.name}').`
      );
    }
    this.tool = tool;
  }

  protected async *runImpl(
    ctx: NodeContext,
    input: unknown
  ): AsyncGenerator<Event, void, void> {
    const args = this.validateInput(coerceToolArgs(input)) as Record<
      string,
      unknown
    >;

    const callId = `${ctx.nodePath || this.name}:${ctx.runId}`;
    const initialAuthority = ctx.executionAuthority;
    const toolContext: ToolContextShim = {
      invocationContext: ctx.invocationContext,
      invocationId: ctx.invocationId,
      agentName: this.name,
      functionCallId: callId,
      resumeInputs: ctx.resumeInputs,
      state: ctx.state,
      actions: ctx.actions,
      nodeContext: ctx,
      workflowId: ctx.workflowId,
      graphTopologyHash: ctx.graphTopologyHash,
      nodePath: ctx.nodePath,
      executionAuthority: initialAuthority,
      interruptIds: [],
    };

    const pluginManager = ctx.invocationContext.pluginManager;
    let rawResult: unknown;

    if (pluginManager?.hasPlugins && pluginManager.runBeforeToolCallback) {
      rawResult = await pluginManager.runBeforeToolCallback({
        tool: this.tool,
        toolArgs: args,
        toolContext,
      });
    }

    if (rawResult === undefined) {
      try {
        rawResult = await this.tool.runAsync({
          args,
          toolContext,
        });
      } catch (err) {
        const errorObj = err instanceof Error ? err : new Error(String(err));
        if (pluginManager?.hasPlugins && pluginManager.runOnToolErrorCallback) {
          const recovered = await pluginManager.runOnToolErrorCallback({
            tool: this.tool,
            toolArgs: args,
            toolContext,
            error: errorObj,
          });
          if (recovered !== undefined) {
            rawResult = recovered;
          } else {
            throw errorObj;
          }
        } else {
          throw errorObj;
        }
      }
    }

    if (toolContext.executionAuthority !== undefined) {
      ctx.executionAuthority = joinBranchExecutionAuthority(
        ctx.executionAuthority,
        toolContext.executionAuthority,
        initialAuthority
      );
    }

    if (toolContext.interruptIds && toolContext.interruptIds.length > 0) {
      for (const id of toolContext.interruptIds) {
        if (!ctx.interruptIds.includes(id)) {
          ctx.interruptIds.push(id);
        }
      }
      return;
    }

    let responseObj: Record<string, unknown> =
      typeof rawResult === 'object' &&
      rawResult !== null &&
      !Array.isArray(rawResult)
        ? (rawResult as Record<string, unknown>)
        : { result: rawResult ?? null };

    if (pluginManager?.hasPlugins && pluginManager.runAfterToolCallback) {
      const modified = await pluginManager.runAfterToolCallback({
        tool: this.tool,
        toolArgs: args,
        toolContext,
        result: responseObj,
      });
      if (modified !== undefined) {
        responseObj = modified;
      }
    }

    const validatedOutput = this.validateOutput(responseObj);

    const responseEvent = createEvent({
      author: this.name,
      invocationId: ctx.invocationId,
      branch: ctx.branch,
      content: {
        role: 'user',
        parts: [
          {
            functionResponse: {
              id: callId,
              name: this.tool.name,
              response: responseObj,
            },
          },
        ],
      },
      output: validatedOutput,
      actions: ctx.state.hasDelta()
        ? { stateDelta: { ...ctx.actions.stateDelta } }
        : undefined,
    });

    yield responseEvent;
  }
}

function coerceToolArgs(input: unknown): Record<string, unknown> {
  let args: unknown = input;

  if (isContent(args)) {
    args = extractText(args);
  }

  if (typeof args === 'string') {
    const trimmed = args.trim();
    if (!trimmed) {
      args = null;
    } else {
      try {
        args = JSON.parse(trimmed);
      } catch {
        // Leave as the raw string; rejected below.
      }
    }
  }

  if (args === null || args === undefined) {
    return {};
  }
  if (typeof args !== 'object' || Array.isArray(args)) {
    throw new TypeError(
      'The input to ToolNode must be an object of tool arguments or null, ' +
        `but got ${typeof args}.`
    );
  }
  return args as Record<string, unknown>;
}

function extractText(content: { parts?: Array<{ text?: string }> }): string {
  return (content.parts ?? []).map((p) => p.text ?? '').join('');
}
