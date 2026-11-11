/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Zero-dependency first-party shims for ADK events, content, state, schemas,
 * tools, and invocation context in `@acr-js/opsroom-core`, fused with ACR's
 * CryptographicAuditLedger, ExecutionAuthorityLevel, and FencedStateCommitter.
 */

import { CryptographicAuditLedger } from '../audit-ledger.js';
import { randomUuidSync } from '../crypto-compat.js';
import { StaleGenerationFenceError } from './errors.js';
import { AsyncQueue } from './async_queue.js';
import {
  carryDeltaStamps,
  recordStateWrite,
  shouldApplyDeltaWrite,
} from './state_write_order.js';

/**
 * ACR Extension 2 & 5: Execution authority level propagated along a workflow branch.
 * - `'NONE'`: Untrusted external webhook ingress (`UnprivilegedIngressEvent`);
 *   cannot execute side-effecting `WalBackedToolNode` or `SandboxedExecutionNode`.
 * - `'QUORUM_ELEVATED'`: Authorized by an ancestor `ByzantineQuorumNode` (`'approved'`).
 * - `'CONSENT_ELEVATED'`: Authorized by an ancestor `PasskeyConsentNode` (`'authorized'`).
 * - `'SYSTEM'`: Trusted internal control-plane invocation (default when not tainted).
 */
export type ExecutionAuthorityLevel =
  | 'NONE'
  | 'QUORUM_ELEVATED'
  | 'CONSENT_ELEVATED'
  | 'SYSTEM';

export const EXECUTION_AUTHORITY_RANK: Readonly<
  Record<ExecutionAuthorityLevel, number>
> = Object.freeze({
  NONE: 0,
  QUORUM_ELEVATED: 1,
  CONSENT_ELEVATED: 2,
  SYSTEM: 3,
});

export function isElevatedAuthority(auth: ExecutionAuthorityLevel): boolean {
  return (
    auth === 'QUORUM_ELEVATED' ||
    auth === 'CONSENT_ELEVATED' ||
    auth === 'SYSTEM'
  );
}

/**
 * Monotonic lattice join for execution authority:
 * `'NONE' < 'QUORUM_ELEVATED' < 'CONSENT_ELEVATED' < 'SYSTEM'`.
 */
export function elevateExecutionAuthority(
  ...authorities: Array<ExecutionAuthorityLevel | undefined>
): ExecutionAuthorityLevel {
  let highest: ExecutionAuthorityLevel = 'NONE';
  let found = false;
  for (const auth of authorities) {
    if (!auth) continue;
    if (!found || EXECUTION_AUTHORITY_RANK[auth] > EXECUTION_AUTHORITY_RANK[highest]) {
      highest = auth;
      found = true;
    }
  }
  return found ? highest : 'NONE';
}

/**
 * Merges a parent's execution authority with a completed child node's authority,
 * preserving explicit cryptographic governance attestations (`'QUORUM_ELEVATED'`,
 * `'CONSENT_ELEVATED'`) even when the parent started at the ambient `'SYSTEM'` default,
 * while strictly enforcing `'NONE' < 'QUORUM_ELEVATED' < 'CONSENT_ELEVATED' < 'SYSTEM'`
 * across concurrent branches.
 */
export function joinBranchExecutionAuthority(
  parentAuthority: ExecutionAuthorityLevel,
  childAuthority: ExecutionAuthorityLevel | undefined,
  childInitialAuthority?: ExecutionAuthorityLevel
): ExecutionAuthorityLevel {
  if (!childAuthority) {
    return parentAuthority;
  }
  if (
    parentAuthority === 'SYSTEM' &&
    (childAuthority === 'QUORUM_ELEVATED' || childAuthority === 'CONSENT_ELEVATED')
  ) {
    return childAuthority;
  }
  if (
    (parentAuthority === 'QUORUM_ELEVATED' || parentAuthority === 'CONSENT_ELEVATED') &&
    childAuthority === 'SYSTEM' &&
    childInitialAuthority === 'SYSTEM'
  ) {
    return parentAuthority;
  }
  return elevateExecutionAuthority(parentAuthority, childAuthority);
}

/**
 * Computes the conservative intersection of execution authorities across joined branches.
 * If any joined branch has `'NONE'`, the joined branch remains `'NONE'` unless all
 * predecessors are elevated.
 */
