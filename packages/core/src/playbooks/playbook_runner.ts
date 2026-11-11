/**
 * Declarative DAG Playbook Workflow Engine & Runner (RFC-0016 / ADR-0041)
 *
 * Implements content-addressed workflows, step sequencing, and automatic
 * fail-closed parking on unapproved ApprovalGate steps.
 */

import { sha256Sync } from '../crypto-compat.js';
import { ApprovalGate, ConsentChallengeStore } from '../approvals/approval_engine.js';
import {
  createGraphFromEdgeItems,
  EdgeItem,
  Graph,
} from '../workflow/graph.js';
import { FunctionNode } from '../workflow/nodes/function_node.js';
import {
  Atlas2GraphWorkflow,
  Atlas2GraphWorkflowConfig,
} from '../workflow/nodes/hyperfused_nodes.js';
import { createEvent } from '../workflow/shims.js';
import { RequestInput } from '../workflow/request_input.js';

export type StepType = 'agent_task' | 'approval_gate' | 'tool';

export interface PlaybookStep {
  id: string;
  kind: StepType;
  agent?: string;
  instruction?: string;
  summary?: string;
  tool?: string;
  /** Optional route key emitted by this step when used in a conditional graph playbook. */
  route?: string;
}

export interface Playbook {
  playbook_id: string;
  name: string;
  version: string;
  trigger: string;
  steps: PlaybookStep[];
  /**
   * Optional ADK 2.0 declarative graph edges (`EdgeItem[]`). When omitted,
   * `PlaybookRun` compiles `steps` into a linear `[['START', step1, step2, ...]]` graph.
   */
  edges?: EdgeItem[];
}

export type RunStatus = 'running' | 'awaiting_approval' | 'completed' | 'failed';

export function composePlaybookBytes(
  name: string,
  version: string,
  trigger: string,
  steps: PlaybookStep[]
): string {
  let out = 'agentbbs.playbook.v1\n';
  for (const part of [name, version, trigger]) {
    out += `${Buffer.byteLength(part, 'utf8')}:${part}\n`;
  }
  for (const s of steps) {
    let tag = '';
    if (s.kind === 'agent_task') {
      tag = `agent_task\x1f${s.agent ?? ''}\x1f${s.instruction ?? ''}`;
    } else if (s.kind === 'approval_gate') {
      tag = `approval_gate\x1f${s.summary ?? ''}`;
    } else if (s.kind === 'tool') {
      tag = `tool\x1f${s.tool ?? ''}`;
    }

    out += `${Buffer.byteLength(s.id, 'utf8')}:${s.id}\x1f`;
    out += `${Buffer.byteLength(tag, 'utf8')}:${tag}\n`;
  }
  return out;
}

export function computePlaybookId(
  name: string,
  version: string,
  trigger: string,
  steps: PlaybookStep[]
): string {
  const bytes = composePlaybookBytes(name, version, trigger, steps);
  return sha256Sync(bytes);
}

export class PlaybookRun {
  private readonly playbook: Playbook;
  private cursor: number = 0;
  private currentStatus: RunStatus = 'running';

  constructor(playbook: Playbook) {
    PlaybookRun.validate(playbook);
    this.playbook = playbook;
  }

  public static start(playbook: Playbook): PlaybookRun {
    return new PlaybookRun(playbook);
  }

  public static validate(playbook: Playbook): void {
    if (!playbook.name || !playbook.name.trim()) {
      throw new Error('Playbook name is required');
    }
    if (!playbook.version || !playbook.version.trim()) {
      throw new Error('Playbook version is required');
    }
    if (!playbook.steps || playbook.steps.length === 0) {
      throw new Error('Playbook requires at least one step');
    }

    const seenIds = new Set<string>();
    for (const step of playbook.steps) {
      if (!step.id || !step.id.trim()) {
        throw new Error('Playbook step id cannot be empty');
      }
      if (seenIds.has(step.id)) {
        throw new Error(`Duplicate step id in playbook: ${step.id}`);
      }
      seenIds.add(step.id);

      if (step.kind === 'agent_task' && (!step.agent || !step.instruction)) {
        throw new Error(`AgentTask step ${step.id} requires agent and instruction`);
      }
      if (step.kind === 'approval_gate' && !step.summary) {
        throw new Error(`ApprovalGate step ${step.id} requires summary`);
      }
      if (step.kind === 'tool' && !step.tool) {
        throw new Error(`Tool step ${step.id} requires tool name`);
      }
    }
  }

  public status(): RunStatus {
    return this.currentStatus;
  }

  public currentStep(): PlaybookStep | undefined {
    return this.playbook.steps[this.cursor];
  }

  public stepsCompleted(): number {
    return this.cursor;
  }

  public totalSteps(): number {
    return this.playbook.steps.length;
  }

