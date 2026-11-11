/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * ACR Hyperfusion Graph Nodes:
 * Fuses the ADK 2.0 Workflow Graph Engine with all 5 Hyperfusion Architectural Extensions:
 * - Extension 1 & 4: SandboxedExecutionNode + generational write fencing (`FencedStateCommitter`)
 * - Extension 2: WebhookIntakeBoundary `executionAuthority: 'NONE'` taint enforcement
 * - Extension 3: WalBackedToolNode with `DurableCommandWal` & `'__OUTCOME_UNKNOWN__'` routing
 * - Extension 5: PasskeyConsentNode (`ApprovalGate` + `ConsentChallengeStore`) &
 *                ByzantineQuorumNode (`ByzantineConsensusEngine` + `CryptographicAuditLedger`)
 */

import crypto from 'node:crypto';
import {
  ApprovalGate,
  canonicalJsonStringify,
  computeRequestCanonicalHash,
  ConsentChallengeStore,
  ExpectedConsentContext,
  PasskeyConsentEnvelope,
  SignedDecision,
} from '../../approvals/approval_engine.js';
import { CryptographicAuditLedger } from '../../audit-ledger.js';
import { ByzantineConsensusEngine } from '../../consensus.js';
import { hmacSha256Sync, sha256Sync } from '../../crypto-compat.js';
import {
  DurableCommandRecord,
  DurableCommandWal,
  ExternalReconciliationProbeResult,
  SideEffectActionKind,
} from '../../playbooks/playbook_runner.js';
import {
  AgentProfile,
  AgentRole,
  AgentSquad,
  AuditBlock,
  ConsensusBallot,
  DeliberationTurn,
  QuorumEvaluation,
  ToolCallProposal,
} from '../../types.js';
import { BaseNode, BaseNodeConfig, isContent, toContent } from '../base_node.js';
import {
  filterByIsolationScope,
  resolveConsumerScope,
} from '../content_processor_utils.js';
import {
  BaseContextCompactor,
  ContextCompactionTrigger,
} from '../context/base_context_compactor.js';
import {
  CompactedEvent,
  createCompactedEvent,
} from '../context/compacted_event.js';
import {
  buildCheckpointManifest,
  getActiveEvents,
} from '../context/compaction_utils.js';
import {
  NodeOutcomeUnknownError,
  NodePrivilegeEscalationError,
  NodeTimeoutError,
  StaleGenerationFenceError,
} from '../errors.js';
import { RouteValue } from '../graph.js';
import { injectSessionState } from '../instructions.js';
import { NodeContext } from '../node_context.js';
import { RequestInput } from '../request_input.js';
import {
  AgentExecutionMode,
  LlmAgentNodeTarget,
  runLlmAgentAsNode,
  withWorkflowInstructionScope,
} from '../run_llm_agent_as_node.js';
import {
  applyEventStateDelta,
  BaseTool,
  createEvent,
  createEventActions,
  Event,
  ExecutionAuthorityLevel,
  InvocationContext,
  ToolContextShim,
  WorkflowSession,
} from '../shims.js';
import {
  reconstructNodeStates,
  reconstructNodeStatesByPath,
  verifySessionAuditIntegrity,
} from '../utils/rehydration_utils.js';
import { Workflow, WorkflowConfig } from '../workflow.js';

function coerceInputRecord(input: unknown): Record<string, unknown> {
  if (input === null || input === undefined) {
    return {};
  }
  if (isContent(input)) {
    const rawText = (input.parts ?? [])
      .map((p) => p.text ?? '')
      .join('')
      .trim();
    if (!rawText) {
      return {};
    }
    try {
      const parsed = JSON.parse(rawText);
      return typeof parsed === 'object' &&
        parsed !== null &&
        !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : { value: parsed };
    } catch {
      return { text: rawText };
    }
  }
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) {
      return {};
    }
    try {
      const parsed = JSON.parse(trimmed);
      return typeof parsed === 'object' &&
        parsed !== null &&
        !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : { value: parsed };
    } catch {
      return { text: trimmed };
    }
  }
  if (typeof input === 'object' && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return { value: input };
}

// ============================================================================
// 1. WalBackedToolNode (Extension 3 DurableCommandWal + Extension 2 Taint Gate)
// ============================================================================

export interface WalBackedToolNodeConfig<TResult = Record<string, unknown>>
  extends BaseNodeConfig {
  wal: DurableCommandWal<TResult>;
  toolName?: string;
  stepId?: string;
  actionKind?: SideEffectActionKind;
  /**
   * Optional custom deterministic commandId builder. Defaults to binding
   * `(workflowId, nodePath, canonicalArgsHash)`.
   */
  commandIdBuilder?: (
    ctx: NodeContext,
    inputArgs: Record<string, unknown>
  ) => string;
  /**
   * Executes the external mutating tool call when no reconciled/acknowledged WAL
   * record exists.
   */
  dispatcher: (
    args: Record<string, unknown>,
    idempotencyKey: string,
    ctx: NodeContext
  ) => Promise<{
    externalResourceId: string;
    result: TResult;
    route?: RouteValue | RouteValue[];
  }>;
  /**
   * Reconciliation probe invoked when a prior attempt crashed or timed out after
   * entering `DISPATCHED` or `OUTCOME_UNKNOWN`.
   */
  reconcileProbe?: (
    args: Record<string, unknown>,
    idempotencyKey: string,
    attempt: number,
    ctx: NodeContext
  ) => Promise<ExternalReconciliationProbeResult<TResult>>;
  probeMaxAttempts?: number;
  probeRetryDelayMs?: number;
  allowRedispatchAfterExhaustedProbes?: boolean;
  simulateCrashBeforeCheckpoint?: boolean;
}

export class WalBackedToolNode<
  TResult = Record<string, unknown>,