export function intersectExecutionAuthorities(
  authorities: ExecutionAuthorityLevel[]
): ExecutionAuthorityLevel {
  if (authorities.length === 0) {
    return 'SYSTEM';
  }
  if (authorities.some((a) => a === 'NONE')) {
    return 'NONE';
  }
  if (authorities.every((a) => a === 'CONSENT_ELEVATED')) {
    return 'CONSENT_ELEVATED';
  }
  if (
    authorities.every(
      (a) => a === 'QUORUM_ELEVATED' || a === 'CONSENT_ELEVATED'
    )
  ) {
    return 'QUORUM_ELEVATED';
  }
  return 'SYSTEM';
}

export interface WorkflowFunctionCall {
  id?: string;
  name: string;
  args?: Record<string, unknown>;
}

export type FunctionCallPart = WorkflowFunctionCall;

export interface WorkflowFunctionResponse {
  id?: string;
  name: string;
  response: Record<string, unknown>;
}

export type FunctionResponsePart = WorkflowFunctionResponse;

export interface WorkflowPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  codeExecutionResult?: unknown;
  functionCall?: WorkflowFunctionCall;
  functionResponse?: WorkflowFunctionResponse;
}

export interface WorkflowContent {
  role?: string;
  parts: WorkflowPart[];
}

export type Content = WorkflowContent;
export type Part = WorkflowPart;

export function createModelContent(
  textOrParts: string | WorkflowPart | WorkflowPart[]
): WorkflowContent {
  if (typeof textOrParts === 'string') {
    return { role: 'model', parts: [{ text: textOrParts }] };
  }
  if (Array.isArray(textOrParts)) {
    return { role: 'model', parts: textOrParts };
  }
  return { role: 'model', parts: [textOrParts] };
}

export function isContent(value: unknown): value is WorkflowContent {
  return (
    typeof value === 'object' &&
    value !== null &&
    'parts' in value &&
    Array.isArray((value as { parts?: unknown }).parts)
  );
}

export function toContent(val: unknown): WorkflowContent | undefined {
  if (val === null || val === undefined) {
    return undefined;
  }
  if (isContent(val)) {
    return val;
  }
  if (typeof val === 'string') {
    return createModelContent(val);
  }
  try {
    return createModelContent(JSON.stringify(val) ?? String(val));
  } catch {
    return createModelContent(String(val));
  }
}

export type RouteKey = string | number | boolean;
export type Route = RouteKey | RouteKey[];

export interface NodeInfo {
  path?: string;
  runId?: string;
  outputFor?: string[];
  messageAsOutput?: boolean;
  input?: unknown;
  output?: unknown;
  executionAuthority?: ExecutionAuthorityLevel;
}

export interface AuthConfig {
  credentialKey: string;
  scheme?: string;
  description?: string;
}

export interface EventActions {
  skipSummarization?: boolean;
  stateDelta: Record<string, unknown>;
  artifactDelta: Record<string, number>;
  transferToAgent?: string;
  escalate?: boolean;
  requestedAuthConfigs: Record<string, AuthConfig>;
  requestedToolConfirmations: Record<string, unknown>;
  agentState?: Record<string, unknown>;
  endOfAgent?: boolean;
  customMetadata?: Record<string, unknown>;
  nodeState?: 'starting' | 'paused' | 'finished';
  workflowState?: 'starting' | 'paused' | 'finished';
}

export function createEventActions(
  state: Partial<EventActions> = {}
): EventActions {
  const stateDelta: Record<string, unknown> = state.stateDelta
    ? { ...state.stateDelta }
    : {};
  if (state.stateDelta) {
    carryDeltaStamps(state.stateDelta, stateDelta);
  }
  return {
    stateDelta,
    artifactDelta: state.artifactDelta ? { ...state.artifactDelta } : {},
    requestedAuthConfigs: state.requestedAuthConfigs
      ? { ...state.requestedAuthConfigs }
      : {},
    requestedToolConfirmations: state.requestedToolConfirmations
      ? { ...state.requestedToolConfirmations }
      : {},
    skipSummarization: state.skipSummarization,
    transferToAgent: state.transferToAgent,
    escalate: state.escalate,
    agentState: state.agentState,
    endOfAgent: state.endOfAgent,
    customMetadata: state.customMetadata,
    nodeState: state.nodeState,
    workflowState: state.workflowState,
  };
}

