/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provenance: Lifted from `google/adk-js` (commit `8dad457`, v2.4.0)
 * `core/src/workflow/trigger.ts`. Extended with `executionAuthority` for ACR Extension 2.
 */

import type { ExecutionAuthorityLevel } from './shims.js';

/**
 * A buffered trigger for a downstream node.
 */
export interface Trigger {
  /** The input to pass to the triggered node. */
  input?: unknown;
  /** Whether this trigger should run the node in an isolated sub-branch. */
  useSubBranch?: boolean;
  /** The branch inherited from the predecessor node. */
  branch?: string;
  /** Scope tag explicitly propagated to this trigger. */
  isolationScope?: string;
  /** ACR Extension 2: Execution authority propagated along this branch path. */
  executionAuthority?: ExecutionAuthorityLevel;
}
