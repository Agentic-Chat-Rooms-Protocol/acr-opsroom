import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  DarwinPodController,
  PodTemplate,
  TIER_COST_ESTIMATES,
  PodRankCandidate,
  rankPods,
  extractParetoFrontier,
  rankPodsByDomain,
  podDominates,
} from '../src/index.js';

describe('Domain Agent Pods & Meta-LLM Darwin Loops', () => {
  const baseTemplate: PodTemplate = {
    templateRef: 'coding/refactor-worker@v1.0',
    domain: 'coding',
    systemPrompt: 'Refactor typescript modules to follow strict type safety.',
    tools: ['read_file', 'write_file', 'ast_grep'],
    benchAssertions: 'PASS_TEST_SUITE',
    perAgentCapUsd: 1.00,
    maxTier: 'high',
    registeredRoom: 'ops-engineering',
  };

  it('initializes in spawned state with cheap-by-default low tier', () => {
    const controller = new DarwinPodController(baseTemplate);
    assert.strictEqual(controller.status, 'spawned');
    assert.strictEqual(controller.currentTier, 'low');
    assert.strictEqual(controller.cumulativeSpendUsd, 0);
    assert.strictEqual(controller.history.length, 0);
  });

  it('completes on cheap tier without escalation when assertions pass', () => {
    const controller = new DarwinPodController(baseTemplate);
    const res = controller.evaluateStep('All tests clean: PASS_TEST_SUITE');

    assert.strictEqual(res.status, 'completed');
    assert.strictEqual(res.tier, 'low');
    assert.strictEqual(res.passed, true);
    assert.strictEqual(res.escalated, false);
    assert.strictEqual(controller.status, 'completed');
    assert.strictEqual(controller.cumulativeSpendUsd, TIER_COST_ESTIMATES.low);
    assert.strictEqual(controller.history.length, 1);
  });

  it('escalates cheap -> mid -> high on consecutive assertion failures', () => {
    const controller = new DarwinPodController(baseTemplate);

    // Iteration 1: Low tier execution fails
    const res1 = controller.evaluateStep('Syntax error: test failed');
    assert.strictEqual(res1.status, 'escalating');
    assert.strictEqual(res1.tier, 'mid');
    assert.strictEqual(res1.passed, false);
    assert.strictEqual(res1.escalated, true);
    assert.strictEqual(controller.currentTier, 'mid');

    // Iteration 2: Mid tier execution fails
    const res2 = controller.evaluateStep('Type error on line 42');
    assert.strictEqual(res2.status, 'escalating');
    assert.strictEqual(res2.tier, 'high');
    assert.strictEqual(res2.passed, false);
    assert.strictEqual(res2.escalated, true);
    assert.strictEqual(controller.currentTier, 'high');

    // Iteration 3: High tier execution passes
    const res3 = controller.evaluateStep('PASS_TEST_SUITE confirmed');
    assert.strictEqual(res3.status, 'completed');
    assert.strictEqual(res3.tier, 'high');
    assert.strictEqual(res3.passed, true);
    assert.strictEqual(res3.escalated, false);
    assert.strictEqual(controller.status, 'completed');

    const expectedSpend = TIER_COST_ESTIMATES.low + TIER_COST_ESTIMATES.mid + TIER_COST_ESTIMATES.high;
    assert.strictEqual(controller.cumulativeSpendUsd, expectedSpend);
    assert.strictEqual(controller.history.length, 3);
  });

  it('terminates in failed state when hitting maxTier ceiling', () => {
    const restrictedTemplate: PodTemplate = {
      ...baseTemplate,
      maxTier: 'mid', // Restrict to mid max
    };
    const controller = new DarwinPodController(restrictedTemplate);

    // Low tier fails -> escalates to mid
    controller.evaluateStep('fail 1');
    assert.strictEqual(controller.status, 'escalating');
    assert.strictEqual(controller.currentTier, 'mid');

    // Mid tier fails -> cannot escalate to high -> fails
    const res = controller.evaluateStep('fail 2');
    assert.strictEqual(res.status, 'failed');
    assert.strictEqual(controller.status, 'failed');
    assert.match(controller.lastFailureReason!, /tier ceiling/);
  });

  it('fails with budget exhaustion if spend exceeds perAgentCapUsd', () => {
    const tightBudgetTemplate: PodTemplate = {
      ...baseTemplate,
      perAgentCapUsd: 0.010, // Not enough for mid ($0.015)
    };
    const controller = new DarwinPodController(tightBudgetTemplate);

    // Step 1: charges low ($0.002) -> fails assertion
    const res = controller.evaluateStep('fail 1');
    assert.strictEqual(res.status, 'failed');
    assert.strictEqual(controller.status, 'failed');
    assert.match(controller.lastFailureReason!, /Budget exhausted/);
  });

  it('executes full automated runDarwinLoop successfully', async () => {
    const controller = new DarwinPodController(baseTemplate);

    // Mock worker that succeeds only on high tier
    const worker = async (tier: string) => {
      if (tier === 'high') {
        return 'Execution succeeded: PASS_TEST_SUITE';
      }
      return 'Execution failed: timeout';
    };

    const summary = await controller.runDarwinLoop(worker);
    assert.strictEqual(summary.status, 'completed');
    assert.strictEqual(summary.finalTier, 'high');
    assert.strictEqual(summary.totalAttempts, 3);
    assert.ok(summary.spendUsd > 0);

    const telemetry = controller.getTelemetry();
    assert.strictEqual(telemetry.status, 'completed');
    assert.strictEqual(telemetry.totalAttempts, 3);
    assert.strictEqual(telemetry.isBudgetExhausted, false);
  });
});