export interface EventUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  initialPromptTokenCount?: number;
}

const EVENT_SIGNATURE_SYMBOL = Symbol.for('google.adk.event');

export interface Event {
  readonly [EVENT_SIGNATURE_SYMBOL]?: true;
  id: string;
  invocationId: string;
  author?: string;
  actions: EventActions;
  longRunningToolIds?: string[];
  branch?: string;
  timestamp: number;
  content?: WorkflowContent;
  partial?: boolean;
  errorCode?: string;
  errorMessage?: string;
  finishReason?: string;
  usageMetadata?: EventUsageMetadata;
  customMetadata?: Record<string, unknown>;
  output?: unknown;
  route?: Route;
  nodeInfo?: NodeInfo;
  isolationScope?: string;
}

export type WorkflowEvent = Event;

export interface CreateEventParams extends Omit<Partial<Event>, 'actions'> {
  actions?: Partial<EventActions>;
}

export function createEvent(params: CreateEventParams = {}): Event {
  return {
    ...params,
    [EVENT_SIGNATURE_SYMBOL]: true,
    id: params.id || randomUuidSync(),
    invocationId: params.invocationId || '',
    author: params.author,
    actions: createEventActions(params.actions),
    longRunningToolIds: params.longRunningToolIds
      ? [...params.longRunningToolIds]
      : [],
    branch: params.branch,
    timestamp: params.timestamp || Date.now(),
  };
}

export function isEvent(value: unknown): value is Event {
  return (
    typeof value === 'object' &&
    value !== null &&
    ((EVENT_SIGNATURE_SYMBOL in value &&
      (value as Event)[EVENT_SIGNATURE_SYMBOL] === true) ||
      ('invocationId' in value && 'actions' in value && 'timestamp' in value))
  );
}

export function getFunctionCalls(event: Event): WorkflowFunctionCall[] {
  const calls: WorkflowFunctionCall[] = [];
  for (const part of event.content?.parts ?? []) {
    if (part.functionCall) {
      calls.push(part.functionCall);
    }
  }
  return calls;
}

export function getFunctionResponses(event: Event): WorkflowFunctionResponse[] {
  const responses: WorkflowFunctionResponse[] = [];
  for (const part of event.content?.parts ?? []) {
    if (part.functionResponse) {
      responses.push(part.functionResponse);
    }
  }
  return responses;
}

export const AF_FUNCTION_CALL_ID_PREFIX = 'adk-';

export function generateClientFunctionCallId(): string {
  return `${AF_FUNCTION_CALL_ID_PREFIX}${randomUuidSync()}`;
}

export function populateClientFunctionCallId(modelResponseEvent: Event): void {
  for (const functionCall of getFunctionCalls(modelResponseEvent)) {
    if (!functionCall.id) {
      functionCall.id = generateClientFunctionCallId();
    }
  }
}

export function hasTrailingCodeExecutionResult(event: Event): boolean {
  if (event.content && event.content.parts?.length) {
    const lastPart = event.content.parts[event.content.parts.length - 1];
    return lastPart.codeExecutionResult !== undefined;
  }
  return false;
}

export function isFinalResponse(event: Event): boolean {
  if (
    event.actions?.skipSummarization ||
    (event.longRunningToolIds && event.longRunningToolIds.length > 0) ||
    (event.actions?.requestedAuthConfigs &&
      Object.keys(event.actions.requestedAuthConfigs).length > 0)
  ) {
    return true;
  }
  return (
    getFunctionCalls(event).length === 0 &&
    getFunctionResponses(event).length === 0 &&
    !event.partial &&
    !hasTrailingCodeExecutionResult(event)
  );
}

export function stringifyContent(
  eventOrContent: Event | WorkflowContent | undefined
): string {
  if (!eventOrContent) {
    return '';
  }
  const content =
    'parts' in eventOrContent && Array.isArray(eventOrContent.parts)
      ? eventOrContent
      : (eventOrContent as Event).content;
  if (!content?.parts) {
    return '';
  }
  return content.parts
    .filter((part) => !part.thought)
    .map((part) => part.text ?? '')
    .join('');
}

