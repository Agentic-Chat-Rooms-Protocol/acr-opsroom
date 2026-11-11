/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Hyperfused into ACR OpsRoom Core from google/adk-js v2.4.0 (commit 8dad457)
 * `core/src/plugins/base_plugin.ts`.
 */

import { BaseNode } from '../base_node.js';
import { ContextCompactionTrigger } from '../context/base_context_compactor.js';
import { NodeContext } from '../node_context.js';
import {
  BaseTool,
  Event,
  InvocationContext,
  ToolContextShim,
  WorkflowContent,
} from '../shims.js';

export { ContextCompactionTrigger };

export interface LlmRequestShim {
  model?: string;
  contents: WorkflowContent[];
  config?: Record<string, unknown>;
}

export interface LlmResponseShim {
  content?: WorkflowContent;
  finishReason?: string;
  errorMessage?: string;
  errorCode?: string;
}

/**
 * Abstract base class for creating ADK & ACR OpsRoom workflow plugins.
 */
export abstract class BasePlugin {
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  async onUserMessageCallback(_params: {
    invocationContext: InvocationContext;
    userMessage: WorkflowContent;
  }): Promise<WorkflowContent | undefined> {
    return undefined;
  }

  async beforeRunCallback(_params: {
    invocationContext: InvocationContext;
  }): Promise<WorkflowContent | undefined> {
    return undefined;
  }

  async onEventCallback(_params: {
    invocationContext: InvocationContext;
    event: Event;
  }): Promise<Event | undefined> {
    return undefined;
  }

  async afterRunCallback(_params: {
    invocationContext: InvocationContext;
  }): Promise<void> {}

  async close(): Promise<void> {}

  async beforeAgentCallback(_params: {
    agent: unknown;
    callbackContext: unknown;
  }): Promise<WorkflowContent | undefined> {
    return undefined;
  }

  async afterAgentCallback(_params: {
    agent: unknown;
    callbackContext: unknown;
  }): Promise<WorkflowContent | undefined> {
    return undefined;
  }

  async beforeNodeCallback(_params: {
    node: BaseNode;
    nodeContext: NodeContext;
    input: unknown;
  }): Promise<unknown | undefined> {
    return undefined;
  }

  async afterNodeCallback(_params: {
    node: BaseNode;
    nodeContext: NodeContext;
    output: unknown;
  }): Promise<unknown | undefined> {
    return undefined;
  }

  async beforeModelCallback(_params: {
    callbackContext: { invocationId?: string; session?: { id?: string } };
    llmRequest: LlmRequestShim;
  }): Promise<LlmResponseShim | undefined> {
    return undefined;
  }

  async afterModelCallback(_params: {
    callbackContext: { invocationId?: string; session?: { id?: string } };
    llmResponse: LlmResponseShim;
  }): Promise<LlmResponseShim | undefined> {
    return undefined;
  }

  async onModelErrorCallback(_params: {
    callbackContext: { invocationId?: string; session?: { id?: string } };
    llmRequest: LlmRequestShim;
    error: Error;
  }): Promise<LlmResponseShim | undefined> {
    return undefined;
  }

  async beforeToolCallback(_params: {
    tool: BaseTool;
    toolArgs: Record<string, unknown>;
    toolContext: ToolContextShim;
  }): Promise<Record<string, unknown> | undefined> {
    return undefined;
  }

  async afterToolCallback(_params: {
    tool: BaseTool;
    toolArgs: Record<string, unknown>;
    toolContext: ToolContextShim;
    result: Record<string, unknown>;
  }): Promise<Record<string, unknown> | undefined> {
    return undefined;
  }

  async onToolErrorCallback(_params: {
    tool: BaseTool;
    toolArgs: Record<string, unknown>;
    toolContext: ToolContextShim;
    error: Error;
  }): Promise<Record<string, unknown> | undefined> {
    return undefined;
  }
}