> extends BaseNode {
  readonly wal: DurableCommandWal<TResult>;
  readonly toolName: string;
  readonly stepId: string;
  readonly actionKind?: SideEffectActionKind;
  readonly commandIdBuilder?: (
    ctx: NodeContext,
    inputArgs: Record<string, unknown>
  ) => string;
  readonly dispatcher: WalBackedToolNodeConfig<TResult>['dispatcher'];
  readonly reconcileProbe?: WalBackedToolNodeConfig<TResult>['reconcileProbe'];
  readonly probeMaxAttempts?: number;
  readonly probeRetryDelayMs?: number;
  readonly allowRedispatchAfterExhaustedProbes?: boolean;
  readonly simulateCrashBeforeCheckpoint?: boolean;

  constructor(config: WalBackedToolNodeConfig<TResult>) {
    super({
      ...config,
      sideEffecting: true,
    });
    this.wal = config.wal;
    this.toolName = config.toolName ?? config.name;
    this.stepId = config.stepId ?? config.name;
    this.actionKind = config.actionKind;
    this.commandIdBuilder = config.commandIdBuilder;
    this.dispatcher = config.dispatcher;
    this.reconcileProbe = config.reconcileProbe;
    this.probeMaxAttempts = config.probeMaxAttempts;
    this.probeRetryDelayMs = config.probeRetryDelayMs;
    this.allowRedispatchAfterExhaustedProbes =
      config.allowRedispatchAfterExhaustedProbes;
    this.simulateCrashBeforeCheckpoint = config.simulateCrashBeforeCheckpoint;
  }

  protected async *runImpl(
    ctx: NodeContext,
    input: unknown
  ): AsyncGenerator<Event, void, void> {
    // Extension 2: Enforce non-escalating webhook/event intake boundary
    if (ctx.executionAuthority === 'NONE') {
      throw new NodePrivilegeEscalationError({
        nodeName: this.name,
        nodePath: ctx.nodePath,
        branch: ctx.branch,
        currentAuthority: ctx.executionAuthority,
      });
    }

    const inputArgs = coerceInputRecord(input);
    const pluginManager = ctx.invocationContext.pluginManager;
    if (pluginManager?.hasPlugins && pluginManager.runBeforeToolCallback) {
      const syntheticTool = {
        name: this.toolName,
        description: this.description,
        isLongRunning: false,
        runAsync: async () => undefined,
      } as unknown as BaseTool;
      await pluginManager.runBeforeToolCallback({
        tool: syntheticTool,
        toolArgs: inputArgs,
        toolContext: {
          invocationContext: ctx.invocationContext,
          invocationId: ctx.invocationId,
          agentName: this.name,
          functionCallId:
            typeof inputArgs['functionCallId'] === 'string'
              ? inputArgs['functionCallId']
              : undefined,
          state: ctx.state,
          actions: ctx.actions,
          nodeContext: ctx,
        },
      });
    }

    const canonicalArgs = canonicalJsonStringify(inputArgs);
    const argsDigest = sha256Sync(canonicalArgs).slice(0, 16);
    const commandId = this.commandIdBuilder
      ? this.commandIdBuilder(ctx, inputArgs)
      : `${ctx.workflowId}:${ctx.nodePath}:${argsDigest}`;

    const idempotencyKey = DurableCommandWal.computeIdempotencyKey(
      ctx.workflowId,
      this.stepId,
      this.toolName,
      canonicalArgs
    );

    // Mark side-effect as dispatched BEFORE invoking external mutation so
    // NodeTimeoutError can never trigger a blind retry in node_runner.ts.
    ctx.sideEffectDispatched = true;

    let customRoute: RouteValue | RouteValue[] | undefined;

    try {
      const { record, reconciledAfterCrash } =
        await this.wal.executeOrReconcile({
          commandId,
          runId: ctx.workflowId,
          stepId: this.stepId,
          toolName: this.toolName,
          actionKind: this.actionKind,
          canonicalArgs,
          dispatchFn: async (idemKey) => {
            const res = await this.dispatcher(inputArgs, idemKey, ctx);
            customRoute = res.route;
            return {
              externalResourceId: res.externalResourceId,
              result: res.result,
            };
          },
          reconcileProbeFn: this.reconcileProbe
            ? (idemKey, attempt) =>
                this.reconcileProbe!(inputArgs, idemKey, attempt, ctx)
            : async () => ({ exists: false, outcomeUnknown: true }),
          probeMaxAttempts: this.probeMaxAttempts,
          probeRetryDelayMs: this.probeRetryDelayMs,
          allowRedispatchAfterExhaustedProbes:
            this.allowRedispatchAfterExhaustedProbes,
          simulateCrashBeforeCheckpoint: this.simulateCrashBeforeCheckpoint,
        });

      if (record.state === 'OUTCOME_UNKNOWN') {
        throw new NodeOutcomeUnknownError({
          nodeName: this.name,
          commandId,
          idempotencyKey: record.idempotency_key,
          reason:
            record.probe_error ??
            'Side-effect outcome ambiguous in DurableCommandWal',
        });
      }

      const walPayload = {
        commandId: record.command_id,
        idempotencyKey: record.idempotency_key,
        state: record.state,
        externalResourceId: record.external_resource_id,
        result: record.result,
        reconciledAfterCrash,
      };

      ctx.state.set(`wal:${this.name}`, walPayload);

      yield createEvent({
        author: this.name,
        invocationId: ctx.invocationId,
        branch: ctx.branch,
        content: toContent(walPayload),
        output: walPayload,
        route: customRoute,
        actions: { stateDelta: { ...ctx.actions.stateDelta } },
      });
    } catch (err) {
      if (err instanceof NodeOutcomeUnknownError) {
        throw err;
      }
      if (err instanceof NodeTimeoutError) {
        throw new NodeOutcomeUnknownError({
          nodeName: this.name,
          commandId,
          idempotencyKey,
          reason: err.message,
        });
      }
      throw err;
    }
  }
}

// ============================================================================
// 2. PasskeyConsentNode (Extension 5 ApprovalGate + ConsentChallengeStore)
// ============================================================================

export interface ConsentResumePayload {
  decision: SignedDecision;
  envelope: PasskeyConsentEnvelope;
  workflow_id?: string;
  graph_topology_hash?: string;
  node_path?: string;
  now_ms?: number;
}

