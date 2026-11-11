/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Hyperfused into ACR OpsRoom Core from google/adk-js v2.4.0 (commit 8dad457)
 * `core/src/agents/instructions.ts`.
 */

import { InvocationContext, WorkflowInstructionScope } from './shims.js';

export type { WorkflowInstructionScope };

/**
 * Matches `<Type>` or `<Type.field.path>` optionally followed by `from node_name`,
 * e.g. `<AnalysisResult.summary>`, `<Report from analyzer>`,
 * `<Plan.steps from planner>`.
 *
 * Group 1: the type name (`AnalysisResult`, `Report`, `Plan`).
 * Group 2: optional dotted field path without leading dot (`summary`, `steps`).
 * Group 3: optional producer node name (`analyzer`, `planner`).
 */
export const PREDECESSOR_REF_PATTERN =
  /<([A-Za-z_]\w*)(?:\.([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*))?(?:\s+from\s+([A-Za-z_][\w.-]*))?>/g;

/**
 * Resolves `<Class.field>` and `<Class.field from node>` placeholders against
 * the current workflow node's input and predecessor outputs.
 */
export function resolvePredecessorRefs(
  template: string,
  scope: WorkflowInstructionScope | undefined
): string {
  if (!scope || !template.includes('<')) {
    return template;
  }
  return template.replace(
    PREDECESSOR_REF_PATTERN,
    (match, _typeName: string, fieldPath?: string, fromNode?: string) => {
      const resolved = resolveValue(scope, fieldPath, fromNode);
      if (resolved === undefined) {
        return match;
      }
      return formatResolvedValue(resolved);
    }
  );
}

export function resolveValue(
  scope: WorkflowInstructionScope,
  fieldPath: string | undefined,
  fromNode: string | undefined
): unknown {
  let root: unknown;
  if (fromNode !== undefined) {
    root = scope.outputsByNode?.[fromNode];
  } else {
    root = scope.input;
    if (
      fieldPath !== undefined &&
      !hasPropertyPath(root, fieldPath) &&
      scope.outputsByNode
    ) {
      for (const candidate of Object.values(scope.outputsByNode)) {
        if (hasPropertyPath(candidate, fieldPath)) {
          root = candidate;
          break;
        }
      }
    }
  }
  if (root === undefined) {
    return undefined;
  }
  if (!fieldPath) {
    return root;
  }
  return getPropertyPath(root, fieldPath);
}

function hasPropertyPath(target: unknown, path: string): boolean {
  return getPropertyPath(target, path) !== undefined;
}

function getPropertyPath(target: unknown, path: string): unknown {
  let current: unknown = target;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    if (!(segment in (current as Record<string, unknown>))) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function formatResolvedValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  return JSON.stringify(value);
}

/**
 * Populates `{stateKey}` and `{stateKey?}` placeholders in an instruction
 * template and resolves `<Class.field from node>` predecessor references.
 */
export async function injectSessionState(
  template: string,
  context: {
    invocationContext: InvocationContext;
    state?: Record<string, unknown>;
  }
): Promise<string> {
  const resolvedRefs = resolvePredecessorRefs(
    template,
    context.invocationContext.workflowInstructionScope
  );
  const stateObj =
    context.state ?? context.invocationContext.session.state ?? {};

  return resolvedRefs.replace(
    /\{+[^{}]*}+/g,
    (match): string => {
      let varName = match.replace(/^[{\s]+|[}\s]+$/g, '');
      let optional = false;
      if (varName.endsWith('?')) {
        optional = true;
        varName = varName.slice(0, -1).trim();
      }
      if (!/^[A-Za-z_]\w*$/.test(varName)) {
        return match;
      }
      if (varName in stateObj && stateObj[varName] !== undefined) {
        return String(stateObj[varName]);
      }
      if (optional) {
        return '';
      }
      return match;
    }
  );
}
