/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Provenance: Lifted and adapted from `google/adk-js` (commit `8dad457`, v2.4.0)
 * `core/src/workflow/errors.ts`. Extended with ACR Hyperfusion Extensions 1–5 errors:
 * `NodeOutcomeUnknownError`, `StaleGenerationFenceError`, and `NodePrivilegeEscalationError`.
 */

/**
 * Internal: raised when a dynamic node interrupts (HITL).
 */
export class NodeInterruptedError extends Error {
  constructor(message = 'Node interrupted (awaiting resume input).') {
    super(message);
    this.name = 'NodeInterruptedError';
    Object.setPrototypeOf(this, NodeInterruptedError.prototype);
  }
}

export function isNodeInterruptedError(e: unknown): e is NodeInterruptedError {
  return e instanceof Error && e.name === 'NodeInterruptedError';
}

/**
 * Raised when a node exceeds its configured timeout.
 */
export class NodeTimeoutError extends Error {
  readonly nodeName: string;
  readonly timeout: number;

  constructor(options: { nodeName: string; timeout: number }) {
    super(
      `Node '${options.nodeName}' timed out after ${options.timeout} seconds.`
    );
    this.name = 'NodeTimeoutError';
    this.nodeName = options.nodeName;
    this.timeout = options.timeout;
    Object.setPrototypeOf(this, NodeTimeoutError.prototype);
  }
}

export function isNodeTimeoutError(e: unknown): e is NodeTimeoutError {
  return e instanceof Error && e.name === 'NodeTimeoutError';
}

/**
 * Raised when a dynamic node fails.
 */
export class DynamicNodeFailError extends Error {
  readonly error: Error;
  readonly errorNodePath: string;

  constructor(options: { message: string; error: Error; errorNodePath: string }) {
    super(options.message);
    this.name = 'DynamicNodeFailError';
    this.error = options.error;
    this.errorNodePath = options.errorNodePath;
    Object.setPrototypeOf(this, DynamicNodeFailError.prototype);
  }
}

export function isDynamicNodeFailError(e: unknown): e is DynamicNodeFailError {
  return e instanceof Error && e.name === 'DynamicNodeFailError';
}

/**
 * Raised when a node reported a failure by emitting an error event instead of
 * throwing, and produced nothing.
 */
export class NodeReportedError extends Error {
  readonly code: string;
  readonly nodeName: string;

  constructor(options: {
    nodeName: string;
    errorCode?: string;
    errorMessage?: string;
  }) {
    const code = options.errorCode ?? 'UNKNOWN_ERROR';
    const detail = options.errorMessage ?? code;
    super(
      `Node '${options.nodeName}' failed: ${
        code === 'UNKNOWN_ERROR' ? detail : `${code}: ${detail}`
      }`
    );
    this.name = 'NodeReportedError';
    this.code = code;
    this.nodeName = options.nodeName;
    Object.setPrototypeOf(this, NodeReportedError.prototype);
  }
}

export function isNodeReportedError(e: unknown): e is NodeReportedError {
  return e instanceof Error && e.name === 'NodeReportedError';
}

/**
 * Raised when the invocation is aborted while the engine is waiting.
 */
export class InvocationAbortedError extends Error {
  constructor(message = 'Invocation aborted.') {
    super(message);
    this.name = 'InvocationAbortedError';
    Object.setPrototypeOf(this, InvocationAbortedError.prototype);
  }
}

export function isInvocationAbortedError(
  e: unknown
): e is InvocationAbortedError {
  return e instanceof Error && e.name === 'InvocationAbortedError';
}

/**
 * Raised when a node's input or output fails its declared schema.
 */
export class NodeSchemaValidationError extends Error {
  readonly nodeName: string;
  readonly direction: 'input' | 'output';

  constructor(options: {
    nodeName: string;
    direction: 'input' | 'output';
    cause: unknown;
  }) {
    const schemaName =
      options.direction === 'input' ? 'inputSchema' : 'outputSchema';
    const detail =
      options.cause instanceof Error
        ? options.cause.message
        : String(options.cause);
    super(
      `Node '${options.nodeName}' ${options.direction} does not match its ` +
        `${schemaName}: ${detail}`,
      { cause: options.cause }
    );
    this.name = 'NodeSchemaValidationError';
    this.nodeName = options.nodeName;
    this.direction = options.direction;
    Object.setPrototypeOf(this, NodeSchemaValidationError.prototype);
  }
}

export function isNodeSchemaValidationError(
  e: unknown
): e is NodeSchemaValidationError {
  return e instanceof Error && e.name === 'NodeSchemaValidationError';
}