export function getEventTokens(event: Event): number {
  const usage = event.usageMetadata;
  const promptTokenCount =
    usage?.initialPromptTokenCount ?? usage?.promptTokenCount;
  if (promptTokenCount !== undefined) {
    return promptTokenCount;
  }
  const contentStr = stringifyContent(event);
  return Math.ceil(contentStr.length / 4);
}

export function hasThoughts(event: Event): boolean {
  return !!event.content?.parts?.some((part) => part.thought === true);
}

export function pruneThoughts(event: Event): Event {
  if (!event.content?.parts) {
    return event;
  }
  const prunedParts = event.content.parts.filter(
    (part) => part.thought !== true
  );
  event.content = {
    ...event.content,
    parts: prunedParts,
  };
  return event;
}

// ---------------------------------------------------------------------------
// Zero-Dependency Schema Validation Support (Zod-like + JSON Schema)
// ---------------------------------------------------------------------------

export interface ZodSafeParseSuccess<T = unknown> {
  success: true;
  data: T;
}

export interface ZodSafeParseError {
  success: false;
  error: {
    message: string;
    issues: Array<{ path: Array<string | number>; message: string }>;
  };
}

export type ZodSafeParseResult<T = unknown> =
  | ZodSafeParseSuccess<T>
  | ZodSafeParseError;

export interface ZodLikeSchema<T = unknown> {
  safeParse?: (val: unknown) => ZodSafeParseResult<T>;
  parse?: (val: unknown) => T;
  shape?: Record<string, ZodLikeSchema>;
  _def?: unknown;
}

export interface JsonSchemaObject {
  type?: string | string[];
  properties?: Record<string, JsonSchemaObject>;
  required?: string[];
  anyOf?: JsonSchemaObject[];
  oneOf?: JsonSchemaObject[];
  additionalProperties?: boolean;
}

export type SchemaLike = ZodLikeSchema | JsonSchemaObject;

export function isZodLike(schema: unknown): schema is ZodLikeSchema {
  return (
    typeof schema === 'object' &&
    schema !== null &&
    (typeof (schema as ZodLikeSchema).safeParse === 'function' ||
      typeof (schema as ZodLikeSchema).parse === 'function')
  );
}

export function isZodObject(schema: unknown): schema is ZodLikeSchema & {
  shape: Record<string, ZodLikeSchema>;
} {
  return (
    isZodLike(schema) &&
    typeof (schema as ZodLikeSchema).shape === 'object' &&
    (schema as ZodLikeSchema).shape !== null
  );
}

export function toJsonSchema(schema: SchemaLike): JsonSchemaObject {
  if (isZodObject(schema)) {
    const properties: Record<string, JsonSchemaObject> = {};
    for (const [k, v] of Object.entries(schema.shape)) {
      properties[k] = toJsonSchema(v);
    }
    return {
      type: 'object',
      properties,
      required: Object.keys(schema.shape),
    };
  }
  if (typeof schema === 'object' && schema !== null && 'type' in schema) {
    return schema as JsonSchemaObject;
  }
  return { type: 'object' };
}

function validateAgainstJsonSchema(
  value: unknown,
  schema: JsonSchemaObject,
  path: Array<string | number> = []
): Array<{ path: Array<string | number>; message: string }> {
  const issues: Array<{ path: Array<string | number>; message: string }> = [];
  if (schema.anyOf && Array.isArray(schema.anyOf)) {
    const anyMatch = schema.anyOf.some(
      (branch) => validateAgainstJsonSchema(value, branch, path).length === 0
    );
    if (!anyMatch) {
      issues.push({ path, message: 'Value does not match anyOf schema branches' });
    }
    return issues;
  }
  if (schema.oneOf && Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter(
      (branch) => validateAgainstJsonSchema(value, branch, path).length === 0
    );
    if (matches.length !== 1) {
      issues.push({ path, message: 'Value does not match exactly oneOf schema branches' });
    }
    return issues;
  }

  const expectedTypes = schema.type
    ? Array.isArray(schema.type)
      ? schema.type
      : [schema.type]
    : undefined;

  if (expectedTypes && expectedTypes.length > 0) {
    const actualType =
      value === null
        ? 'null'
        : Array.isArray(value)
          ? 'array'
          : typeof value === 'number' && Number.isInteger(value)
            ? 'integer'
            : typeof value;

    const matchesType = expectedTypes.some((t) => {
      if (t === 'number' && actualType === 'integer') return true;
      return t === actualType;
    });
    if (!matchesType) {
      issues.push({
        path,
        message: `Expected type ${expectedTypes.join('|')}, got ${actualType}`,
      });
      return issues;
    }
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (schema.properties || schema.required)
  ) {
    const rec = value as Record<string, unknown>;
    for (const reqKey of schema.required ?? []) {
      if (!(reqKey in rec) || rec[reqKey] === undefined) {
        issues.push({
          path: [...path, reqKey],
          message: `Missing required property '${reqKey}'`,
        });
      }
    }
    if (schema.properties) {
      for (const [k, propSchema] of Object.entries(schema.properties)) {
        if (k in rec && rec[k] !== undefined) {
          issues.push(
            ...validateAgainstJsonSchema(rec[k], propSchema, [...path, k])
          );
        }
      }
      if (schema.additionalProperties === false) {
        for (const k of Object.keys(rec)) {
          if (!(k in schema.properties)) {
            issues.push({
              path: [...path, k],
              message: `Unknown property '${k}' is not allowed`,
            });
          }
        }
      }
    }
  }

  return issues;
}