export function isConsentResumePayload(
  value: unknown
): value is ConsentResumePayload {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.decision !== 'object' ||
    candidate.decision === null ||
    typeof candidate.envelope !== 'object' ||
    candidate.envelope === null
  ) {
    return false;
  }
  const dec = candidate.decision as Record<string, unknown>;
  const env = candidate.envelope as Record<string, unknown>;
  return (
    typeof dec.action_id === 'string' &&
    (dec.verdict === 'approve' || dec.verdict === 'reject') &&
    typeof dec.decider === 'string' &&
    typeof env.consent_id === 'string' &&
    typeof env.challenge_nonce === 'string' &&
    typeof env.signature === 'string'
  );
}

/**
 * Computes a graph-topology-bound resource version string so a PasskeyConsentEnvelope
 * signed for one graph topology or node path cannot be replayed on a mutated graph
 * or a different node.
 */
export function computeGraphBoundResourceVersion(params: {
  baseResourceVersion: string;
  workflowId: string;
  graphTopologyHash: string;
  nodePath: string;
}): string {
  return `${params.baseResourceVersion}@wf:${params.workflowId}:${params.nodePath}:${params.graphTopologyHash.slice(0, 16)}`;
}

export interface PasskeyConsentNodeConfig extends BaseNodeConfig {
  approvalGate: ApprovalGate;
  challengeStore: ConsentChallengeStore;
  publicKey:
    | crypto.KeyObject
    | ((deciderDid: string, ctx: NodeContext) => crypto.KeyObject);
  operatorDid: string | ((ctx: NodeContext) => string);
  actionId: string | ((ctx: NodeContext) => string);
  actionType: string | ((ctx: NodeContext) => string);
  targetResourceUri: string | ((ctx: NodeContext) => string);
  resourceVersion: string | ((ctx: NodeContext) => string);
  policyRevision: string | ((ctx: NodeContext) => string);
  parameters?:
    | Record<string, unknown>
    | ((ctx: NodeContext, input: unknown) => Record<string, unknown>);
  prompt?: string;
  challengeTtlMs?: number;
  /**
   * Defaults to `true`: binds `resource_version` and `request_canonical_hash`
   * to `(workflowId, nodePath, graphTopologyHash)` via {@link computeGraphBoundResourceVersion}.
   */
  requireGraphBoundResourceVersion?: boolean;
  nowMs?: () => number;
}

export class PasskeyConsentNode extends BaseNode {
  readonly approvalGate: ApprovalGate;
  readonly challengeStore: ConsentChallengeStore;
  readonly publicKeyResolver: (
    deciderDid: string,
    ctx: NodeContext
  ) => crypto.KeyObject;
  readonly operatorDidResolver: (ctx: NodeContext) => string;
  readonly actionIdResolver: (ctx: NodeContext) => string;
  readonly actionTypeResolver: (ctx: NodeContext) => string;
  readonly targetResourceUriResolver: (ctx: NodeContext) => string;
  readonly resourceVersionResolver: (ctx: NodeContext) => string;
  readonly policyRevisionResolver: (ctx: NodeContext) => string;
  readonly parametersResolver: (
    ctx: NodeContext,
    input: unknown
  ) => Record<string, unknown>;
  readonly prompt: string;
  readonly challengeTtlMs: number;
  readonly requireGraphBoundResourceVersion: boolean;
  readonly nowMs: () => number;

  constructor(config: PasskeyConsentNodeConfig) {
    super({ ...config, rerunOnResume: true });
    this.approvalGate = config.approvalGate;
    this.challengeStore = config.challengeStore;
    this.publicKeyResolver =
      typeof config.publicKey === 'function'
        ? config.publicKey
        : () => config.publicKey as crypto.KeyObject;
    this.operatorDidResolver =
      typeof config.operatorDid === 'function'
        ? config.operatorDid
        : () => config.operatorDid as string;
    this.actionIdResolver =
      typeof config.actionId === 'function'
        ? config.actionId
        : () => config.actionId as string;
    this.actionTypeResolver =
      typeof config.actionType === 'function'
        ? config.actionType
        : () => config.actionType as string;
    this.targetResourceUriResolver =
      typeof config.targetResourceUri === 'function'
        ? config.targetResourceUri
        : () => config.targetResourceUri as string;
    this.resourceVersionResolver =
      typeof config.resourceVersion === 'function'
        ? config.resourceVersion
        : () => config.resourceVersion as string;
    this.policyRevisionResolver =
      typeof config.policyRevision === 'function'
        ? config.policyRevision
        : () => config.policyRevision as string;
    this.parametersResolver =
      typeof config.parameters === 'function'
        ? config.parameters
        : (_ctx, input) =>
            (config.parameters as Record<string, unknown> | undefined) ??
            coerceInputRecord(input);
    this.prompt =
      config.prompt ??
      `Cryptographic Passkey/Ed25519 consent required for node '${this.name}'`;
    this.challengeTtlMs = config.challengeTtlMs ?? 60_000;
    this.requireGraphBoundResourceVersion =
      config.requireGraphBoundResourceVersion ?? true;
    this.nowMs = config.nowMs ?? (() => Date.now());
  }

