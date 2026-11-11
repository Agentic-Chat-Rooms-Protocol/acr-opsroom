import crypto from 'node:crypto';
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  RetortAnovaEngine,
  RetortCell,
  dominates,
  nondominatedTiers,
  rankStacks,
  PolicyGuardrail,
  rankCompliantStacks,
  ApprovalGate,
  computeActionId,
  SignedDecision,
  ConsentChallengeStore,
  computeRequestCanonicalHash,
  signPasskeyConsentEnvelope,
  DecisionLog,
  computeDecisionId,
  Playbook,
  PlaybookRun,
  computePlaybookId,
  DurableCommandWal,
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

  it('Experiment 9 (Optimization Workflow Policy Guardrail): rejects higher-scoring candidate that violates policy', () => {
    const candidates = [
      {
        id: 'compliant-baseline',
        coverage: 0.84,
        cost: 0.09,
        max_concurrency: 8,
        require_auth_verification: true,
        max_spend_per_run_usd: 2.5,
        workspace_path: '/data/workspace/project-a',
      },
      {
        id: 'rogue-high-score-no-auth',
        coverage: 0.99, // Higher optimization score
        cost: 0.02,     // Lower cost
        max_concurrency: 8,
        require_auth_verification: false, // Policy violation!
        max_spend_per_run_usd: 2.0,
        workspace_path: '/data/workspace/project-a',
      },
      {
        id: 'rogue-path-escape-and-concurrency',
        coverage: 0.98,
        cost: 0.03,
        max_concurrency: 64, // Exceeds cap of 10!
        require_auth_verification: true,
        max_spend_per_run_usd: 25.0, // Exceeds cap of $5.00!
        workspace_path: '/data/workspace/../etc/shadow', // Path traversal!
      },
    ];

    const { compliantRanked, rejectedCandidates } = rankCompliantStacks(candidates);
    assert.strictEqual(rejectedCandidates.length, 2);
    assert.strictEqual(rejectedCandidates[0].candidate.id, 'rogue-high-score-no-auth');
    assert.ok(rejectedCandidates[0].violations.includes('POLICY_VIOLATION_AUTH_VERIFICATION_DISABLED'));

    assert.strictEqual(compliantRanked.length, 1);
    assert.strictEqual(compliantRanked[0].item.id, 'compliant-baseline');
    assert.strictEqual(compliantRanked[0].isFrontier, true);
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

  it('Experiment 6 (Passkey Approval Scope Binding): rejects consent envelope when requested resource, version, or policy changes', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const operatorDid = 'did:key:z6MkOperatorAlice';
    const gate = new ApprovalGate([operatorDid]);
    const challengeStore = new ConsentChallengeStore();

    const t0 = 1_700_000_000_000;
    const nonce = challengeStore.issueChallenge(operatorDid, 60_000, t0);

    const originalReqHash = computeRequestCanonicalHash({
      action_type: 'git.branch.delete',
      target_resource_uri: 'acr://repo/acr-core/branch/feature-temp',
      resource_version: 'rev-10',
      policy_revision: 'pol-2026-11',
      parameters: { force: false },
    });

    const signedConsent = signPasskeyConsentEnvelope(
      {
        consent_id: 'consent-001',
        operator_did: operatorDid,
        authenticator_id: 'webauthn-yubikey-01',
        challenge_nonce: nonce,
        request_canonical_hash: originalReqHash,
        action_type: 'git.branch.delete',
        target_resource_uri: 'acr://repo/acr-core/branch/feature-temp',
        resource_version: 'rev-10',
        policy_revision: 'pol-2026-11',
        issued_at: t0,
        expires_at: t0 + 60_000,
        max_invocations: 1,
      },
      privateKey
    );

    const actionId = 'action-delete-branch';
    const decision: SignedDecision = {
      action_id: actionId,
      verdict: 'approve',
      reason: 'Approved via passkey',
      decider: operatorDid,
      decided_at: new Date(t0).toISOString(),
    };

    // Mutate target resource after authentication ('feature-temp' -> 'main') -> MUST REJECT AND BURN CHALLENGE
    assert.throws(
      () => {
        gate.submitDecisionWithConsent({
          decision,
          envelope: signedConsent,
          expected: {
            request_canonical_hash: originalReqHash,
            action_type: 'git.branch.delete',
            target_resource_uri: 'acr://repo/acr-core/branch/main', // Changed resource!
            resource_version: 'rev-10',
            policy_revision: 'pol-2026-11',
          },
          publicKey,
          challengeStore,
          nowMs: t0 + 1000,
        });
      },
      /CONSENT_SCOPE_MISMATCH: target_resource_uri/
    );
    assert.strictEqual(gate.isAuthorized(actionId), false);

    // Attempting to reuse the same consent envelope even with original target fails because challenge was atomically burned!
    assert.throws(
      () => {
        gate.submitDecisionWithConsent({
          decision,
          envelope: signedConsent,
          expected: {
            request_canonical_hash: originalReqHash,
            action_type: 'git.branch.delete',
            target_resource_uri: 'acr://repo/acr-core/branch/feature-temp',
            resource_version: 'rev-10',
            policy_revision: 'pol-2026-11',
          },
          publicKey,
          challengeStore,
          nowMs: t0 + 2000,
        });
      },
      /challenge_nonce invalid, expired, or already consumed/
    );

    // Issue fresh challenge and sign for exact matching context -> SUCCEEDS once, then blocks second invocation
    const nonce2 = challengeStore.issueChallenge(operatorDid, 60_000, t0 + 3000);
    const validConsent = signPasskeyConsentEnvelope(
      {
        ...signedConsent,
        consent_id: 'consent-002',
        challenge_nonce: nonce2,
      },
      privateKey
    );

    gate.submitDecisionWithConsent({
      decision,
      envelope: validConsent,
      expected: {
        request_canonical_hash: originalReqHash,
        action_type: 'git.branch.delete',
        target_resource_uri: 'acr://repo/acr-core/branch/feature-temp',
        resource_version: 'rev-10',
        policy_revision: 'pol-2026-11',
      },
      publicKey,
      challengeStore,
      nowMs: t0 + 4000,
    });
    assert.strictEqual(gate.isAuthorized(actionId), true);

    // Exceeding max_invocations (1) is rejected
    assert.throws(
      () => {
        gate.submitDecisionWithConsent({
          decision,
          envelope: validConsent,
          expected: {
            request_canonical_hash: originalReqHash,
            action_type: 'git.branch.delete',
            target_resource_uri: 'acr://repo/acr-core/branch/feature-temp',
            resource_version: 'rev-10',
            policy_revision: 'pol-2026-11',
          },
          publicKey,
          challengeStore,
          nowMs: t0 + 5000,
        });
      },
      /max_invocations exceeded/
    );
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

  it('Experiment 5 (Durable Execution Side-Effect Recovery): reconciles existing external PR after crash without duplicating creation', async () => {
    const wal = new DurableCommandWal<{ prNumber: number; url: string }>();

    // Simulated external GitHub server tracking POST /pulls calls
    let postCount = 0;
    const externalCreatedPrs = new Map<string, { prNumber: number; url: string }>();

    const dispatchCreatePr = async (idempotencyKey: string) => {
      postCount += 1;
      const created = { prNumber: 42, url: 'https://github.com/org/repo/pull/42' };
      externalCreatedPrs.set(idempotencyKey, created);
      return {
        externalResourceId: 'pr:42',
        result: created,
      };
    };

    const reconcilePrProbe = async (idempotencyKey: string) => {
      const found = externalCreatedPrs.get(idempotencyKey);
      if (found) {
        return {
          exists: true,
          externalResourceId: `pr:${found.prNumber}`,
          result: found,
        };
      }
      return { exists: false };
    };

    // 1. Worker dispatches PR creation; external GitHub server creates PR #42, then worker crashes BEFORE checkpointing!
    await assert.rejects(
      async () => {
        await wal.executeOrReconcile({
          commandId: 'cmd-create-pr-42',
          runId: 'run-101',
          stepId: 'step-open-pr',
          toolName: 'github.create_pull_request',
          canonicalArgs: JSON.stringify({ head: 'feat/hyperfusion', base: 'main', title: 'Hyperfusion' }),
          dispatchFn: dispatchCreatePr,
          reconcileProbeFn: reconcilePrProbe,
          simulateCrashBeforeCheckpoint: true,
        });
      },
      /SIMULATED_WORKER_CRASH_AFTER_EXTERNAL_COMPLETION_BEFORE_CHECKPOINT/
    );

    // Verify WAL recorded DISPATCHED before the crash and external side effect happened once
    assert.strictEqual(wal.getRecord('cmd-create-pr-42')?.state, 'DISPATCHED');
    assert.strictEqual(postCount, 1);

    // 2. Recovery worker resumes the interrupted command -> reconciles PR #42 via probe WITHOUT calling dispatchCreatePr again!
    const recovered = await wal.executeOrReconcile({
      commandId: 'cmd-create-pr-42',
      runId: 'run-101',
      stepId: 'step-open-pr',
      toolName: 'github.create_pull_request',
      canonicalArgs: JSON.stringify({ head: 'feat/hyperfusion', base: 'main', title: 'Hyperfusion' }),
      dispatchFn: dispatchCreatePr,
      reconcileProbeFn: reconcilePrProbe,
      simulateCrashBeforeCheckpoint: false,
    });

    assert.strictEqual(recovered.reconciledAfterCrash, true);
    assert.strictEqual(recovered.record.state, 'RECONCILED');
    assert.strictEqual(recovered.record.external_resource_id, 'pr:42');
    assert.deepStrictEqual(recovered.record.result, { prNumber: 42, url: 'https://github.com/org/repo/pull/42' });
    assert.strictEqual(postCount, 1, 'External PR creation MUST NOT be duplicated on recovery');
  });
});