export function compileJsonSchema(jsonSchema: unknown):
  | {
      safeParse: (val: unknown) => ZodSafeParseResult;
    }
  | undefined {
  if (typeof jsonSchema !== 'object' || jsonSchema === null) {
    return undefined;
  }
  if (isZodLike(jsonSchema)) {
    return {
      safeParse: (val: unknown): ZodSafeParseResult => {
        if (jsonSchema.safeParse) {
          return jsonSchema.safeParse(val);
        }
        try {
          return { success: true, data: jsonSchema.parse!(val) };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            success: false,
            error: { message: msg, issues: [{ path: [], message: msg }] },
          };
        }
      },
    };
  }
  const schemaObj = jsonSchema as JsonSchemaObject;
  return {
    safeParse: (val: unknown): ZodSafeParseResult => {
      const issues = validateAgainstJsonSchema(val, schemaObj);
      if (issues.length === 0) {
        return { success: true, data: val };
      }
      return {
        success: false,
        error: {
          message: issues.map((i) => i.message).join('; '),
          issues,
        },
      };
    },
  };
}

export function parseWithSchema<T>(
  schema: SchemaLike | undefined,
  value: T
): T {
  if (!schema) {
    return value;
  }
  if (isZodLike(schema)) {
    if (schema.parse) {
      return schema.parse(value) as T;
    }
    if (schema.safeParse) {
      const res = schema.safeParse(value);
      if (!res.success) {
        throw new Error(res.error.message);
      }
      return res.data as T;
    }
  }
  const validator = compileJsonSchema(schema);
  if (validator) {
    const res = validator.safeParse(value);
    if (!res.success) {
      throw new Error(res.error.message);
    }
    return res.data as T;
  }
  return value;
}

export function objectSchemaFields(
  schema: SchemaLike
): Map<string, { safeParse: (v: unknown) => ZodSafeParseResult }> | undefined {
  if (isZodObject(schema)) {
    const map = new Map<
      string,
      { safeParse: (v: unknown) => ZodSafeParseResult }
    >();
    for (const [k, fieldSchema] of Object.entries(schema.shape)) {
      const compiled = compileJsonSchema(fieldSchema);
      if (compiled) {
        map.set(k, compiled);
      }
    }
    return map;
  }
  if (
    typeof schema === 'object' &&
    schema !== null &&
    'properties' in schema &&
    schema.properties &&
    typeof schema.properties === 'object'
  ) {
    const map = new Map<
      string,
      { safeParse: (v: unknown) => ZodSafeParseResult }
    >();
    for (const [k, propSchema] of Object.entries(schema.properties)) {
      const compiled = compileJsonSchema(propSchema);
      if (compiled) {
        map.set(k, compiled);
      }
    }
    return map;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// State & Dual Causal + Generational Fencing (Extensions 1 & 4)
// ---------------------------------------------------------------------------

/** Raised when a state mutation violates the declared state schema. */
export class StateSchemaError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = 'StateSchemaError';
    Object.setPrototypeOf(this, StateSchemaError.prototype);
  }
}

export function isStateSchemaError(e: unknown): e is StateSchemaError {
  return e instanceof Error && e.name === 'StateSchemaError';
}

