/**
 * Declarative DAG Playbook Workflow Engine & Runner (RFC-0016 / ADR-0041)
 *
 * Implements content-addressed workflows, step sequencing, and automatic
 * fail-closed parking on unapproved ApprovalGate steps.
 */

import { sha256Sync } from '../crypto-compat.js';
import { ApprovalGate } from '../approvals/approval_engine.js';

export type StepType = 'agent_task' | 'approval_gate' | 'tool';

export interface PlaybookStep {
  id: string;
  kind: StepType;
  agent?: string;
  instruction?: string;
  summary?: string;
  tool?: string;
}

export interface Playbook {
  playbook_id: string;
  name: string;
  version: string;
  trigger: string;
  steps: PlaybookStep[];
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
}