  protected async *runImpl(
    ctx: NodeContext,
    input: unknown
  ): AsyncGenerator<Event | RequestInput, void, void> {
    const operatorDid = this.operatorDidResolver(ctx);
    const actionId = this.actionIdResolver(ctx);
    const actionType = this.actionTypeResolver(ctx);
    const targetResourceUri = this.targetResourceUriResolver(ctx);
    const baseVersion = this.resourceVersionResolver(ctx);
    const effectiveResourceVersion = this.requireGraphBoundResourceVersion
      ? computeGraphBoundResourceVersion({
          baseResourceVersion: baseVersion,
          workflowId: ctx.workflowId,
          graphTopologyHash: ctx.graphTopologyHash,
          nodePath: ctx.nodePath,
        })
      : baseVersion;
    const policyRevision = this.policyRevisionResolver(ctx);
    const parameters = this.parametersResolver(ctx, input);

    const requestCanonicalHash = computeRequestCanonicalHash({
      action_type: actionType,
      target_resource_uri: targetResourceUri,
      resource_version: effectiveResourceVersion,
      policy_revision: policyRevision,
      parameters,
    });

    const expectedContext: ExpectedConsentContext = {
      request_canonical_hash: requestCanonicalHash,
      action_type: actionType,
      target_resource_uri: targetResourceUri,
      resource_version: effectiveResourceVersion,
      policy_revision: policyRevision,
    };

    const interruptId = `consent:${ctx.nodePath || this.name}`;
    const stateChallengeKey = `__consent_challenge:${ctx.nodePath || this.name}`;

    const rawResponse = ctx.resumeInputs[interruptId];

    if (rawResponse === undefined) {
      const now = this.nowMs();
      const challengeNonce = this.challengeStore.issueChallenge(
        operatorDid,
        this.challengeTtlMs,
        now
      );

      const challengePayload = {
        challenge_nonce: challengeNonce,
        operator_did: operatorDid,
        action_id: actionId,
        action_type: actionType,
        target_resource_uri: targetResourceUri,
        resource_version: effectiveResourceVersion,
        policy_revision: policyRevision,
        request_canonical_hash: requestCanonicalHash,
        workflow_id: ctx.workflowId,
        graph_topology_hash: ctx.graphTopologyHash,
        node_path: ctx.nodePath,
      };

      ctx.invocationContext.session.state[stateChallengeKey] = challengePayload;

      yield new RequestInput({
        interruptId,
        message: this.prompt,
        payload: challengePayload,
      });
      return;
    }

    if (!isConsentResumePayload(rawResponse)) {
      throw new Error(
        `CONSENT_PLAIN_TEXT_FORBIDDEN: Node '${ctx.nodePath}' requires a cryptographically signed PasskeyConsentEnvelope; plain-text or unsigned resume payload rejected.`
      );
    }

    const storedBinding = ctx.invocationContext.session.state[
      stateChallengeKey
    ] as
      | {
          challenge_nonce: string;
          workflow_id: string;
          graph_topology_hash: string;
          node_path: string;
        }
      | undefined;

    if (
      rawResponse.workflow_id !== undefined &&
      rawResponse.workflow_id !== ctx.workflowId
    ) {
      throw new Error(
        `CONSENT_GRAPH_BINDING_MISMATCH: Consent payload workflow_id '${rawResponse.workflow_id}' does not match '${ctx.workflowId}'.`
      );
    }
    if (
      rawResponse.graph_topology_hash !== undefined &&
      rawResponse.graph_topology_hash !== ctx.graphTopologyHash
    ) {
      throw new Error(
        `CONSENT_GRAPH_BINDING_MISMATCH: Consent payload graph_topology_hash '${rawResponse.graph_topology_hash}' does not match '${ctx.graphTopologyHash}'.`
      );
    }
    if (
      rawResponse.node_path !== undefined &&
      rawResponse.node_path !== ctx.nodePath
    ) {
      throw new Error(
        `CONSENT_GRAPH_BINDING_MISMATCH: Consent payload node_path '${rawResponse.node_path}' does not match '${ctx.nodePath}'.`
      );
    }

    const evaluationNowMs = rawResponse.now_ms ?? this.nowMs();
    const publicKey = this.publicKeyResolver(rawResponse.decision.decider, ctx);

    // Note: ApprovalGate.submitDecisionWithConsent atomically burns the challenge_nonce
    // via challengeStore.takeChallenge BEFORE verifying the cryptographic signature!
    this.approvalGate.submitDecisionWithConsent({
      decision: rawResponse.decision,
      envelope: rawResponse.envelope,
      expected: expectedContext,
      publicKey,
      challengeStore: this.challengeStore,
      nowMs: evaluationNowMs,
    });

    // If storedBinding had a different challenge_nonce than what was submitted,
    // reject cross-node challenge substitution
    if (
      storedBinding &&
      rawResponse.envelope.challenge_nonce !== storedBinding.challenge_nonce
    ) {
      throw new Error(
        `CONSENT_CHALLENGE_MISMATCH: Signed envelope challenge_nonce '${rawResponse.envelope.challenge_nonce}' does not match node challenge '${storedBinding.challenge_nonce}'.`
      );
    }

    const status = this.approvalGate.evaluate(actionId);
    if (status === 'authorized') {
      this.approvalGate.consumeGrantForExecution(
        rawResponse.envelope.consent_id,
        evaluationNowMs
      );
      ctx.executionAuthority = 'CONSENT_ELEVATED';
    }

    const consentResult = {
      action_id: actionId,
      verdict: rawResponse.decision.verdict,
      status,
      consent_id: rawResponse.envelope.consent_id,
      operator_did: rawResponse.envelope.operator_did,
      execution_authority: ctx.executionAuthority,
    };

    ctx.state.set(`consent:${this.name}`, consentResult);

    yield createEvent({
      author: this.name,
      invocationId: ctx.invocationId,
      branch: ctx.branch,
      content: toContent(consentResult),
      output: consentResult,
      route: status,
      actions: { stateDelta: { ...ctx.actions.stateDelta } },
    });
  }
}

// ============================================================================
// 3. ByzantineQuorumNode (Extension 5 ByzantineConsensusEngine + AuditLedger)
// ============================================================================

export interface ByzantineQuorumNodeConfig extends BaseNodeConfig {
  auditLedger?: CryptographicAuditLedger;
  incidentId?: string | ((ctx: NodeContext, input: unknown) => string);
  squad: AgentSquad | ((ctx: NodeContext, input: unknown) => AgentSquad);
  ballots:
    | ConsensusBallot[]
    | ((
        ctx: NodeContext,
        input: unknown
      ) => Promise<ConsensusBallot[]> | ConsensusBallot[]);
  forceHumanGating?: boolean | ((ctx: NodeContext, input: unknown) => boolean);
}

export class ByzantineQuorumNode extends BaseNode {
  readonly auditLedger?: CryptographicAuditLedger;
  readonly incidentIdResolver: (ctx: NodeContext, input: unknown) => string;
  readonly squadResolver: (ctx: NodeContext, input: unknown) => AgentSquad;
  readonly ballotsResolver: (
    ctx: NodeContext,
    input: unknown
  ) => Promise<ConsensusBallot[]> | ConsensusBallot[];
  readonly forceHumanGatingResolver: (
    ctx: NodeContext,
    input: unknown
  ) => boolean;