  /**
   * Deterministic gate action id for human sign-off on current ApprovalGate step.
   */
  public gateActionId(): string | undefined {
    const step = this.currentStep();
    if (!step || step.kind !== 'approval_gate') {
      return undefined;
    }
    return `playbook:${this.playbook.playbook_id}:${step.id}`;
  }

  /**
   * Advances the run by one step.
   *
   * If the current step is an ApprovalGate, it only advances if the gate
   * has authorized the action. Otherwise it parks in 'awaiting_approval'.
   */
  public advance(gate?: ApprovalGate): RunStatus {
    if (this.currentStatus === 'completed' || this.currentStatus === 'failed') {
      return this.currentStatus;
    }

    const step = this.currentStep();
    if (!step) {
      this.currentStatus = 'completed';
      return this.currentStatus;
    }

    if (step.kind === 'approval_gate') {
      const aid = this.gateActionId()!;
      if (!gate || !gate.isAuthorized(aid)) {
        this.currentStatus = 'awaiting_approval';
        return this.currentStatus;
      }
    }

    this.cursor++;
    if (this.cursor >= this.playbook.steps.length) {
      this.currentStatus = 'completed';
    } else {
      this.currentStatus = 'running';
    }

    return this.currentStatus;
  }

  /**
   * Compiles this Playbook into an ADK 2.0 {@link Graph}, either from explicit
   * `playbook.edges` or by lifting sequential `playbook.steps` into a linear
   * `[['START', ...stepNodes]]` chain.
   */
  public compileGraph(gate?: ApprovalGate): Graph {
    if (this.playbook.edges && this.playbook.edges.length > 0) {
      return createGraphFromEdgeItems(this.playbook.edges);
    }
    const stepNodes = this.playbook.steps.map((step) =>
      this.buildStepNode(step, gate)
    );
    return createGraphFromEdgeItems([['START', ...stepNodes]]);
  }

  /**
   * Lifts this Playbook into an executable {@link Atlas2GraphWorkflow}.
   */
  public toWorkflow(options?: {
    gate?: ApprovalGate;
    wal?: DurableCommandWal;
    challengeStore?: ConsentChallengeStore;
    maxConcurrency?: number;
  }): Atlas2GraphWorkflow {
    const edges: EdgeItem[] =
      this.playbook.edges && this.playbook.edges.length > 0
        ? this.playbook.edges
        : [
            [
              'START',
              ...this.playbook.steps.map((step) =>
                this.buildStepNode(step, options?.gate)
              ),
            ],
          ];
    const config: Atlas2GraphWorkflowConfig = {
      name: this.playbook.name,
      description: `Playbook ${this.playbook.name}@${this.playbook.version} (${this.playbook.playbook_id})`,
      edges,
      maxConcurrency: options?.maxConcurrency,
      approvalGate: options?.gate,
      wal: options?.wal,
      challengeStore: options?.challengeStore,
    };
    return new Atlas2GraphWorkflow(config);
  }

  private buildStepNode(step: PlaybookStep, gate?: ApprovalGate): FunctionNode {
    const playbookId = this.playbook.playbook_id;
    return new FunctionNode(
      step.id,
      async (ctx, input) => {
        if (step.kind === 'approval_gate') {
          const aid = `playbook:${playbookId}:${step.id}`;
          if (!gate || !gate.isAuthorized(aid)) {
            return new RequestInput({
              interruptId: aid,
              message: step.summary ?? `Approval required for step ${step.id}`,
              payload: { action_id: aid, step_id: step.id },
            });
          }
        }
        const out = {
          step_id: step.id,
          kind: step.kind,
          agent: step.agent,
          tool: step.tool,
          input,
          completed: true,
        };
        return createEvent({
          author: step.id,
          invocationId: ctx.invocationId,
          branch: ctx.branch,
          output: out,
          route: step.route,
        });
      },
      {
        sideEffecting: step.kind === 'tool',
      }
    );
  }
}

/**
 * Extension 3 & Experiment 5: Side-Effect Aware Durable Command WAL & Recovery Reconciler.
 *
 * Distinguishes PLANNED, DISPATCHED, EXTERNALLY_ACKNOWLEDGED, RECONCILED, and OUTCOME_UNKNOWN
 * side effects. Pre-persists DISPATCHED state before network invocation and reconciles existing
 * external outcomes after a crash before issuing any duplicate request.
 */
export type SideEffectLifecycleState =
  | 'PLANNED'
  | 'DISPATCHED'
  | 'EXTERNALLY_ACKNOWLEDGED'
  | 'RECONCILED'
  | 'OUTCOME_UNKNOWN';

export type SideEffectActionKind =
  | 'cloud_provision'
  | 'payment_charge'
  | 'git_push'
  | 'db_mutate'
  | 'generic_tool';

