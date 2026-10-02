import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  RetortAnovaEngine,
  RetortCell,
  dominates,
  nondominatedTiers,
  rankStacks,
  ApprovalGate,
  computeActionId,
  SignedDecision,
  DecisionLog,
  computeDecisionId,
  Playbook,
  PlaybookRun,
  computePlaybookId
} from '../src/index.js';

describe('Retort DoE Multi-Way ANOVA & Honest Scoring', () => {
  it('excludes tooling false-fails from variance analysis', () => {
    const cells: RetortCell[] = [
      { model: 'claude-3-7', harness_config: 'toolcall-v1', task: 't1', requirement_coverage: 0.95, cost_usd: 0.08, latency_ms: 1200, diagnosis: 'pass' },
      { model: 'claude-3-7', harness_config: 'toolcall-v2', task: 't1', requirement_coverage: 0.90, cost_usd: 0.07, latency_ms: 1100, diagnosis: 'pass' },
      { model: 'gpt-4o', harness_config: 'toolcall-v1', task: 't1', requirement_coverage: 0.70, cost_usd: 0.05, latency_ms: 900, diagnosis: 'genuine' },
      { model: 'gpt-4o', harness_config: 'toolcall-v2', task: 't1', requirement_coverage: 0.65, cost_usd: 0.04, latency_ms: 850, diagnosis: 'genuine' },
      // Tooling false-fail: harness truncated patch
      { model: 'claude-3-7', harness_config: 'toolcall-v1', task: 't2', requirement_coverage: 0.10, cost_usd: 0.08, latency_ms: 500, diagnosis: 'tooling' },
    ];

    const result = RetortAnovaEngine.compute(cells, 'requirement_coverage', ['model', 'harness_config']);

    assert.strictEqual(result.cells_excluded_tooling, 1, 'Exactly 1 tooling cell must be excluded');
    assert.strictEqual(result.cells_analyzed, 4, 'Exactly 4 cells analyzed');
    assert.ok(result.ss_total > 0, 'Total sum of squares must be positive');
    assert.strictEqual(result.factors.length, 2);

    const modelFactor = result.factors.find((f) => f.factor === 'model');
    assert.ok(modelFactor, 'Model factor must be present');
    assert.ok(modelFactor.eta_squared > 0.5, 'Model explains the majority of variance');
  });

  it('handles zero variance edge cases gracefully', () => {
    const identicalCells: RetortCell[] = [
      { model: 'm1', harness_config: 'h1', task: 't1', requirement_coverage: 1.0, cost_usd: 0.05, latency_ms: 100, diagnosis: 'pass' },
      { model: 'm1', harness_config: 'h1', task: 't2', requirement_coverage: 1.0, cost_usd: 0.05, latency_ms: 100, diagnosis: 'pass' },
    ];

    const res = RetortAnovaEngine.compute(identicalCells);
    assert.strictEqual(res.ss_total, 0);
    assert.strictEqual(res.cells_excluded_tooling, 0);
  });
});

describe('Pareto-Frontier Dominance Optimizer (NSGA-II)', () => {
  it('correctly assesses dominance between points', () => {
    // a is cheaper and higher coverage than b
    const a = { coverage: 0.95, cost: 0.05 };
    const b = { coverage: 0.80, cost: 0.10 };
    assert.strictEqual(dominates(a, b), true);
    assert.strictEqual(dominates(b, a), false);

    // trade-off: higher coverage but higher cost
    const c = { coverage: 0.99, cost: 0.20 };
    assert.strictEqual(dominates(a, c), false);
    assert.strictEqual(dominates(c, a), false);
  });

  it('computes non-dominated sorting tiers and ranks stacks', () => {
    const stacks = [
      { id: 'stack-1', coverage: 0.95, cost: 0.08 },  // Tier 1 (Frontier)
      { id: 'stack-2', coverage: 0.94, cost: 0.50 },  // Dominated by stack-1 -> Tier 2
      { id: 'stack-3', coverage: 0.85, cost: 0.04 },  // Tier 1 (Frontier: cheaper trade-off)
      { id: 'stack-4', coverage: 0.60, cost: 0.01 },  // Tier 1 (Frontier: cheapest)
      { id: 'stack-5', coverage: 0.50, cost: 0.02 },  // Dominated by stack-4 -> Tier 2
    ];

    const tiers = nondominatedTiers(stacks);
    assert.deepStrictEqual(tiers, [1, 2, 1, 1, 2]);

    const ranked = rankStacks(stacks);
    assert.strictEqual(ranked[0].isFrontier, true);
    assert.strictEqual(ranked[1].isFrontier, false);
    assert.strictEqual(ranked[2].isFrontier, true);
  });
});