  constructor(config: ByzantineQuorumNodeConfig) {
    super(config);
    this.auditLedger = config.auditLedger;
    this.incidentIdResolver =
      typeof config.incidentId === 'function'
        ? config.incidentId
        : (ctx) => (config.incidentId as string | undefined) ?? ctx.workflowId;
    this.squadResolver =
      typeof config.squad === 'function'
        ? config.squad
        : () => config.squad as AgentSquad;
    this.ballotsResolver =
      typeof config.ballots === 'function'
        ? config.ballots
        : () => config.ballots as ConsensusBallot[];
    this.forceHumanGatingResolver =
      typeof config.forceHumanGating === 'function'
        ? config.forceHumanGating
        : () => Boolean(config.forceHumanGating);
  }

  protected async *runImpl(
    ctx: NodeContext,
    input: unknown
  ): AsyncGenerator<Event, void, void> {
    const incidentId = this.incidentIdResolver(ctx, input);
    const squad = this.squadResolver(ctx, input);
    const ballots = await this.ballotsResolver(ctx, input);
    const forceHumanGating = this.forceHumanGatingResolver(ctx, input);

    const evaluation: QuorumEvaluation =
      ByzantineConsensusEngine.evaluateQuorum(
        incidentId,
        squad,
        ballots,
        forceHumanGating
      );

    const ledger = this.auditLedger ?? ctx.invocationContext.auditLedger;
    if (ledger) {
      ledger.recordBlock(
        incidentId,
        'QUORUM_EVALUATION',
        {
          workflow_id: ctx.workflowId,
          node_path: ctx.nodePath,
          squad_id: evaluation.squadId,
          status: evaluation.status,
          weighted_approval_ratio: evaluation.weightedApprovalRatio,
          byzantine_anomalies_detected: evaluation.byzantineAnomaliesDetected,
          flagged_agent_ids: evaluation.flaggedAgentIds,
          merkle_root_hash: evaluation.merkleRootHash,
        },
        ballots.map((b) => ({ did: b.did, signature: b.signature }))
      );
    }

    if (evaluation.status === 'approved') {
      ctx.executionAuthority = 'QUORUM_ELEVATED';
    }

    ctx.state.set(`quorum:${this.name}`, evaluation);

    yield createEvent({
      author: this.name,
      invocationId: ctx.invocationId,
      branch: ctx.branch,
      content: toContent(evaluation),
      output: evaluation,
      route: evaluation.status,
      actions: { stateDelta: { ...ctx.actions.stateDelta } },
    });
  }
}

// ============================================================================
// 4. SandboxedExecutionNode (Extensions 1, 2, & 4)
// ============================================================================

export type SandboxExecutionTerminalState =
  | 'EFFECTIVE'
  | 'COMPLETED'
  | 'FAILED'
  | 'EXPIRED'
  | 'OUTCOME_UNKNOWN';

export interface SandboxExecutionResult {
  requestId: string;
  state: SandboxExecutionTerminalState;
  output?: Record<string, unknown>;
  route?: RouteValue | RouteValue[];
  errorMessage?: string;
}

export interface SandboxedExecutionNodeConfig extends BaseNodeConfig {
  /**
   * Executes the isolated sandbox workload and returns its lifecycle state.
   */
  executor: (
    args: Record<string, unknown>,
    ctx: NodeContext
  ) => Promise<SandboxExecutionResult>;

  /**
   * Optional generational ownership fence check invoked before and after execution.
   */
  fenceValidator?: (ctx: NodeContext) => void | Promise<void>;
}

export class SandboxedExecutionNode extends BaseNode {
  readonly executor: SandboxedExecutionNodeConfig['executor'];
  readonly fenceValidator?: SandboxedExecutionNodeConfig['fenceValidator'];

  constructor(config: SandboxedExecutionNodeConfig) {
    super({
      ...config,
      sideEffecting: true,
    });
    this.executor = config.executor;
    this.fenceValidator = config.fenceValidator;
  }

  protected async *runImpl(
    ctx: NodeContext,
    input: unknown
  ): AsyncGenerator<Event, void, void> {
    // Extension 2: Block untrusted ingress execution authority
    if (ctx.executionAuthority === 'NONE') {
      throw new NodePrivilegeEscalationError({
        nodeName: this.name,
        nodePath: ctx.nodePath,
        branch: ctx.branch,
        currentAuthority: ctx.executionAuthority,
      });
    }

    if (this.fenceValidator) {
      await this.fenceValidator(ctx);
    }

    const args = coerceInputRecord(input);
    ctx.sideEffectDispatched = true;

    const sandboxResult = await this.executor(args, ctx);

    if (this.fenceValidator) {
      await this.fenceValidator(ctx);
    }

    if (
      sandboxResult.state === 'OUTCOME_UNKNOWN' ||
      sandboxResult.state === 'EXPIRED'
    ) {
      throw new NodeOutcomeUnknownError({
        nodeName: this.name,
        commandId: sandboxResult.requestId,
        idempotencyKey: sandboxResult.requestId,
        reason:
          sandboxResult.errorMessage ??
          `Sandbox execution ended in ${sandboxResult.state}`,
      });
    }

    if (sandboxResult.state === 'FAILED') {
      throw new Error(
        sandboxResult.errorMessage ??
          `Sandbox execution '${sandboxResult.requestId}' failed.`
      );
    }

    ctx.state.set(`sandbox:${this.name}`, sandboxResult);

    yield createEvent({
      author: this.name,
      invocationId: ctx.invocationId,
      branch: ctx.branch,
      content: toContent(sandboxResult),
      output: sandboxResult,
      route: sandboxResult.route,
      actions: { stateDelta: { ...ctx.actions.stateDelta } },
    });
  }
}

// ============================================================================
// 5. AcrAgentNode (Ed25519/HMAC Signed Deliberation & Multi-Turn Task Agent)
// ============================================================================

export interface AcrAgentTaskTurnParams {
  step: number;
  ctx: NodeContext;
  invocationContext: InvocationContext;
  input: unknown;
  resolvedInstruction: string;
  visibleEvents: Event[];
  callTool: (
    toolName: string,
    args?: Record<string, unknown>
  ) => Promise<Event>;
  emitThought: (thoughtText: string, responseText?: string) => Event;
}

