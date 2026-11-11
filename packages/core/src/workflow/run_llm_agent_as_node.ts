/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Hyperfused into ACR OpsRoom Core from google/adk-js v2.4.0 (commit 8dad457)
 * `core/src/workflow/run_llm_agent_as_node.ts` with CheckpointManifest
 * predecessor output resolution across compacted sessions.
 */

import { isCompactedEvent } from './context/compacted_event.js';
import { WorkflowInstructionScope } from './instructions.js';
import { NodeContext } from './node_context.js';
import {
  BaseTool,
  createEvent,
  Event,
  getFunctionCalls,
  getFunctionResponses,
  InvocationContext,
  isFinalResponse,
  parseWithSchema,
  SchemaLike,
  toContent,
} from './shims.js';
import {
  FINISH_TASK_SUCCESS_RESULT,
  FINISH_TASK_TOOL_NAME,
  FinishTaskTool,
} from './tools/finish_task_tool.js';
import { requiresUserInput } from './utils/hitl_utils.js';
import { nodeNameFromPath } from './utils/rehydration_utils.js';

export type AgentExecutionMode = 'single_turn' | 'task';

/**
 * Minimal duck-typed interface for an LlmAgent-compatible object.
 */
export interface LlmAgentNodeTarget {
  readonly name: string;
  readonly mode?: AgentExecutionMode;
  readonly maxSteps?: number;
  readonly outputSchema?: SchemaLike;
  tools?: Array<BaseTool | unknown>;
  canonicalTools?: (ctx?: unknown) => Promise<BaseTool[]>;
  runImpl: (
    ctx: InvocationContext
  ) => AsyncGenerator<Event, void, undefined>;
}

/**
 * Node-mode runner for an {@link LlmAgentNodeTarget}.
 */
export async function* runLlmAgentAsNode(
  agent: LlmAgentNodeTarget,
  ctx: NodeContext,
  input: unknown
): AsyncGenerator<Event, void, void> {
  if (!isStructuredInput(input)) {
    pushNodeInputAsUserTurn(ctx, input);
  }
  const ic = withWorkflowInstructionScope(ctx, input);

  if (agent.mode === 'task') {
    yield* runTaskMode(agent, ctx, ic);
    return;
  }

  let lastResponseText: string | undefined;
  let paused = false;
  for await (const event of agent.runImpl(ic)) {
    const text = extractModelResponseText(agent.name, event);
    if (text !== undefined) {
      lastResponseText = text;
    }
    if (requiresUserInput(event)) {
      paused = true;
    }
    yield event;
  }

  if (!paused && ctx.output === undefined && lastResponseText !== undefined) {
    maybeSetOutput(agent, ctx, lastResponseText);
  }
}

export function isStructuredInput(input: unknown): boolean {
  return (
    typeof input === 'object' &&
    input !== null &&
    !Array.isArray(input) &&
    !(input instanceof Date)
  );
}

/**
 * Builds an `InvocationContext` carrying a `WorkflowInstructionScope` for the
 * current node run so `<Class.field from node>` placeholders resolve against
 * both uncompacted events and `CompactedEvent.checkpointManifest.outputsByNode`.
 */
export function withWorkflowInstructionScope(
  ctx: NodeContext,
  input: unknown
): InvocationContext {
  const scope: WorkflowInstructionScope = {
    input,
    outputsByNode: collectPredecessorOutputs(ctx),
  };
  return ctx.invocationContext.clone({ workflowInstructionScope: scope });
}

export function collectPredecessorOutputs(
  ctx: NodeContext
): Record<string, unknown> {
  const outputs: Record<string, unknown> = {};
  for (const event of ctx.session?.events ?? []) {
    if (isCompactedEvent(event) && event.checkpointManifest?.outputsByNode) {
      for (const [k, v] of Object.entries(
        event.checkpointManifest.outputsByNode
      )) {
        outputs[k] = v;
      }
      continue;
    }
    if (event.output === undefined) {
      continue;
    }
    if (event.author) {
      outputs[event.author] = event.output;
    }
    if (event.nodeInfo?.path) {
      outputs[event.nodeInfo.path] = event.output;
      outputs[nodeNameFromPath(event.nodeInfo.path)] = event.output;
    }
    for (const path of event.nodeInfo?.outputFor ?? []) {
      outputs[path] = event.output;
      outputs[nodeNameFromPath(path)] = event.output;
    }
  }
  return outputs;
}

