/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provenance: Lifted and adapted from `google/adk-js` (commit `8dad457`, v2.4.0)
 * `core/src/workflow/node_status.ts` for `@acr-js/opsroom-core`.
 * Extended with ACR Hyperfusion Extension 3 states (`RECONCILING`, `OUTCOME_UNKNOWN`).
 */

/**
 * The status of a node in the workflow graph.
 *
 * Numeric values 0..6 are aligned with `google/adk-python` `workflow/_node_status.py`
 * and `google/adk-js` `workflow/node_status.ts`. Values 7..8 extend the status
 * model for ACR Extension 3 side-effect-aware recovery (`DurableCommandWal`).
 */
export enum NodeStatus {
  /** The node is not ready to be executed. */
  INACTIVE = 0,
  /** The node is ready to be executed. */
  PENDING = 1,
  /** The node is being executed. */
  RUNNING = 2,
  /** The node has been executed successfully. */
  COMPLETED = 3,
  /** The node is waiting (e.g. for a user response, Passkey consent, or re-trigger). */
  WAITING = 4,
  /** The node has failed. */
  FAILED = 5,
  /** The node has been cancelled. */
  CANCELLED = 6,
  /** The node is probing external state after an in-flight timeout/interruption (ACR Extension 3). */
  RECONCILING = 7,
  /** The node's side effect was dispatched but external reconciliation was inconclusive (ACR Extension 3). */
  OUTCOME_UNKNOWN = 8,
}
