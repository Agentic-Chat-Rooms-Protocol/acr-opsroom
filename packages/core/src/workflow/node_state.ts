/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provenance: Lifted from `google/adk-js` (commit `8dad457`, v2.4.0)
 * `core/src/workflow/node_state.ts`.
 */

import { NodeStatus } from './node_status.js';

/**
 * State of a node in the workflow.
 */
export interface NodeState {
  /** The run status of the node. */
  status: NodeStatus;
  /** The input provided to the node. */
  input?: unknown;
  /** The attempt count for this node run (1-based). */
  attemptCount: number;
  /** The interrupt ids that are pending to be resolved. */
  interrupts: string[];
  /** The responses for resuming the node, keyed by interrupt id. */
  resumeInputs: Record<string, unknown>;
  /** Sequential counter incremented each time the node gets a fresh run. */
  runCounter: number;
  /** The run ID of this node run. */
  runId?: string;
  /** The run ID of the parent node which dynamically scheduled this node run. */
  parentRunId?: string;
  /** ACR Extension 3: Whether a side-effecting command was already dispatched in this run. */
  sideEffectDispatched?: boolean;
}

/**
 * Creates a {@link NodeState} with Python-aligned defaults, overlaying any
 * provided partial values.
 */
export function createNodeState(partial?: Partial<NodeState>): NodeState {
  return {
    status: NodeStatus.INACTIVE,
    attemptCount: 1,
    interrupts: [],
    resumeInputs: {},
    runCounter: 0,
    ...partial,
  };
}

/**
 * Type guard for a {@link NodeState}-shaped object.
 */
export function isNodeState(obj: unknown): obj is NodeState {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'status' in obj &&
    typeof (obj as NodeState).status === 'number' &&
    'attemptCount' in obj &&
    'interrupts' in obj &&
    Array.isArray((obj as NodeState).interrupts)
  );
}