/**
 * ACR Extensions 1 & 4: Inter-worker generational fencing committer.
 * Bridges `OwnershipFencingRegistry` into workflow state commits so stale-generation
 * runners are rejected with `StaleGenerationFenceError` (`409 STALE_OWNERSHIP_GENERATION`).
 */
export interface FencedStateCommitter {
  readonly resourceUri: string;
  readonly ownerDid: string;
  readonly ownershipGeneration: string | number | bigint;
  readonly fencingToken: string;
  /**
   * Validates and commits a state mutation under the active generation fence.
   * Throws or returns `{ accepted: false, activeGeneration }` on fencing violation.
   */
  commitMutation: (params: {
    resourceUri: string;
    ownerDid: string;
    ownershipGeneration: string | number | bigint;
    fencingToken: string;
    delta: Record<string, unknown>;
    nodeName: string;
  }) => void | Promise<void>;
}

/**
 * A state mapping that maintains the current value and the pending-commit delta,
 * using ADK's `state_write_order.ts` WeakMap stamps for intra-workflow causal ordering.
 */
export class State {
  static readonly APP_PREFIX = 'app:';
  static readonly USER_PREFIX = 'user:';
  static readonly TEMP_PREFIX = 'temp:';

  constructor(
    private value: Record<string, unknown> = {},
    private delta: Record<string, unknown> = {},
    readonly schema?: SchemaLike
  ) {}

  validateDelta(delta: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(delta)) {
      this.validate(key, value);
    }
  }

  private validate(key: string, value: unknown): void {
    if (this.schema === undefined || key.includes(':')) {
      return;
    }
    const fields = objectSchemaFields(this.schema);
    if (!fields) {
      return;
    }
    if (!fields.has(key)) {
      throw new StateSchemaError(
        `Key '${key}' is not declared in the state schema. Declared fields: ` +
          JSON.stringify([...fields.keys()].sort())
      );
    }
    const field = fields.get(key);
    if (!field) {
      return;
    }
    const parsed = field.safeParse(value);
    if (!parsed.success) {
      throw new StateSchemaError(
        `Value for '${key}' does not match the type declared in the state ` +
          `schema: ${parsed.error.message}`
      );
    }
  }

  get<T = unknown>(key: string, defaultValue?: T): T | undefined {
    if (Object.hasOwn(this.delta, key)) {
      return this.delta[key] as T;
    }
    if (Object.hasOwn(this.value, key)) {
      return this.value[key] as T;
    }
    return defaultValue;
  }

  set(key: string, value: unknown): void {
    this.validate(key, value);
    this.value[key] = value;
    this.delta[key] = value;
    recordStateWrite(this.value, this.delta, key);
  }

  has(key: string): boolean {
    return Object.hasOwn(this.value, key) || Object.hasOwn(this.delta, key);
  }

  hasDelta(): boolean {
    return Object.keys(this.delta).length > 0;
  }

  update(delta: Record<string, unknown>): void {
    this.validateDelta(delta);
    Object.assign(this.delta, delta);
    Object.assign(this.value, delta);
    for (const key of Object.keys(delta)) {
      recordStateWrite(this.value, this.delta, key);
    }
  }

  toRecord(): Record<string, unknown> {
    return { ...this.value, ...this.delta };
  }
}

export type WorkflowState = State;

/**
 * Applies an event's `actions.stateDelta` to a session state object using
 * `shouldApplyDeltaWrite` so out-of-order commits never roll back a newer write.
 */
export function applyEventStateDelta(
  sessionState: Record<string, unknown>,
  delta: Record<string, unknown> | undefined
): string[] {
  if (!delta) {
    return [];
  }
  const appliedKeys: string[] = [];
  for (const [key, value] of Object.entries(delta)) {
    if (shouldApplyDeltaWrite(sessionState, delta, key)) {
      sessionState[key] = value;
      appliedKeys.push(key);
    }
  }
  return appliedKeys;
}

// ---------------------------------------------------------------------------
// Session, InvocationContext, Plugin & Telemetry Shims
// ---------------------------------------------------------------------------

export interface WorkflowInstructionScope {
  input?: unknown;
  outputsByNode?: Record<string, unknown>;
}

export interface WorkflowSession {
  id: string;
  appName?: string;
  userId?: string;
  state: Record<string, unknown>;
  events: Event[];
}

