/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provenance: Lifted from `google/adk-js` (commit `8dad457`, v2.4.0)
 * `core/src/workflow/nodes/join_node.ts`.
 */

import { BaseNode, BaseNodeConfig } from '../base_node.js';
import { NodeContext } from '../node_context.js';
import { createEvent, Event } from '../shims.js';

/**
 * A fan-in barrier node: via {@link requiresAllPredecessors} the engine holds it
 * until ALL of its predecessors complete, then runs it with their aggregated
 * outputs as input.
 */
export class JoinNode extends BaseNode {
  constructor(nameOrConfig: string | BaseNodeConfig) {
    super(
      typeof nameOrConfig === 'string' ? { name: nameOrConfig } : nameOrConfig
    );
  }

  override get requiresAllPredecessors(): boolean {
    return true;
  }

  protected async *runImpl(
    ctx: NodeContext,
    input: unknown
  ): AsyncGenerator<Event, void, void> {
    yield createEvent({
      author: this.name,
      invocationId: ctx.invocationId,
      branch: ctx.branch,
      output: input,
    });
  }
}
