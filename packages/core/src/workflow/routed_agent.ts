/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Hyperfused into ACR OpsRoom Core from google/adk-js v2.4.0 (commit 8dad457)
 * `core/src/agents/routed_agent.ts`.
 */

import { BaseNode, BaseNodeConfig } from './base_node.js';
import { NodeContext } from './node_context.js';
import { Event, InvocationContext } from './shims.js';

const ROUTED_AGENT_SIGNATURE_SYMBOL = Symbol.for('google.adk.routedAgent');

/**
 * Type guard to check if an object is an instance of RoutedAgent.
 */
export function isRoutedAgent(obj: unknown): obj is RoutedAgent {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    ROUTED_AGENT_SIGNATURE_SYMBOL in obj &&
    (obj as Record<symbol, unknown>)[ROUTED_AGENT_SIGNATURE_SYMBOL] === true
  );
}

/**
 * Interface for a candidate agent or node selectable by `RoutedAgent`.
 */
export interface RoutableAgentCandidate {
  readonly name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run?: (ctx: NodeContext, input: any) => AsyncGenerator<Event, void, void>;
  runAsync?: (
    parentContext: InvocationContext
  ) => AsyncGenerator<Event, void, undefined>;
}

/**
 * A function that selects an agent key from the available candidates based on
 * the current context.
 */
export type AgentRouter<K extends string = string> = (
  agents: Readonly<Record<K, RoutableAgentCandidate>>,
  context: InvocationContext,
  input?: unknown
) => Promise<K | undefined> | K | undefined;

/**
 * Configuration for RoutedAgent.
 */
export interface RoutedAgentConfig<K extends string = string>
  extends BaseNodeConfig {
  /**
   * A map of candidate agents or nodes keyed by their identifier.
   */
  agents: Record<K, RoutableAgentCandidate>;
  /**
   * The routing function that determines which agent to execute.
   */
  router: AgentRouter<K>;
}

/**
 * An agent / workflow node that dynamically routes execution to one of several
 * registered sub-agents or nodes using a deterministic router function.
 */
export class RoutedAgent<K extends string = string> extends BaseNode {
  readonly [ROUTED_AGENT_SIGNATURE_SYMBOL] = true;
  private readonly agentsMap: Readonly<Record<K, RoutableAgentCandidate>>;
  private readonly router: AgentRouter<K>;

  constructor(config: RoutedAgentConfig<K>) {
    super(config);
    this.agentsMap = Object.freeze({ ...config.agents });
    this.router = config.router;
  }

  protected override async *runImpl(
    ctx: NodeContext,
    input: unknown
  ): AsyncGenerator<Event, void, void> {
    const selectedKey = await this.router(
      this.agentsMap,
      ctx.invocationContext,
      input
    );

    if (selectedKey === undefined) {
      throw new Error(
        `RoutedAgent "${this.name}" router returned undefined; no agent selected.`
      );
    }

    const selectedAgent = this.agentsMap[selectedKey];
    if (!selectedAgent) {
      throw new Error(
        `RoutedAgent "${this.name}" router returned unknown agent key "${String(
          selectedKey
        )}". Available keys: ${Object.keys(this.agentsMap).join(', ')}`
      );
    }

    if (selectedAgent instanceof BaseNode) {
      const childResult = await ctx.runNode(selectedAgent, input, {
        nodeName: selectedAgent.name,
        useAsOutput: true,
      });
      ctx.output = childResult.output;
      if (childResult.route !== undefined) {
        ctx.route = childResult.route;
      }
      return;
    }

    if (typeof selectedAgent.run === 'function') {
      for await (const event of selectedAgent.run(ctx, input)) {
        if (event.output !== undefined) {
          ctx.output = event.output;
        }
        if (event.route !== undefined) {
          ctx.route = event.route;
        }
        yield event;
      }
      return;
    }

    if (typeof selectedAgent.runAsync === 'function') {
      for await (const event of selectedAgent.runAsync(ctx.invocationContext)) {
        if (event.output !== undefined) {
          ctx.output = event.output;
        }
        yield event;
      }
    }
  }

  async *runAsync(
    parentContext: InvocationContext
  ): AsyncGenerator<Event, void, undefined> {
    const selectedKey = await this.router(this.agentsMap, parentContext);

    if (selectedKey === undefined) {
      throw new Error(
        `RoutedAgent "${this.name}" router returned undefined; no agent selected.`
      );
    }

    const selectedAgent = this.agentsMap[selectedKey];
    if (!selectedAgent) {
      throw new Error(
        `RoutedAgent "${this.name}" router returned unknown agent key "${String(
          selectedKey
        )}". Available keys: ${Object.keys(this.agentsMap).join(', ')}`
      );
    }

    if (typeof selectedAgent.runAsync === 'function') {
      yield* selectedAgent.runAsync(parentContext);
    }
  }
}