/**
 * ACR Extension 3 (`DurableCommandWal`): Raised when a side-effecting node
 * timed out or crashed after entering `DISPATCHED` and external reconciliation
 * could not deterministically confirm completion or non-existence.
 * Non-retryable to prevent duplicate external mutations.
 */
export class NodeOutcomeUnknownError extends Error {
  readonly nodeName: string;
  readonly commandId: string;
  readonly idempotencyKey: string;
  readonly code = 'OUTCOME_UNKNOWN';

  constructor(options: {
    nodeName: string;
    commandId: string;
    idempotencyKey: string;
    reason?: string;
  }) {
    super(
      `Node '${options.nodeName}' side-effect outcome is unknown for command '${options.commandId}' (idempotencyKey=${options.idempotencyKey})${
        options.reason ? `: ${options.reason}` : ''
      }. Blind retry is forbidden.`
    );
    this.name = 'NodeOutcomeUnknownError';
    this.nodeName = options.nodeName;
    this.commandId = options.commandId;
    this.idempotencyKey = options.idempotencyKey;
    Object.setPrototypeOf(this, NodeOutcomeUnknownError.prototype);
  }
}

export function isNodeOutcomeUnknownError(
  e: unknown
): e is NodeOutcomeUnknownError {
  return e instanceof Error && e.name === 'NodeOutcomeUnknownError';
}

/**
 * ACR Extensions 1 & 4 (`OwnershipFencingRegistry`): Raised when a zombie
 * workflow runner attempts to commit a state delta or node mutation with a
 * stale `ownership_generation` or mismatched `fencing_token`.
 */
export class StaleGenerationFenceError extends Error {
  readonly nodeName: string;
  readonly resourceUri: string;
  readonly attemptedGeneration: string;
  readonly activeGeneration: string;
  readonly statusCode = 409;
  readonly code = 'STALE_OWNERSHIP_GENERATION';

  constructor(options: {
    nodeName: string;
    resourceUri: string;
    attemptedGeneration: string | number | bigint;
    activeGeneration: string | number | bigint;
  }) {
    const attemptedStr = String(options.attemptedGeneration);
    const activeStr = String(options.activeGeneration);
    super(
      `Stale generation fence violation in node '${options.nodeName}' on resource '${options.resourceUri}': attempted generation ${attemptedStr} < active generation ${activeStr}`
    );
    this.name = 'StaleGenerationFenceError';
    this.nodeName = options.nodeName;
    this.resourceUri = options.resourceUri;
    this.attemptedGeneration = attemptedStr;
    this.activeGeneration = activeStr;
    Object.setPrototypeOf(this, StaleGenerationFenceError.prototype);
  }
}

export function isStaleGenerationFenceError(
  e: unknown
): e is StaleGenerationFenceError {
  return e instanceof Error && e.name === 'StaleGenerationFenceError';
}

/**
 * ACR Extension 2 (`WebhookIntakeBoundary`): Raised when an unprivileged
 * branch (`executionAuthority: 'NONE'`) attempts to execute a side-effecting
 * node (`WalBackedToolNode` or `SandboxedExecutionNode`) without traversing an
 * ancestor `ByzantineQuorumNode` or `PasskeyConsentNode` on its branch path.
 */
export class NodePrivilegeEscalationError extends Error {
  readonly nodeName: string;
  readonly nodePath: string;
  readonly branch?: string;
  readonly currentAuthority: string;
  readonly code = 'PRIVILEGE_ESCALATION_DENIED';

  constructor(options: {
    nodeName: string;
    nodePath: string;
    branch?: string;
    currentAuthority: string;
  }) {
    super(
      `Privilege escalation denied at node '${options.nodeName}' (path='${options.nodePath}', branch='${
        options.branch ?? 'root'
      }'): executionAuthority is '${
        options.currentAuthority
      }'. Side-effecting execution requires prior ByzantineQuorumNode or PasskeyConsentNode authorization on this branch.`
    );
    this.name = 'NodePrivilegeEscalationError';
    this.nodeName = options.nodeName;
    this.nodePath = options.nodePath;
    this.branch = options.branch;
    this.currentAuthority = options.currentAuthority;
    Object.setPrototypeOf(this, NodePrivilegeEscalationError.prototype);
  }
}

export function isNodePrivilegeEscalationError(
  e: unknown
): e is NodePrivilegeEscalationError {
  return e instanceof Error && e.name === 'NodePrivilegeEscalationError';
}