export async function* runTaskMode(
  agent: LlmAgentNodeTarget,
  ctx: NodeContext,
  ic: InvocationContext
): AsyncGenerator<Event, void, void> {
  const hasFinishTool = await hasFinishTaskTool(agent);
  const finishTool = hasFinishTool
    ? undefined
    : new FinishTaskTool({ outputSchema: agent.outputSchema });
  if (finishTool && Array.isArray(agent.tools)) {
    agent.tools.push(finishTool);
  }

  try {
    let steps = 0;
    const maxSteps = agent.maxSteps ?? Number.POSITIVE_INFINITY;
    let lastResponseText: string | undefined;

    while (steps < maxSteps) {
      if (ic.abortSignal?.aborted) {
        return;
      }
      steps++;

      let taskFinished = false;
      let finishResult: unknown;
      let escalated = false;
      let paused = false;

      for await (const event of agent.runImpl(ic)) {
        const text = extractModelResponseText(agent.name, event);
        if (text !== undefined) {
          lastResponseText = text;
        }
        if (requiresUserInput(event)) {
          paused = true;
        }
        for (const resp of getFunctionResponses(event)) {
          if (resp.name === FINISH_TASK_TOOL_NAME) {
            if (!isToolErrorResponse(resp.response)) {
              taskFinished = true;
              finishResult = resp.response;
            }
          }
        }
        if (event.actions?.escalate) {
          escalated = true;
        }
        yield event;
      }

      if (paused) {
        return;
      }

      if (taskFinished) {
        if (ctx.output === undefined) {
          const isGenericSuccess =
            finishResult &&
            typeof finishResult === 'object' &&
            'status' in finishResult &&
            (finishResult as { status: unknown }).status ===
              FINISH_TASK_SUCCESS_RESULT.status &&
            Object.keys(finishResult as Record<string, unknown>).length === 1;

          const outputValue =
            finishResult !== undefined && !isGenericSuccess
              ? finishResult
              : lastResponseText;
          if (outputValue !== undefined) {
            ctx.output = outputValue;
          }
        }
        return;
      }

      if (escalated) {
        if (ctx.output === undefined && lastResponseText !== undefined) {
          maybeSetOutput(agent, ctx, lastResponseText);
        }
        return;
      }

      if (steps < maxSteps) {
        const nudgeEvent = createEvent({
          invocationId: ctx.invocationId,
          author: 'user',
          branch: ctx.branch,
          isolationScope: ctx.isolationScope,
          content: {
            role: 'user',
            parts: [
              {
                text: `System Reminder: You have not called the \`${FINISH_TASK_TOOL_NAME}\` tool yet. Please continue working on the task, or call \`${FINISH_TASK_TOOL_NAME}\` if you have completed it.`,
              },
            ],
          },
        });
        yield nudgeEvent;
      }
    }

    if (ctx.output === undefined && lastResponseText !== undefined) {
      maybeSetOutput(agent, ctx, lastResponseText);
    }
  } finally {
    if (finishTool && Array.isArray(agent.tools)) {
      const idx = agent.tools.indexOf(finishTool);
      if (idx !== -1) {
        agent.tools.splice(idx, 1);
      }
    }
  }
}

async function hasFinishTaskTool(agent: LlmAgentNodeTarget): Promise<boolean> {
  if (typeof agent.canonicalTools === 'function') {
    const tools = await agent.canonicalTools();
    return tools.some((t) => t.name === FINISH_TASK_TOOL_NAME);
  }
  if (Array.isArray(agent.tools)) {
    return agent.tools.some(
      (t) =>
        typeof t === 'object' &&
        t !== null &&
        'name' in t &&
        (t as { name: string }).name === FINISH_TASK_TOOL_NAME
    );
  }
  return false;
}

function isToolErrorResponse(response: unknown): boolean {
  return (
    typeof response === 'object' &&
    response !== null &&
    'error' in response &&
    Boolean((response as Record<string, unknown>)['error'])
  );
}

export function maybeSetOutput(
  agent: Pick<LlmAgentNodeTarget, 'name' | 'outputSchema'>,
  ctx: NodeContext,
  lastResponseText: string
): void {
  if (agent.outputSchema) {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(lastResponseText);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `Agent "${agent.name}" output is not valid JSON for outputSchema: ${msg}`
      );
    }
    try {
      ctx.output = parseWithSchema(agent.outputSchema, parsedJson);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `Agent "${agent.name}" output failed schema validation: ${msg}`
      );
    }
  } else {
    ctx.output = lastResponseText;
  }
}

export function pushNodeInputAsUserTurn(
  ctx: NodeContext,
  input: unknown
): void {
  if (input === undefined || input === null || !ctx.session) {
    return;
  }
  const content = toContent(input);
  if (!content) {
    return;
  }
  const existing = lastUserEventContent(ctx.session.events, ctx.branch);
  if (existing && sameParts(existing.parts, content.parts)) {
    return;
  }
  ctx.session.events.push(
    createEvent({
      invocationId: ctx.invocationId,
      author: 'user',
      branch: ctx.branch,
      isolationScope: ctx.isolationScope,
      content,
    })
  );
}

function lastUserEventContent(events: Event[], branch: string | undefined) {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.branch !== branch) {
      continue;
    }
    if (ev.author === 'user') {
      return ev.content;
    }
  }
  return undefined;
}

function sameParts(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function extractModelResponseText(
  agentName: string,
  event: Event
): string | undefined {
  if (event.author !== agentName || event.partial) {
    return undefined;
  }
  if (!isFinalResponse(event) && getFunctionCalls(event).length > 0) {
    return undefined;
  }
  const parts = event.content?.parts;
  if (!parts || parts.length === 0) {
    return undefined;
  }
  const texts: string[] = [];
  for (const part of parts) {
    if (typeof part.text === 'string' && !part.thought) {
      texts.push(part.text);
    }
  }
  return texts.length > 0 ? texts.join('') : undefined;
}