export interface AcrAgentNodeConfig extends BaseNodeConfig {
  agent: AgentProfile;
  auditLedger?: CryptographicAuditLedger;
  /**
   * Execution mode: `'single_turn'` (default) or multi-turn `'task'` mode
   * with `FinishTaskTool`, `ExitLoopTool`, and nudge reminders.
   */
  mode?: AgentExecutionMode;
  /** Maximum steps in `'task'` mode (defaults to 10). */
  maxSteps?: number;
  /**
   * Optional instruction template supporting `{stateKey}` and
   * `<Class.field from node>` predecessor references across both raw events
   * and `CompactedEvent.checkpointManifest.outputsByNode`.
   */
  instruction?: string;
  /** Optional tools available to the agent in `'task'` mode. */
  tools?: BaseTool[];
  /** Optional compactor (e.g. `TrajectoryThoughtPruningCompactor` or `AnchoredContextCompactor`) invoked after each turn. */
  compactor?: BaseContextCompactor;
  /** Optional direct `LlmAgentNodeTarget` adapter. */
  llmAgent?: LlmAgentNodeTarget;
  /**
   * Multi-turn step callback used when `mode === 'task'`.
   */
  taskStep?: (
    params: AcrAgentTaskTurnParams
  ) => Promise<Event | Event[] | void> | Event | Event[] | void;
  /**
   * Deliberation callback (receives `resolvedInstruction` as 3rd argument).
   */
  deliberate?: (
    ctx: NodeContext,
    input: unknown,
    resolvedInstruction: string
  ) =>
    | Promise<{
        reasoning: string;
        proposedHypothesis?: string;
        proposedActions?: ToolCallProposal[];
        confidence?: number;
        route?: RouteValue | RouteValue[];
      }>
    | {
        reasoning: string;
        proposedHypothesis?: string;
        proposedActions?: ToolCallProposal[];
        confidence?: number;
        route?: RouteValue | RouteValue[];
      };
}

export class AcrAgentNode extends BaseNode {
  readonly agent: AgentProfile;
  readonly auditLedger?: CryptographicAuditLedger;
  readonly mode: AgentExecutionMode;
  readonly maxSteps: number;
  readonly instruction?: string;
  readonly tools: BaseTool[];
  readonly compactor?: BaseContextCompactor;
  readonly llmAgent?: LlmAgentNodeTarget;
  readonly taskStep?: AcrAgentNodeConfig['taskStep'];
  readonly deliberate?: AcrAgentNodeConfig['deliberate'];

  constructor(config: AcrAgentNodeConfig) {
    super(config);
    this.agent = config.agent;
    this.auditLedger = config.auditLedger;
    this.mode = config.mode ?? 'single_turn';
    this.maxSteps = config.maxSteps ?? 10;
    this.instruction = config.instruction;
    this.tools = [...(config.tools ?? [])];
    this.compactor = config.compactor;
    this.llmAgent = config.llmAgent;
    this.taskStep = config.taskStep;
    this.deliberate = config.deliberate;
  }