export function createWorkflowSession(params?: {
  id?: string;
  appName?: string;
  userId?: string;
  state?: Record<string, unknown>;
  events?: Event[];
}): WorkflowSession {
  return {
    id: params?.id ?? `sess-${randomUuidSync()}`,
    appName: params?.appName ?? 'acr-opsroom',
    userId: params?.userId ?? 'acr-operator',
    state: params?.state ?? {},
    events: params?.events ?? [],
  };
}

export interface PluginManagerShim {
  hasPlugins: boolean;
  runBeforeRunCallback?: (params: {
    invocationContext: InvocationContext;
  }) => Promise<WorkflowContent | undefined>;
  runOnEventCallback?: (params: {
    invocationContext: InvocationContext;
    event: Event;
  }) => Promise<Event | undefined>;
  runBeforeNodeCallback: (params: {
    node: unknown;
    nodeContext: unknown;
    input: unknown;
  }) => Promise<unknown>;
  runAfterNodeCallback: (params: {
    node: unknown;
    nodeContext: unknown;
    output: unknown;
  }) => Promise<unknown>;
  runBeforeToolCallback?: (params: {
    tool: BaseTool;
    toolArgs: Record<string, unknown>;
    toolContext: ToolContextShim;
  }) => Promise<Record<string, unknown> | undefined>;
  runAfterToolCallback?: (params: {
    tool: BaseTool;
    toolArgs: Record<string, unknown>;
    toolContext: ToolContextShim;
    result: Record<string, unknown>;
  }) => Promise<Record<string, unknown> | undefined>;
  runOnToolErrorCallback?: (params: {
    tool: BaseTool;
    toolArgs: Record<string, unknown>;
    toolContext: ToolContextShim;
    error: Error;
  }) => Promise<Record<string, unknown> | undefined>;
}

export interface InvocationContextParams {
  invocationId?: string;
  session?: WorkflowSession;
  branch?: string;
  isolationScope?: string;
  abortSignal?: AbortSignal;
  userContent?: WorkflowContent;
  pluginManager?: PluginManagerShim;
  eventQueue?: AsyncQueue<Event>;
  nodeToolDepth?: number;
  executionAuthority?: ExecutionAuthorityLevel;
  fencedCommitter?: FencedStateCommitter;
  auditLedger?: CryptographicAuditLedger;
  workflowInstructionScope?: WorkflowInstructionScope;
}

export class InvocationContext {
  readonly invocationId: string;
  readonly session: WorkflowSession;
  readonly branch?: string;
  readonly isolationScope?: string;
  readonly abortSignal?: AbortSignal;
  readonly userContent?: WorkflowContent;
  readonly pluginManager?: PluginManagerShim;
  readonly eventQueue?: AsyncQueue<Event>;
  readonly nodeToolDepth: number;
  executionAuthority: ExecutionAuthorityLevel;
  readonly fencedCommitter?: FencedStateCommitter;
  readonly auditLedger?: CryptographicAuditLedger;
  readonly workflowInstructionScope?: WorkflowInstructionScope;

  constructor(params: InvocationContextParams = {}) {
    this.invocationId = params.invocationId ?? `inv-${randomUuidSync()}`;
    this.session = params.session ?? createWorkflowSession();
    this.branch = params.branch;
    this.isolationScope = params.isolationScope;
    this.abortSignal = params.abortSignal;
    this.userContent = params.userContent;
    this.pluginManager = params.pluginManager;
    this.eventQueue = params.eventQueue;
    this.nodeToolDepth = params.nodeToolDepth ?? 0;
    this.executionAuthority = params.executionAuthority ?? 'SYSTEM';
    this.fencedCommitter = params.fencedCommitter;
    this.auditLedger = params.auditLedger;
    this.workflowInstructionScope = params.workflowInstructionScope;
  }

  clone(overrides: Partial<InvocationContextParams> = {}): InvocationContext {
    return new InvocationContext({
      invocationId: this.invocationId,
      session: this.session,
      branch: this.branch,
      isolationScope: this.isolationScope,
      abortSignal: this.abortSignal,
      userContent: this.userContent,
      pluginManager: this.pluginManager,
      eventQueue: this.eventQueue,
      nodeToolDepth: this.nodeToolDepth,
      executionAuthority: this.executionAuthority,
      fencedCommitter: this.fencedCommitter,
      auditLedger: this.auditLedger,
      workflowInstructionScope: this.workflowInstructionScope,
      ...overrides,
    });
  }
}