describe('Cryptographic Human Approval Gates & Decision Ledger', () => {
  it('enforces fail-closed veto: any rejection overrules approvals', () => {
    const gate = new ApprovalGate(['did:key:alice', 'did:key:bob']);
    const aid = computeActionId('deploy', 'Deploy canary v2', 'did:key:agent1', 'ops-main', '2026-10-01T12:00:00Z');

    assert.strictEqual(gate.evaluate(aid), 'pending');

    // Alice approves
    gate.submitDecision({
      action_id: aid,
      verdict: 'approve',
      reason: 'Canary looks clean',
      decider: 'did:key:alice',
      decided_at: '2026-10-01T12:05:00Z'
    });
    assert.strictEqual(gate.evaluate(aid), 'authorized');
    assert.strictEqual(gate.isAuthorized(aid), true);

    // Bob vetos -> immediate fail-closed rejection
    gate.submitDecision({
      action_id: aid,
      verdict: 'reject',
      reason: 'Memory leak detected in staging',
      decider: 'did:key:bob',
      decided_at: '2026-10-01T12:06:00Z'
    });
    assert.strictEqual(gate.evaluate(aid), 'rejected');
    assert.strictEqual(gate.isAuthorized(aid), false);
  });

  it('rejects decisions from unauthorized deciders', () => {
    const gate = new ApprovalGate(['did:key:alice']);
    const aid = 'action_123';

    gate.submitDecision({
      action_id: aid,
      verdict: 'approve',
      reason: 'Attacker approval',
      decider: 'did:key:malicious',
      decided_at: '2026-10-01T12:00:00Z'
    });

    assert.strictEqual(gate.evaluate(aid), 'pending');
  });

  it('indexes verified decision records in DecisionLog', () => {
    const log = new DecisionLog();
    const title = 'Adopt Atlas 2.0';
    const decision = 'Approve DAG migration';
    const rationale = '10x fewer loops, deterministic BFT quorum';
    const board = 'governance';
    const decider = 'did:key:alice';
    const decidedAt = '2026-10-01T12:00:00Z';

    const id = computeDecisionId(title, decision, rationale, board, decider, decidedAt);
    const appended = log.append({
      id,
      title,
      decision,
      rationale,
      board,
      decided_by: decider,
      decided_at: decidedAt
    });

    assert.strictEqual(appended, true);
    assert.strictEqual(log.count(), 1);

    // Tampered id rejected
    const tampered = log.append({
      id: 'fake_id',
      title,
      decision,
      rationale,
      board,
      decided_by: decider,
      decided_at: decidedAt
    });
    assert.strictEqual(tampered, false);
  });
});

describe('Declarative DAG Playbook Engine & Runner', () => {
  it('parks on ApprovalGate step with fail-closed semantics until authorized', () => {
    const steps = [
      { id: 's1', kind: 'agent_task' as const, agent: 'sre-agent', instruction: 'Collect diagnostic logs' },
      { id: 's2', kind: 'approval_gate' as const, summary: 'Authorize traffic rerouting to backup cluster' },
      { id: 's3', kind: 'tool' as const, tool: 'traffic_switch' }
    ];

    const playbook: Playbook = {
      playbook_id: computePlaybookId('Incident Failover', '1.0', 'sev1_incident', steps),
      name: 'Incident Failover',
      version: '1.0',
      trigger: 'sev1_incident',
      steps
    };

    const run = PlaybookRun.start(playbook);
    assert.strictEqual(run.status(), 'running');
    assert.strictEqual(run.stepsCompleted(), 0);

    // Step 1: AgentTask advances
    run.advance();
    assert.strictEqual(run.stepsCompleted(), 1);
    assert.strictEqual(run.currentStep()?.id, 's2');

    // Step 2: ApprovalGate without authorization -> parks in awaiting_approval!
    const gate = new ApprovalGate(['did:key:commander']);
    run.advance(gate);
    assert.strictEqual(run.status(), 'awaiting_approval');
    assert.strictEqual(run.stepsCompleted(), 1); // Cursor did not advance

    // Sign off on the gate
    const gateAid = run.gateActionId()!;
    assert.strictEqual(gateAid, `playbook:${playbook.playbook_id}:s2`);

    gate.submitDecision({
      action_id: gateAid,
      verdict: 'approve',
      reason: 'Rerouting authorized by commander',
      decider: 'did:key:commander',
      decided_at: '2026-10-01T12:10:00Z'
    });

    // Advance again -> now advances through gate to s3
    run.advance(gate);
    assert.strictEqual(run.stepsCompleted(), 2);
    assert.strictEqual(run.currentStep()?.id, 's3');
    assert.strictEqual(run.status(), 'running');

    // Step 3: Tool advances to completed
    run.advance();
    assert.strictEqual(run.stepsCompleted(), 3);
    assert.strictEqual(run.status(), 'completed');
  });
});