  protected async *runImpl(
    ctx: NodeContext,
    input: unknown
  ): AsyncGenerator<Event, void, void> {
    const scopedIc = withWorkflowInstructionScope(ctx, input);
    const resolvedInstruction = this.instruction
      ? await injectSessionState(this.instruction, {
          invocationContext: scopedIc,
          state: ctx.session.state,
        })
      : '';

    if (this.llmAgent) {
      yield* runLlmAgentAsNode(this.llmAgent, ctx, input);
      return;
    }

    if (this.mode === 'task' && this.taskStep) {
      const self = this;
      let turnCounter = 0;

      const target: LlmAgentNodeTarget = {
        name: this.name,
        mode: 'task',
        maxSteps: this.maxSteps,
        outputSchema: this.outputSchema,
        tools: this.tools,
        async *runImpl(ic: InvocationContext) {
          turnCounter += 1;
          const currentInstruct = self.instruction
            ? await injectSessionState(self.instruction, {
                invocationContext: ic,
                state: ctx.session.state,
              })
            : resolvedInstruction;

          const consumerScope = resolveConsumerScope(
            self.isolationScope,
            self.name,
            ctx.isolationScope
          );
          const visibleEvents = filterByIsolationScope(
            getActiveEvents(ctx.session.events, consumerScope),
            consumerScope
          );

          const emittedInTurn: Event[] = [];

          const callTool = async (
            toolName: string,
            args: Record<string, unknown> = {}
          ): Promise<Event> => {
            const tool = self.tools.find((t) => t.name === toolName);
            if (!tool) {
              throw new Error(
                `Tool '${toolName}' not found on AcrAgentNode '${self.name}'.`
              );
            }
            const callId = `call-${self.name}-${turnCounter}-${toolName}`;
            let callEvent = createEvent({
              author: self.name,
              invocationId: ctx.invocationId,
              branch: ctx.branch,
              isolationScope: consumerScope,
              content: {
                role: 'model',
                parts: [
                  {
                    functionCall: {
                      id: callId,
                      name: toolName,
                      args,
                    },
                  },
                ],
              },
            });

            if (
              ic.pluginManager?.hasPlugins &&
              ic.pluginManager.runOnEventCallback
            ) {
              const signed = await ic.pluginManager.runOnEventCallback({
                invocationContext: ic,
                event: callEvent,
              });
              if (signed) {
                callEvent = signed;
              }
            }
            emittedInTurn.push(callEvent);

            const toolActions = createEventActions();
            const toolContext: ToolContextShim = {
              invocationContext: ic,
              invocationId: ctx.invocationId,
              agentName: self.name,
              functionCallId: callId,
              resumeInputs: ctx.resumeInputs,
              state: ctx.state,
              actions: toolActions,
              nodeContext: ctx,
              workflowId: ctx.workflowId,
              graphTopologyHash: ctx.graphTopologyHash,
              nodePath: ctx.nodePath,
              executionAuthority: ctx.executionAuthority,
            };

            let rawResult: unknown;
            if (
              ic.pluginManager?.hasPlugins &&
              ic.pluginManager.runBeforeToolCallback
            ) {
              rawResult = await ic.pluginManager.runBeforeToolCallback({
                tool,
                toolArgs: args,
                toolContext,
              });
            }

            if (rawResult === undefined) {
              try {
                rawResult = await tool.runAsync({ args, toolContext });
              } catch (err) {
                const errorObj =
                  err instanceof Error ? err : new Error(String(err));
                if (
                  ic.pluginManager?.hasPlugins &&
                  ic.pluginManager.runOnToolErrorCallback
                ) {
                  const recovered =
                    await ic.pluginManager.runOnToolErrorCallback({
                      tool,
                      toolArgs: args,
                      toolContext,
                      error: errorObj,
                    });
                  if (recovered !== undefined) {
                    rawResult = recovered;
                  } else {
                    throw errorObj;
                  }
                } else {
                  throw errorObj;
                }
              }
            }

            let responseObj: Record<string, unknown> =
              typeof rawResult === 'object' &&
              rawResult !== null &&
              !Array.isArray(rawResult)
                ? (rawResult as Record<string, unknown>)
                : { result: rawResult ?? null };

            if (
              ic.pluginManager?.hasPlugins &&
              ic.pluginManager.runAfterToolCallback
            ) {
              const modified = await ic.pluginManager.runAfterToolCallback({
                tool,
                toolArgs: args,
                toolContext,
                result: responseObj,
              });
              if (modified !== undefined) {
                responseObj = modified;
              }
            }

            const respEvent = createEvent({
              author: self.name,
              invocationId: ctx.invocationId,
              branch: ctx.branch,
              isolationScope: consumerScope,
              actions: toolActions,
              content: {
                role: 'user',
                parts: [
                  {
                    functionResponse: {
                      id: callId,
                      name: toolName,
                      response: responseObj,
                    },
                  },
                ],
              },
            });
            emittedInTurn.push(respEvent);
            return respEvent;
          };

          const emitThought = (
            thoughtText: string,
            responseText?: string
          ): Event => {
            const parts = [
              { text: thoughtText, thought: true },
              ...(responseText !== undefined ? [{ text: responseText }] : []),
            ];
            const ev = createEvent({
              author: self.name,
              invocationId: ctx.invocationId,
              branch: ctx.branch,
              isolationScope: consumerScope,
              content: {
                role: 'model',
                parts,
              },
            });
            emittedInTurn.push(ev);
            return ev;
          };

          const stepResult = await self.taskStep!({
            step: turnCounter,
            ctx,
            invocationContext: ic,
            input,
            resolvedInstruction: currentInstruct,
            visibleEvents,
            callTool,
            emitThought,
          });

          if (Array.isArray(stepResult)) {
            for (const ev of stepResult) {
              if (!emittedInTurn.includes(ev)) {
                emittedInTurn.push(ev);
              }
            }
          } else if (
            stepResult &&
            typeof stepResult === 'object' &&
            'id' in stepResult &&
            'timestamp' in stepResult
          ) {
            if (!emittedInTurn.includes(stepResult as Event)) {
              emittedInTurn.push(stepResult as Event);
            }
          }

          for (const ev of emittedInTurn) {
            yield ev;
          }

          if (self.compactor) {
            const scopedCompactionIc = consumerScope
              ? ic.clone({ isolationScope: consumerScope })
              : ic;
            if (
              await self.compactor.shouldCompact(
                scopedCompactionIc,
                ContextCompactionTrigger.AfterInvocation
              )
            ) {
              await self.compactor.compact(scopedCompactionIc);
            }
          }
        },
      };

      for await (const ev of runLlmAgentAsNode(target, ctx, input)) {
        yield ev;
      }

      if (ctx.output !== undefined) {
        yield createEvent({
          author: this.name,
          invocationId: ctx.invocationId,
          branch: ctx.branch,
          isolationScope: ctx.isolationScope,
          content: toContent(ctx.output),
          output: ctx.output,
          actions: ctx.state.hasDelta()
            ? { stateDelta: { ...ctx.actions.stateDelta } }
            : undefined,
        });
      }
      return;
    }

    if (!this.deliberate) {
      throw new Error(
        `AcrAgentNode '${this.name}' requires either 'deliberate', 'taskStep', or 'llmAgent'.`
      );
    }

    const outcome = await this.deliberate(ctx, input, resolvedInstruction);
    const existingTurns =
      ctx.state.get<DeliberationTurn[]>('deliberation_turns') ?? [];
    const turnIndex = existingTurns.length + 1;
    const now = Date.now();
    const confidence = outcome.confidence ?? 0.85;
    const sigPayload = `${ctx.workflowId}:${turnIndex}:${this.agent.did}:${outcome.reasoning}:${confidence}:${now}`;
    const signature = hmacSha256Sync(this.agent.publicKey, sigPayload);

    const turn: DeliberationTurn & { resolvedInstruction?: string } = {
      id: `turn-${turnIndex}-${ctx.runId}`,
      turnIndex,
      agentId: this.agent.id,
      role: this.agent.role as AgentRole,
      agentName: this.agent.name,
      phase: 'deliberate',
      reasoning: outcome.reasoning,
      proposedHypothesis: outcome.proposedHypothesis,
      proposedActions: outcome.proposedActions ?? [],
      confidence,
      timestamp: now,
      signature,
      ...(this.instruction !== undefined ? { resolvedInstruction } : {}),
    };

    const ledger = this.auditLedger ?? ctx.invocationContext.auditLedger;
    if (ledger) {
      ledger.recordBlock(
        ctx.workflowId,
        'DELIBERATION_TURN',
        {
          turn_id: turn.id,
          node_path: ctx.nodePath,
          agent_id: turn.agentId,
          role: turn.role,
          confidence: turn.confidence,
          proposed_actions_count: turn.proposedActions.length,
        },
        [{ did: this.agent.did, signature }]
      );
    }

    ctx.state.set('deliberation_turns', [...existingTurns, turn]);

    yield createEvent({
      author: this.name,
      invocationId: ctx.invocationId,
      branch: ctx.branch,
      content: toContent(turn),
      output: turn,
      route: outcome.route,
      actions: { stateDelta: { ...ctx.actions.stateDelta } },
    });
  }
}