export interface DurableCommandRecord<TResult = unknown> {
  command_id: string;
  idempotency_key: string;
  run_id: string;
  step_id: string;
  tool_name: string;
  action_kind?: SideEffectActionKind;
  canonical_args: string;
  state: SideEffectLifecycleState;
  external_resource_id?: string;
  result?: TResult;
  probe_attempts?: number;
  probe_error?: string;
  updated_at: string;
}

export interface ExternalReconciliationProbeResult<TResult = unknown> {
  exists: boolean;
  externalResourceId?: string;
  result?: TResult;
  outcomeUnknown?: boolean;
}

export class DurableCommandWal<TResult = unknown> {
  private readonly records = new Map<string, DurableCommandRecord<TResult>>();

  public static computeIdempotencyKey(
    runId: string,
    stepId: string,
    toolName: string,
    canonicalArgs: string
  ): string {
    return sha256Sync(`acr.durable.cmd.v1:${runId}:${stepId}:${toolName}:${canonicalArgs}`);
  }

  public planCommand(params: {
    commandId: string;
    runId: string;
    stepId: string;
    toolName: string;
    actionKind?: SideEffectActionKind;
    canonicalArgs: string;
    nowMs?: number;
  }): DurableCommandRecord<TResult> {
    const existing = this.records.get(params.commandId);
    if (existing) {
      return { ...existing };
    }
    const idempotencyKey = DurableCommandWal.computeIdempotencyKey(
      params.runId,
      params.stepId,
      params.toolName,
      params.canonicalArgs
    );
    const rec: DurableCommandRecord<TResult> = {
      command_id: params.commandId,
      idempotency_key: idempotencyKey,
      run_id: params.runId,
      step_id: params.stepId,
      tool_name: params.toolName,
      action_kind: params.actionKind ?? 'generic_tool',
      canonical_args: params.canonicalArgs,
      state: 'PLANNED',
      probe_attempts: 0,
      updated_at: new Date(params.nowMs ?? Date.now()).toISOString(),
    };
    this.records.set(params.commandId, rec);
    return { ...rec };
  }

  public markDispatched(commandId: string, nowMs = Date.now()): DurableCommandRecord<TResult> {
    const rec = this.records.get(commandId);
    if (!rec) {
      throw new Error(`Durable command ${commandId} not found in WAL`);
    }
    rec.state = 'DISPATCHED';
    rec.updated_at = new Date(nowMs).toISOString();
    return { ...rec };
  }

  public markExternallyAcknowledged(
    commandId: string,
    externalResourceId: string,
    result: TResult,
    nowMs = Date.now()
  ): DurableCommandRecord<TResult> {
    const rec = this.records.get(commandId);
    if (!rec) {
      throw new Error(`Durable command ${commandId} not found in WAL`);
    }
    rec.state = 'EXTERNALLY_ACKNOWLEDGED';
    rec.external_resource_id = externalResourceId;
    rec.result = result;
    rec.updated_at = new Date(nowMs).toISOString();
    return { ...rec };
  }

  public markReconciled(
    commandId: string,
    externalResourceId: string,
    result: TResult,
    nowMs = Date.now()
  ): DurableCommandRecord<TResult> {
    const rec = this.records.get(commandId);
    if (!rec) {
      throw new Error(`Durable command ${commandId} not found in WAL`);
    }
    rec.state = 'RECONCILED';
    rec.external_resource_id = externalResourceId;
    rec.result = result;
    rec.updated_at = new Date(nowMs).toISOString();
    return { ...rec };
  }

  public getRecord(commandId: string): DurableCommandRecord<TResult> | undefined {
    const rec = this.records.get(commandId);
    return rec ? { ...rec } : undefined;
  }

  public getRecords(): DurableCommandRecord<TResult>[] {
    return Array.from(this.records.values(), (r) => ({ ...r }));
  }

  public findDispatchedOrUnknownRecord(filter: {
    commandId?: string;
    toolName?: string;
    runId?: string;
    stepId?: string;
  }): DurableCommandRecord<TResult> | undefined {
    if (filter.commandId) {
      const exact = this.records.get(filter.commandId);
      if (
        exact &&
        (exact.state === 'DISPATCHED' ||
          exact.state === 'OUTCOME_UNKNOWN' ||
          exact.state === 'EXTERNALLY_ACKNOWLEDGED' ||
          exact.state === 'RECONCILED')
      ) {
        return { ...exact };
      }
    }
    for (const rec of this.records.values()) {
      if (
        rec.state !== 'DISPATCHED' &&
        rec.state !== 'OUTCOME_UNKNOWN' &&
        rec.state !== 'EXTERNALLY_ACKNOWLEDGED' &&
        rec.state !== 'RECONCILED'
      ) {
        continue;
      }
      if (filter.toolName && rec.tool_name !== filter.toolName) {
        continue;
      }
      if (filter.runId && rec.run_id !== filter.runId) {
        continue;
      }
      if (filter.stepId && rec.step_id !== filter.stepId) {
        continue;
      }
      return { ...rec };
    }
    return undefined;
  }

