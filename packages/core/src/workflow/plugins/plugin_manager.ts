/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Hyperfused into ACR OpsRoom Core from google/adk-js v2.4.0 (commit 8dad457)
 * `core/src/plugins/plugin_manager.ts`.
 */

import { BaseNode } from '../base_node.js';
import { NodeContext } from '../node_context.js';
import {
  BaseTool,
  Event,
  InvocationContext,
  PluginManagerShim,
  ToolContextShim,
  WorkflowContent,
} from '../shims.js';
import { BasePlugin, LlmRequestShim, LlmResponseShim } from './base_plugin.js';

/**
 * Manages the registration and execution of workflow & tool plugins.
 * Implements early-exit (before/onError) and sequential chaining (onEvent/after)
 * semantics matching ADK 2.0 `PluginManager`.
 */
export class PluginManager implements PluginManagerShim {
  private readonly plugins: BasePlugin[] = [];

  constructor(plugins: BasePlugin[] = []) {
    for (const plugin of plugins) {
      this.registerPlugin(plugin);
    }
  }

  get hasPlugins(): boolean {
    return this.plugins.length > 0;
  }

  registerPlugin(plugin: BasePlugin): void {
    if (this.plugins.some((p) => p.name === plugin.name)) {
      throw new Error(`Plugin with name '${plugin.name}' already registered.`);
    }
    this.plugins.push(plugin);
  }

  getPlugin(pluginName: string): BasePlugin | undefined {
    return this.plugins.find((p) => p.name === pluginName);
  }

  async runBeforeRunCallback(params: {
    invocationContext: InvocationContext;
  }): Promise<WorkflowContent | undefined> {
    for (const plugin of this.plugins) {
      const res = await plugin.beforeRunCallback(params);
      if (res !== undefined) {
        return res;
      }
    }
    return undefined;
  }

  async runOnEventCallback(params: {
    invocationContext: InvocationContext;
    event: Event;
  }): Promise<Event | undefined> {
    let current = params.event;
    let modified = false;
    for (const plugin of this.plugins) {
      const next = await plugin.onEventCallback({
        invocationContext: params.invocationContext,
        event: current,
      });
      if (next !== undefined) {
        current = next;
        modified = true;
      }
    }
    return modified ? current : undefined;
  }

  async runBeforeNodeCallback(params: {
    node: unknown;
    nodeContext: unknown;
    input: unknown;
  }): Promise<unknown> {
    for (const plugin of this.plugins) {
      const res = await plugin.beforeNodeCallback({
        node: params.node as BaseNode,
        nodeContext: params.nodeContext as NodeContext,
        input: params.input,
      });
      if (res !== undefined) {
        return res;
      }
    }
    return undefined;
  }

  async runAfterNodeCallback(params: {
    node: unknown;
    nodeContext: unknown;
    output: unknown;
  }): Promise<unknown> {
    let current = params.output;
    let modified = false;
    for (const plugin of this.plugins) {
      const next = await plugin.afterNodeCallback({
        node: params.node as BaseNode,
        nodeContext: params.nodeContext as NodeContext,
        output: current,
      });
      if (next !== undefined) {
        current = next;
        modified = true;
      }
    }
    return modified ? current : undefined;
  }

  async runBeforeToolCallback(params: {
    tool: BaseTool;
    toolArgs: Record<string, unknown>;
    toolContext: ToolContextShim;
  }): Promise<Record<string, unknown> | undefined> {
    for (const plugin of this.plugins) {
      const res = await plugin.beforeToolCallback(params);
      if (res !== undefined) {
        return res;
      }
    }
    return undefined;
  }

  async runAfterToolCallback(params: {
    tool: BaseTool;
    toolArgs: Record<string, unknown>;
    toolContext: ToolContextShim;
    result: Record<string, unknown>;
  }): Promise<Record<string, unknown> | undefined> {
    let current = params.result;
    let modified = false;
    for (const plugin of this.plugins) {
      const next = await plugin.afterToolCallback({
        ...params,
        result: current,
      });
      if (next !== undefined) {
        current = next;
        modified = true;
      }
    }
    return modified ? current : undefined;
  }

  async runOnToolErrorCallback(params: {
    tool: BaseTool;
    toolArgs: Record<string, unknown>;
    toolContext: ToolContextShim;
    error: Error;
  }): Promise<Record<string, unknown> | undefined> {
    for (const plugin of this.plugins) {
      const res = await plugin.onToolErrorCallback(params);
      if (res !== undefined) {
        return res;
      }
    }
    return undefined;
  }

  async runBeforeModelCallback(params: {
    callbackContext: { invocationId?: string; session?: { id?: string } };
    llmRequest: LlmRequestShim;
  }): Promise<LlmResponseShim | undefined> {
    for (const plugin of this.plugins) {
      const res = await plugin.beforeModelCallback(params);
      if (res !== undefined) {
        return res;
      }
    }
    return undefined;
  }

  async runAfterModelCallback(params: {
    callbackContext: { invocationId?: string; session?: { id?: string } };
    llmResponse: LlmResponseShim;
  }): Promise<LlmResponseShim | undefined> {
    let current = params.llmResponse;
    let modified = false;
    for (const plugin of this.plugins) {
      const next = await plugin.afterModelCallback({
        callbackContext: params.callbackContext,
        llmResponse: current,
      });
      if (next !== undefined) {
        current = next;
        modified = true;
      }
    }
    return modified ? current : undefined;
  }
}