export function createInvocationContext(
  params: InvocationContextParams = {}
): InvocationContext {
  return new InvocationContext(params);
}

// ---------------------------------------------------------------------------
// BaseTool Shim (for ToolNode & NodeTool compatibility)
// ---------------------------------------------------------------------------

const BASE_TOOL_SIGNATURE_SYMBOL = Symbol.for('google.adk.baseTool');

export interface BaseToolConfig {
  name: string;
  description: string;
  isLongRunning?: boolean;
}

export interface ToolContextShim {
  invocationContext: InvocationContext;
  functionCallId?: string;
  resumeInputs?: Record<string, unknown>;
  state: State;
  actions?: EventActions;
  invocationId?: string;
  agentName?: string;
  nodeContext?: unknown;
  workflowId?: string;
  graphTopologyHash?: string;
  nodePath?: string;
  executionAuthority?: ExecutionAuthorityLevel;
  interruptIds?: string[];
}

export interface RunAsyncToolRequest {
  args: Record<string, unknown>;
  toolContext: ToolContextShim;
}

export abstract class BaseTool {
  readonly [BASE_TOOL_SIGNATURE_SYMBOL] = true;
  readonly name: string;
  readonly description: string;
  readonly isLongRunning: boolean;

  constructor(config: BaseToolConfig) {
    this.name = config.name;
    this.description = config.description;
    this.isLongRunning = config.isLongRunning ?? false;
  }

  abstract runAsync(req: RunAsyncToolRequest): Promise<unknown>;
}

export function isBaseTool(value: unknown): value is BaseTool {
  return (
    typeof value === 'object' &&
    value !== null &&
    BASE_TOOL_SIGNATURE_SYMBOL in value &&
    (value as BaseTool)[BASE_TOOL_SIGNATURE_SYMBOL] === true
  );
}

// ---------------------------------------------------------------------------
// Telemetry Scope Shim
// ---------------------------------------------------------------------------

export interface NodeInvocationScope {
  run<T>(fn: () => T): T;
  recordEvent(event: Event): void;
  end(error?: unknown): void;
}

export function recordNodeInvocation(_params: {
  node: unknown;
  nodeName: string;
  sessionId: string;
}): NodeInvocationScope {
  return {
    run: <T>(fn: () => T): T => fn(),
    recordEvent: () => {},
    end: () => {},
  };
}

export function recordWorkflowInvocation(_params: {
  workflow: unknown;
  sessionId: string;
}): NodeInvocationScope {
  return {
    run: <T>(fn: () => T): T => fn(),
    recordEvent: () => {},
    end: () => {},
  };
}

/**
 * Helper to create a FencedStateCommitter backed by an OwnershipFencingRegistry-compatible object.
 */
export function createOwnershipFencedCommitter<T = Record<string, unknown>>(params: {
  fencingRegistry: {
    submitFencedMutation: (req: {
      resource_uri: string;
      owner_did: string;
      ownership_generation: string | number | bigint;
      fencing_token: string;
      mutation_payload: T;
    }) => unknown;
  };
  resourceUri: string;
  ownerDid: string;
  ownershipGeneration: string | number | bigint;
  fencingToken: string;
}): FencedStateCommitter {
  return {
    resourceUri: params.resourceUri,
    ownerDid: params.ownerDid,
    ownershipGeneration: params.ownershipGeneration,
    fencingToken: params.fencingToken,
    commitMutation: ({
      resourceUri,
      ownerDid,
      ownershipGeneration,
      fencingToken,
      delta,
      nodeName,
    }) => {
      try {
        params.fencingRegistry.submitFencedMutation({
          resource_uri: resourceUri,
          owner_did: ownerDid,
          ownership_generation: ownershipGeneration,
          fencing_token: fencingToken,
          mutation_payload: delta as unknown as T,
        });
      } catch (err: any) {
        const activeGen =
          err?.activeGenerationStr ??
          err?.activeGeneration ??
          'HIGHER_GENERATION';
        throw new StaleGenerationFenceError({
          nodeName,
          resourceUri,
          attemptedGeneration: ownershipGeneration,
          activeGeneration: activeGen,
        });
      }
    },
  };
}