  /**
   * Executes a side-effecting command with pre-dispatch WAL persistence and crash recovery reconciliation.
   * Implements probe timeout fault containment (transitioning to OUTCOME_UNKNOWN without re-dispatching)
   * and multi-probe retry window to survive eventual-consistency read-replica lag (Challenge E5 / Ext 3).
   */
  public async executeOrReconcile(params: {
    commandId: string;
    runId: string;
    stepId: string;
    toolName: string;
    actionKind?: SideEffectActionKind;
    canonicalArgs: string;
    dispatchFn: (idempotencyKey: string) => Promise<{ externalResourceId: string; result: TResult }>;
    reconcileProbeFn: (idempotencyKey: string, attempt: number) => Promise<ExternalReconciliationProbeResult<TResult>>;
    simulateCrashBeforeCheckpoint?: boolean;
    probeMaxAttempts?: number;
    probeRetryDelayMs?: number;
    allowRedispatchAfterExhaustedProbes?: boolean;
    nowMs?: number;
  }): Promise<{
    record: DurableCommandRecord<TResult>;
    reconciledAfterCrash: boolean;
  }> {
    const nowMs = params.nowMs ?? Date.now();
    let rec = this.records.get(params.commandId);

    if (rec && (rec.state === 'EXTERNALLY_ACKNOWLEDGED' || rec.state === 'RECONCILED')) {
      return { record: { ...rec }, reconciledAfterCrash: false };
    }

    if (rec && (rec.state === 'DISPATCHED' || rec.state === 'OUTCOME_UNKNOWN')) {
      // Command was previously dispatched before a worker crash!
      // Reconcile against external system with retry window before issuing any creation request.
      const maxAttempts = Math.max(1, params.probeMaxAttempts ?? 3);
      const retryDelayMs = Math.max(0, params.probeRetryDelayMs ?? 5);

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        rec.probe_attempts = (rec.probe_attempts ?? 0) + 1;
        let probe: ExternalReconciliationProbeResult<TResult>;
        try {
          probe = await params.reconcileProbeFn(rec.idempotency_key, attempt);
        } catch (probeErr: any) {
          // Probe timeout (504 / ETIMEDOUT) -> NEVER blind re-dispatch POST! Park in OUTCOME_UNKNOWN.
          rec.state = 'OUTCOME_UNKNOWN';
          rec.probe_error = probeErr?.message || String(probeErr);
          rec.updated_at = new Date(nowMs).toISOString();
          return { record: { ...rec }, reconciledAfterCrash: false };
        }

        if (probe.exists && probe.externalResourceId !== undefined) {
          const reconciled = this.markReconciled(
            params.commandId,
            probe.externalResourceId,
            probe.result as TResult,
            nowMs
          );
          return { record: reconciled, reconciledAfterCrash: true };
        }

        if (probe.outcomeUnknown) {
          rec.state = 'OUTCOME_UNKNOWN';
          rec.updated_at = new Date(nowMs).toISOString();
          return { record: { ...rec }, reconciledAfterCrash: false };
        }

        if (attempt < maxAttempts && retryDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        }
      }

      if (!params.allowRedispatchAfterExhaustedProbes) {
        rec.state = 'OUTCOME_UNKNOWN';
        rec.probe_error = 'RECONCILIATION_WINDOW_EXHAUSTED_NOT_FOUND';
        rec.updated_at = new Date(nowMs).toISOString();
        return { record: { ...rec }, reconciledAfterCrash: false };
      }
    }

    if (!rec) {
      this.planCommand({
        commandId: params.commandId,
        runId: params.runId,
        stepId: params.stepId,
        toolName: params.toolName,
        actionKind: params.actionKind,
        canonicalArgs: params.canonicalArgs,
        nowMs,
      });
    }

    // Persist DISPATCHED intent to WAL *before* executing side effect
    const dispatched = this.markDispatched(params.commandId, nowMs);
    const outcome = await params.dispatchFn(dispatched.idempotency_key);

    if (params.simulateCrashBeforeCheckpoint) {
      throw new Error('SIMULATED_WORKER_CRASH_AFTER_EXTERNAL_COMPLETION_BEFORE_CHECKPOINT');
    }

    const acked = this.markExternallyAcknowledged(
      params.commandId,
      outcome.externalResourceId,
      outcome.result,
      nowMs
    );
    return { record: acked, reconciledAfterCrash: false };
  }
}