// ============================================================================
// 6. Atlas2GraphWorkflow (Zero-Competitor Hyperfused Workflow Orchestrator)
// ============================================================================

export type Atlas2GraphWorkflowConfig = WorkflowConfig & {
  wal?: DurableCommandWal;
  approvalGate?: ApprovalGate;
  challengeStore?: ConsentChallengeStore;
  auditLedger?: CryptographicAuditLedger;
  /**
   * Optional untrusted ingress event envelope (Extension 2). When its
   * `execution_authority` is `'NONE'`, the workflow starts with `'NONE'`
   * authority and forbids side-effecting nodes until a governance node
   * (`ByzantineQuorumNode` or `PasskeyConsentNode`) elevates authority.
   */
  ingressEvent?: {
    execution_authority?: ExecutionAuthorityLevel;
  };
};

export interface RewindToCheckpointParams {
  session: WorkflowSession;
  invocationId?: string;
  targetNodePath: string;
  targetRunId?: string;
  reason: string;
  operatorDid?: string;
  actorDid?: string;
  compensatingStateDelta?: Record<string, unknown>;
  auditLedger?: CryptographicAuditLedger;
}

export interface RewindToCheckpointResult extends CompactedEvent {
  rewoundEvent: CompactedEvent;
  restoredOutput?: unknown;
  restoredInput?: unknown;
  auditBlock?: AuditBlock;
}

export class Atlas2GraphWorkflow extends Workflow {
  readonly wal?: DurableCommandWal;
  readonly approvalGate?: ApprovalGate;
  readonly challengeStore?: ConsentChallengeStore;
  readonly auditLedger?: CryptographicAuditLedger;

  constructor(config: Atlas2GraphWorkflowConfig) {
    super({
      ...config,
      initialExecutionAuthority:
        config.ingressEvent?.execution_authority ??
        config.initialExecutionAuthority,
    });
    this.wal = config.wal;
    this.approvalGate = config.approvalGate;
    this.challengeStore = config.challengeStore;
    this.auditLedger = config.auditLedger;
  }

  /**
   * Forward compensating checkpoint rewind.
   * Appends a compensating `CompactedEvent` to `session.events` (preserving
   * checkpoints up to `targetNodePath` while compacting away post-checkpoint
   * runs) and records a `WORKFLOW_CHECKPOINT_REWIND` block in
   * `CryptographicAuditLedger` without truncating either the append-only event
   * log or the cryptographic hash chain.
   */
  rewindToCheckpoint(
    params: RewindToCheckpointParams
  ): RewindToCheckpointResult {
    const ledger = params.auditLedger ?? this.auditLedger;
    verifySessionAuditIntegrity(ledger);

    const byPath = reconstructNodeStatesByPath(params.session.events);
    const byName = reconstructNodeStates(params.session.events);
    const fullLookupKey = params.targetRunId
      ? `${params.targetNodePath}@${params.targetRunId}`
      : params.targetNodePath;

    const prior =
      byPath.get(fullLookupKey) ??
      byPath.get(params.targetNodePath) ??
      byName.get(params.targetNodePath);

    if (params.compensatingStateDelta) {
      applyEventStateDelta(params.session.state, params.compensatingStateDelta);
    }

    // Find index of the target checkpoint event so we retain checkpoints up to and including it
    let targetIdx = -1;
    for (let i = params.session.events.length - 1; i >= 0; i--) {
      const ev = params.session.events[i];
      if (
        ev.nodeInfo?.path === params.targetNodePath &&
        (!params.targetRunId || ev.nodeInfo?.runId === params.targetRunId)
      ) {
        targetIdx = i;
        break;
      }
    }

    const eventsUpToTarget =
      targetIdx >= 0
        ? params.session.events.slice(0, targetIdx + 1)
        : params.session.events;
    const manifest = buildCheckpointManifest(eventsUpToTarget);
    if (params.invocationId) {
      manifest.invocationId = params.invocationId;
    }
    const startTime =
      params.session.events[0]?.timestamp ?? Date.now();
    const endTime =
      params.session.events[params.session.events.length - 1]?.timestamp ??
      Date.now();

    const rewoundEvent = createCompactedEvent({
      author: this.name,
      invocationId:
        params.invocationId ??
        params.session.events[params.session.events.length - 1]?.invocationId ??
        `rewind-${Date.now()}`,
      startTime,
      endTime,
      compactedContent: toContent({
        rewoundToNodePath: params.targetNodePath,
        targetRunId: params.targetRunId,
        reason: params.reason,
        restoredOutput: prior?.output,
      }),
      compactedEventIds: params.session.events.map((e) => e.id),
      checkpointManifest: manifest,
      nodeInfo: {
        path: params.targetNodePath,
        runId: params.targetRunId,
      },
      output: prior?.output,
      actions: createEventActions({
        stateDelta: params.compensatingStateDelta ?? {},
        agentState: {
          rewoundToNodePath: params.targetNodePath,
          targetRunId: params.targetRunId,
          restoredInput: prior?.input,
          restoredOutput: prior?.output,
          reason: params.reason,
        },
      }),
    });
    params.session.events.push(rewoundEvent);

    let auditBlock: AuditBlock | undefined;
    if (ledger) {
      auditBlock = ledger.appendBlock(
        this.name,
        'WORKFLOW_CHECKPOINT_REWIND',
        params.operatorDid ?? params.actorDid ?? 'system:checkpoint-rewinder',
        {
          workflowId: this.name,
          topologyHash: this.topologyHash,
          targetNodePath: params.targetNodePath,
          targetRunId: params.targetRunId,
          reason: params.reason,
          rewoundEventId: rewoundEvent.id,
          compensatingKeys: Object.keys(params.compensatingStateDelta ?? {}),
        }
      );
    }

    return Object.assign(rewoundEvent, {
      rewoundEvent,
      restoredOutput: prior?.output,
      restoredInput: prior?.input,
      auditBlock,
    });
  }
}

export { StaleGenerationFenceError };