describe('Pareto Pod Ranker across {domain x host x tier}', () => {
  const candidates: PodRankCandidate[] = [
    { id: 'pod-a', domain: 'coding', host: 'cluster-us-east', tier: 'high', accuracy: 0.98, costUsd: 0.08, latencyMs: 2500 },
    { id: 'pod-b', domain: 'coding', host: 'cluster-us-east', tier: 'mid',  accuracy: 0.90, costUsd: 0.02, latencyMs: 1200 },
    { id: 'pod-c', domain: 'coding', host: 'cluster-eu-west', tier: 'low',  accuracy: 0.80, costUsd: 0.005, latencyMs: 500 },
    // Dominated by pod-b: lower accuracy (0.85 < 0.90), higher cost (0.03 > 0.02), higher latency (1400 > 1200)
    { id: 'pod-d-dominated', domain: 'coding', host: 'cluster-us-east', tier: 'mid', accuracy: 0.85, costUsd: 0.03, latencyMs: 1400 },
    // Research domain
    { id: 'pod-res-1', domain: 'research', host: 'cluster-eu-west', tier: 'high', accuracy: 0.95, costUsd: 0.07, latencyMs: 3000 },
    { id: 'pod-res-2', domain: 'research', host: 'cluster-eu-west', tier: 'low',  accuracy: 0.75, costUsd: 0.003, latencyMs: 800 },
  ];

  it('correctly assesses dominance between candidates', () => {
    const superior = candidates[1]; // pod-b: 0.90 acc, 0.02 cost, 1200 lat
    const inferior = candidates[3]; // pod-d: 0.85 acc, 0.03 cost, 1400 lat

    assert.strictEqual(podDominates(superior, inferior), true);
    assert.strictEqual(podDominates(inferior, superior), false);
  });

  it('ranks pods and prunes dominated configurations to rank > 1', () => {
    const ranked = rankPods(candidates);
    const dominatedPod = ranked.find((p) => p.id === 'pod-d-dominated');

    assert.ok(dominatedPod);
    assert.strictEqual(dominatedPod.isDominated, true);
    assert.ok(dominatedPod.paretoRank > 1);

    const frontier = extractParetoFrontier(candidates);
    assert.strictEqual(frontier.some((p) => p.id === 'pod-d-dominated'), false);
    assert.ok(frontier.some((p) => p.id === 'pod-a'));
    assert.ok(frontier.some((p) => p.id === 'pod-b'));
    assert.ok(frontier.some((p) => p.id === 'pod-c'));
  });

  it('groups and computes Pareto frontiers per domain', () => {
    const byDomain = rankPodsByDomain(candidates);
    assert.strictEqual(byDomain.has('coding'), true);
    assert.strictEqual(byDomain.has('research'), true);

    const codingGroup = byDomain.get('coding')!;
    assert.strictEqual(codingGroup.frontier.length, 3); // pod-a, pod-b, pod-c
    assert.strictEqual(codingGroup.all.length, 4);       // includes pod-d

    const researchGroup = byDomain.get('research')!;
    assert.strictEqual(researchGroup.frontier.length, 2);
  });
});
