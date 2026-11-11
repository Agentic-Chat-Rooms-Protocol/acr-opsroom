/**
 * ADK 2.0 Graph Workflow Engine & Hyperfusion Extensions 1–5 Test Suite
 *
 * Verifies:
 * 1. Static sequential, parallel fan-out, JoinNode fan-in barrier, conditional routing, and DEFAULT fallback.
 * 2. 3-color DFS cycle detection (unconditional cycle rejection vs conditional review loop acceptance) & RFC 8785 JCS topologyHash.
 * 3. Dynamic dynamicEntry + ctx.runNode() scheduling, concurrent run deduplication, and numeric custom runId rejection.
 * 4. ParallelWorker bounded concurrency (maxParallelWorkers) and deterministic output ordering.
 * 5. Event-log rehydration (reconstructNodeRuns, isFastForwardable, verifySessionAuditIntegrity) & cyclic loopback rehydration safety.
 * 6. Dual state write protection: intra-workflow state_write_order (shouldApplyDeltaWrite) & inter-worker createOwnershipFencedCommitter (StaleGenerationFenceError).
 * 7. Extension 3 + WalBackedToolNode: NodeTimeoutError blocks blind retries, transitions to OUTCOME_UNKNOWN, routes along __OUTCOME_UNKNOWN__, and reconciles via DurableCommandWal.
 * 8. Extension 5 + PasskeyConsentNode & ByzantineQuorumNode: RequestInput pause, plain-text resume rejection, pre-verification challenge burn, graph-topology-bound resource_version, 67% BFT quorum, and CryptographicAuditLedger recording.
 * 9. Extension 2 + Webhook Intake Taint Propagation: executionAuthority = 'NONE' propagates across BranchPath and JoinNode (intersectExecutionAuthorities) and blocks unapproved side effects with NodePrivilegeEscalationError.
 * 10. PlaybookRun.compileGraph() / PlaybookRun.toWorkflow() and Atlas2Engine.compileExecutionGraph().
 */

import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  START,
  DEFAULT_ROUTE,
  DEFAULT,
  OUTCOME_UNKNOWN_ROUTE,
  createGraphFromEdgeItems,
  Workflow,
  FunctionNode,
  JoinNode,
  ParallelWorker,
  executeWorkflow,
  createEvent,
  createEventActions,
  createInvocationContext,
  State,
  toContent,
  RequestInput,
  recordStateWrite,
  shouldApplyDeltaWrite,
  createOwnershipFencedCommitter,
  StaleGenerationFenceError,
  NodePrivilegeEscalationError,
  WalBackedToolNode,
  PasskeyConsentNode,
  ByzantineQuorumNode,
  SandboxedExecutionNode,
  Atlas2GraphWorkflow,
  computeGraphBoundResourceVersion,
  verifySessionAuditIntegrity,
  reconstructNodeRuns,
  isFastForwardable,
  DurableCommandWal,
  ApprovalGate,
  ConsentChallengeStore,
  computeRequestCanonicalHash,
  signPasskeyConsentEnvelope,
  CryptographicAuditLedger,
  PlaybookRun,
  computePlaybookId,
  Atlas2Engine,
  hmacSha256Sync,
  AnchoredContextCompactor,
  TrajectoryThoughtPruningCompactor,
  CheckpointSafeContextCompactor,
  isCompactedEvent,
  getActiveEvents,
  eventsForCurrentRun,
  AcrAgentNode,
  FinishTaskTool,
  ExitLoopTool,
  RoutedAgent,
  filterByIsolationScope,
  WalGuardedReflectRetryPlugin,
  ToolCallIntegrityPlugin,
  ToolCallIntegrityError,
  TOOL_CALL_HMAC_METADATA_KEY,
  RESTORED_EVENT_KEY,
  SIDE_EFFECT_RECONCILIATION_REQUIRED_TYPE,
  PluginManager,
  ToolNode,
  BaseTool,
  buildAbortEvents,
  InvocationAbortedError,
  type NodeContext,
  type SignedDecision,
  type AgentSquad,
  type ConsensusBallot,
  type Event,
  type RunAsyncToolRequest,
} from '../src/index.js';

function createTestSquad(): AgentSquad {
  return {
    id: 'squad-alpha',
    name: 'Alpha BFT Squad',
    specialization: 'incident-remediation',
    consensusThreshold: 0.67,
    agents: [
      {
        id: 'agent-sre',
        name: 'SRE Agent',
        role: 'sre_reliability',
        did: 'did:key:z6MkSreAgent1',
        publicKey: 'pk-sre-secret-key-1',
        voteWeight: 1,
        status: 'deliberating',
        capabilities: ['prometheus.query'],
      },
      {
        id: 'agent-sec',
        name: 'SecOps Agent',
        role: 'secops_guardian',
        did: 'did:key:z6MkSecAgent2',
        publicKey: 'pk-sec-secret-key-2',
        voteWeight: 1,
        status: 'deliberating',
        capabilities: ['vault.audit'],
      },
      {
        id: 'agent-fin',
        name: 'FinOps Agent',
        role: 'finops_overseer',
        did: 'did:key:z6MkFinAgent3',
        publicKey: 'pk-fin-secret-key-3',
        voteWeight: 1,
        status: 'deliberating',
        capabilities: ['cost.inspect'],
      },
    ],
  };
}

describe('ADK 2.0 Graph Workflow Engine & Hyperfusion Extensions (1–5)', () => {
  it('1. Static sequential, parallel fan-out, JoinNode fan-in barrier, conditional routing, and DEFAULT route fallback', async () => {
    const stepA = new FunctionNode(
      'step_a',
      async (_ctx: NodeContext, input: { base: number }) => ({ valA: input.base + 10 })
    );

    const branch1 = new FunctionNode(
      'branch_1',
      async (_ctx: NodeContext, input: { valA: number }) => ({ b1: input.valA * 2 })
    );

    const branch2 = new FunctionNode(
      'branch_2',
      async (_ctx: NodeContext, input: { valA: number }) => ({ b2: input.valA * 3 })
    );

    const joiner = new JoinNode({ name: 'join_branches' });

    const router = new FunctionNode(
      'router',
      async (
        ctx: NodeContext,
        input: { branch_1: { b1: number }; branch_2: { b2: number } }
      ) => {
        const sum = input.branch_1.b1 + input.branch_2.b2;
        if (sum > 1000) {
          return createEvent({
            author: 'router',
            invocationId: ctx.invocationId,
            content: toContent({ sum }),
            output: { sum },
            route: 'high',
          });
        }
        // Unmatched route 'low' falls back to DEFAULT_ROUTE
        return createEvent({
          author: 'router',
          invocationId: ctx.invocationId,
          content: toContent({ sum, fallbackUsed: true }),
          output: { sum, fallbackUsed: true },
          route: 'low',
        });
      }
    );

    const fallbackSink = new FunctionNode(
      'fallback_sink',
      async (_ctx: NodeContext, input: { sum: number; fallbackUsed: boolean }) => ({
        finalSum: input.sum,
        fallbackUsed: input.fallbackUsed,
      })
    );

    const highSink = new FunctionNode(
      'high_sink',
      async (_ctx: NodeContext, input: { sum: number }) => ({
        finalSum: input.sum,
        fallbackUsed: false,
      })
    );

    const wf = new Workflow({
      name: 'fanout_join_default_wf',
      edges: [
        [START, stepA],
        [stepA, [branch1, branch2]],
        [[branch1, branch2], joiner],
        [joiner, router],
        [router, { high: highSink, [DEFAULT]: fallbackSink }],
      ],
    });

    const res = await executeWorkflow<{ finalSum: number; fallbackUsed: boolean }>(wf, {
      base: 5,
    });

    assert.equal(res.paused, false);
    // valA = 15, b1 = 30, b2 = 45, sum = 75 -> route 'low' falls back to DEFAULT -> fallback_sink
    assert.deepEqual(res.output, { finalSum: 75, fallbackUsed: true });
  });

  it('2. Graph validation: 3-color DFS rejects unconditional cycles while permitting conditional review loops & computes deterministic RFC 8785 JCS topologyHash', async () => {
    const nA = new FunctionNode('a', async () => 'ok');
    const nB = new FunctionNode('b', async () => 'ok');

    // Unconditional cycle: a -> b -> a must throw
    assert.throws(
      () => createGraphFromEdgeItems([[START, nA, nB, nA]]),
      /Unconditional cycle detected/
    );

    // Conditional loop: draft -> review --revise--> draft, review --publish--> publish_node must succeed
    let attempts = 0;
    const draftNode = new FunctionNode('draft', async () => {
      attempts += 1;
      return { version: attempts };
    });

    const reviewNode = new FunctionNode(
      'review',
      async (ctx: NodeContext, input: { version: number }) =>
        createEvent({
          author: 'review',
          invocationId: ctx.invocationId,
          content: toContent(input),
          output: input,
          route: input.version < 2 ? 'revise' : 'publish',
        })
    );

    const publishNode = new FunctionNode(
      'publish_node',
      async (_ctx: NodeContext, input: { version: number }) => ({
        publishedVersion: input.version,
      })
    );

    const g1 = createGraphFromEdgeItems([
      [START, draftNode, reviewNode],
      [reviewNode, { revise: draftNode, publish: publishNode }],
    ]);
    const g2 = createGraphFromEdgeItems([
      [reviewNode, { publish: publishNode, revise: draftNode }],
      [START, draftNode, reviewNode],
    ]);

    // Canonical RFC 8785 JCS topologyHash is invariant to edge registration order
    assert.equal(g1.topologyHash.length, 64);
    assert.equal(g1.topologyHash, g2.topologyHash);

    const wf = new Workflow({
      name: 'conditional_review_loop',
      edges: [
        [START, draftNode, reviewNode],
        [reviewNode, { revise: draftNode, publish: publishNode }],
      ],
    });

    const res = await executeWorkflow<{ publishedVersion: number }>(wf, {});
    assert.equal(res.paused, false);
    assert.deepEqual(res.output, { publishedVersion: 2 });
    assert.equal(attempts, 2);
  });

  it('3. Dynamic node scheduling (ctx.runNode), concurrent deduplication, and numeric custom runId rejection', async () => {
    let subExecutions = 0;
    const workerSubNode = new FunctionNode(
      'sub_worker',
      async (_ctx: NodeContext, input: { x: number }) => {
        subExecutions += 1;
        await new Promise((r) => setTimeout(r, 10));
        return input.x * 10;
      }
    );

    let numericCheckExecutions = 0;
    const numericGuardNode = new FunctionNode('numeric_guard_worker', async () => {
      numericCheckExecutions += 1;
      return 'ok';
    });

    const wf = new Workflow({
      name: 'dynamic_scheduler_wf',
      dynamicEntry: async (ctx: NodeContext) => {
        // Dedup concurrent identical (node, runId)
        const [r1, r2] = await Promise.all([
          ctx.runNode(workerSubNode, { x: 7 }, { runId: 'dedup_task_alpha' }),
          ctx.runNode(workerSubNode, { x: 7 }, { runId: 'dedup_task_alpha' }),
        ]);

        // Run one auto-numbered invocation on numericGuardNode, then verify that mixing
        // an all-digit custom runId ('2') on the same node is rejected before running!
        await ctx.runNode(numericGuardNode, {});
        let numericRejected = false;
        try {
          await ctx.runNode(numericGuardNode, {}, { runId: '2' });
        } catch (err) {
          if (err instanceof Error && /Invalid runId/i.test(err.message)) {
            numericRejected = true;
          }
        }

        return { r1: r1.output, r2: r2.output, numericRejected };
      },
    });

    const res = await executeWorkflow<{
      r1: number;
      r2: number;
      numericRejected: boolean;
    }>(wf, {});

    assert.equal(res.paused, false);
    assert.equal(subExecutions, 1);
    assert.equal(numericCheckExecutions, 1);
    assert.deepEqual(res.output, { r1: 70, r2: 70, numericRejected: true });
  });

  it('4. ParallelWorker bounded concurrency (maxParallelWorkers) and deterministic output ordering', async () => {
    let activeWorkers = 0;
    let peakActiveWorkers = 0;

    const itemProcessor = new FunctionNode(
      'item_processor',
      async (_ctx: NodeContext, item: number) => {
        activeWorkers += 1;
        if (activeWorkers > peakActiveWorkers) {
          peakActiveWorkers = activeWorkers;
        }
        await new Promise((r) => setTimeout(r, 15));
        activeWorkers -= 1;
        return item * 2;
      }
    );

    const batchWorker = new ParallelWorker(itemProcessor, {
      maxParallelWorkers: 2,
    });

    const wf = new Workflow({
      name: 'parallel_worker_wf',
      edges: [[START, batchWorker]],
    });

    const res = await executeWorkflow<number[]>(wf, [1, 2, 3, 4, 5]);
    assert.equal(res.paused, false);
    assert.deepEqual(res.output, [2, 4, 6, 8, 10]);
    assert.ok(peakActiveWorkers <= 2, `Expected peakActiveWorkers <= 2, got ${peakActiveWorkers}`);
  });

  it('5. Event-log rehydration & cyclic loopback safety: fast-forwards initial pass then executes fresh on loopback', async () => {
    let draftExecutionCount = 0;
    let reviewExecutionCount = 0;

    const draftNode = new FunctionNode(
      'draft_step',
      async (_ctx: NodeContext, input: { revision?: number }) => {
        draftExecutionCount += 1;
        const rev = (input?.revision ?? 0) + 1;
        return { revision: rev };
      }
    );

    const reviewNode = new FunctionNode(
      'review_step',
      async (ctx: NodeContext, input: { revision: number }) => {
        reviewExecutionCount += 1;
        const interruptId = 'review_interrupt_1';
        if (input.revision === 1) {
          const resumeReply = ctx.resumeInputs[interruptId] as
            | { action: 'revise' | 'approve' }
            | undefined;
          if (!resumeReply) {
            return new RequestInput({
              interruptId,
              message: 'Review draft v1',
            });
          }
          return createEvent({
            author: 'review_step',
            invocationId: ctx.invocationId,
            content: toContent({ revision: input.revision }),
            output: { revision: input.revision },
            route: resumeReply.action,
          });
        }
        return createEvent({
          author: 'review_step',
          invocationId: ctx.invocationId,
          content: toContent({ approvedRevision: input.revision }),
          output: { approvedRevision: input.revision },
          route: 'approve',
        });
      },
      { rerunOnResume: true }
    );

    const doneNode = new FunctionNode(
      'done_step',
      async (_ctx: NodeContext, input: { approvedRevision: number }) => input
    );

    const wf = new Workflow({
      name: 'rehydration_loopback_wf',
      edges: [
        [START, draftNode, reviewNode],
        [reviewNode, { revise: draftNode, approve: doneNode }],
      ],
    });

    const ledger = new CryptographicAuditLedger('inc-rehydrate-1');

    // Pass 1: runs draft_step (rev=1), then pauses at review_step
    const pass1 = await executeWorkflow(
      wf,
      {},
      { invocationId: 'inv-rehydrate-1', auditLedger: ledger }
    );
    assert.equal(pass1.paused, true);
    assert.deepEqual(pass1.interruptIds, ['review_interrupt_1']);
    assert.equal(draftExecutionCount, 1);
    assert.equal(reviewExecutionCount, 1);
    assert.doesNotThrow(() => verifySessionAuditIntegrity(ledger));

    const reconstructed = reconstructNodeRuns(pass1.session.events);
    const draftRuns = reconstructed.get('draft_step');
    assert.ok(draftRuns && draftRuns.length === 1);
    assert.equal(isFastForwardable(draftRuns[0]), true);

    // Pass 2: resume review_step with { action: 'revise' } -> loops back to draft_step!
    // draft_step MUST fast-forward on initial pass (run 0), then execute fresh when review_step routes back to draft_step!
    const pass2 = await executeWorkflow<{ approvedRevision: number }>(
      wf,
      undefined,
      {
        invocationId: 'inv-rehydrate-2',
        session: pass1.session,
        interruptResponses: {
          review_interrupt_1: { action: 'revise' },
        },
        auditLedger: ledger,
      }
    );

    assert.equal(pass2.paused, false);
    // draftExecutionCount is 2: 1 from Pass 1, fast-forwarded initial pass in Pass 2, +1 from loopback in Pass 2
    assert.equal(draftExecutionCount, 2);
    assert.deepEqual(pass2.output, { approvedRevision: 2 });
  });

  it('6. Dual state write protection: intra-workflow state_write_order & inter-worker generational fencing (StaleGenerationFenceError)', async () => {
    // Part A: Intra-workflow causal WeakMap write ordering
    const targetState: Record<string, unknown> = {};
    const olderDelta: Record<string, unknown> = { status: 'older' };
    const newerDelta: Record<string, unknown> = { status: 'newer' };

    recordStateWrite(targetState, olderDelta, 'status');
    recordStateWrite(targetState, newerDelta, 'status');

    // Applying newerDelta succeeds; subsequent late commit of olderDelta is rejected!
    assert.equal(shouldApplyDeltaWrite(targetState, newerDelta, 'status'), true);
    assert.equal(shouldApplyDeltaWrite(targetState, olderDelta, 'status'), false);

    // Part B: Inter-worker generational fencing via createOwnershipFencedCommitter
    const staleCommitter = createOwnershipFencedCommitter({
      fencingRegistry: {
        submitFencedMutation: () => {
          const err = new Error('Stale generation') as Error & { activeGeneration: bigint };
          err.activeGeneration = 5n;
          throw err;
        },
      },
      resourceUri: 'repo:acr-opsroom/workflow:wf-1',
      ownerDid: 'did:key:z6MkStaleWorker',
      ownershipGeneration: 4n,
      fencingToken: 'fence-tok-4',
    });

    const stateWriter = new FunctionNode('fenced_writer', async (ctx: NodeContext) => {
      ctx.state.set('critical_key', 'compromised_value');
      return 'wrote';
    });

    const wf = new Workflow({
      name: 'fenced_wf',
      edges: [[START, stateWriter]],
    });

    await assert.rejects(
      () => executeWorkflow(wf, {}, { fencedCommitter: staleCommitter }),
      (err: unknown) => {
        assert.ok(err instanceof StaleGenerationFenceError);
        assert.equal(err.attemptedGeneration, '4');
        assert.equal(err.activeGeneration, '5');
        return true;
      }
    );
  });

  it('7. Extension 3 + WalBackedToolNode: NodeTimeoutError blocks blind retry, transitions to OUTCOME_UNKNOWN, routes along __OUTCOME_UNKNOWN__, and reconciles via DurableCommandWal', async () => {
    // Step 1: Side-effecting node that times out mid-flight -> RetryConfig(maxAttempts=3) MUST NOT blind-retry!
    let timeoutNodeAttempts = 0;
    const timingOutSideEffectNode = new FunctionNode(
      'timeout_side_effect',
      async (ctx: NodeContext) => {
        timeoutNodeAttempts += 1;
        ctx.sideEffectDispatched = true;
        await new Promise((r) => setTimeout(r, 120));
        return { done: true };
      },
      {
        sideEffecting: true,
        timeout: 0.02, // 20ms timeout
        retryConfig: { maxAttempts: 3, initialDelay: 0.005 },
      }
    );

    const reconcileFallbackNode = new FunctionNode(
      'reconcile_fallback',
      async (_ctx: NodeContext, input: { nodeName: string; status: string }) => ({
        handledUnknownOutcomeFor: input.nodeName,
        status: input.status,
      })
    );

    const timeoutWf = new Workflow({
      name: 'timeout_reconcile_wf',
      edges: [
        [START, timingOutSideEffectNode],
        [timingOutSideEffectNode, { [OUTCOME_UNKNOWN_ROUTE]: reconcileFallbackNode }],
      ],
    });

    const timeoutRes = await executeWorkflow<{
      handledUnknownOutcomeFor: string;
      status: string;
    }>(timeoutWf, {});

    // Verify zero blind retries occurred (exactly 1 attempt despite maxAttempts: 3) and __OUTCOME_UNKNOWN__ route fired!
    assert.equal(timeoutNodeAttempts, 1);
    assert.equal(timeoutRes.paused, false);
    assert.deepEqual(timeoutRes.output, {
      handledUnknownOutcomeFor: 'timeout_side_effect',
      status: 'OUTCOME_UNKNOWN',
    });

    // Step 2: WalBackedToolNode crashes after external side effect before checkpoint, then reconciles on recovery without duplicate dispatch
    const wal = new DurableCommandWal<{ prNumber: number }>();
    let externalPrCreated = false;
    let dispatchCalls = 0;
    let probeCalls = 0;

    const walNodeCrash = new WalBackedToolNode<{ prNumber: number }>({
      name: 'create_github_pr',
      wal,
      toolName: 'github.create_pull_request',
      actionKind: 'git_push',
      simulateCrashBeforeCheckpoint: true,
      dispatcher: async () => {
        dispatchCalls += 1;
        externalPrCreated = true;
        return {
          externalResourceId: 'pr:42',
          result: { prNumber: 42 },
        };
      },
      reconcileProbe: async () => {
        probeCalls += 1;
        return externalPrCreated
          ? { exists: true, externalResourceId: 'pr:42', result: { prNumber: 42 } }
          : { exists: false };
      },
    });

    const wfCrash = new Workflow({
      name: 'wal_crash_wf',
      edges: [[START, walNodeCrash]],
    });

    await assert.rejects(() =>
      executeWorkflow(wfCrash, { repo: 'acr/core', title: 'Fix BFT' }, { invocationId: 'run-wal-1' })
    );
    assert.equal(dispatchCalls, 1);

    // Recovery run with same workflow name and arguments reconciles via reconcileProbe without re-dispatching
    const walNodeRecover = new WalBackedToolNode<{ prNumber: number }>({
      name: 'create_github_pr',
      wal,
      toolName: 'github.create_pull_request',
      actionKind: 'git_push',
      simulateCrashBeforeCheckpoint: false,
      dispatcher: async () => {
        dispatchCalls += 1;
        return {
          externalResourceId: 'pr:99',
          result: { prNumber: 99 },
        };
      },
      reconcileProbe: async () => {
        probeCalls += 1;
        return externalPrCreated
          ? { exists: true, externalResourceId: 'pr:42', result: { prNumber: 42 } }
          : { exists: false };
      },
    });

    const wfRecover = new Workflow({
      name: 'wal_crash_wf',
      edges: [[START, walNodeRecover]],
    });

    const recoverRes = await executeWorkflow<{
      reconciledAfterCrash: boolean;
      result: { prNumber: number };
    }>(wfRecover, { repo: 'acr/core', title: 'Fix BFT' }, { invocationId: 'run-wal-2' });

    assert.equal(recoverRes.paused, false);
    assert.equal(dispatchCalls, 1); // MUST still be 1!
    assert.ok(probeCalls >= 1);
    assert.equal(recoverRes.output?.reconciledAfterCrash, true);
    assert.deepEqual(recoverRes.output?.result, { prNumber: 42 });
  });

  it('8. Extension 5 + PasskeyConsentNode & ByzantineQuorumNode: cryptographic WebAuthn consent & 67% BFT quorum with audit ledger', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const operatorDid = 'did:key:z6MkOperatorAlice';
    const actionId = 'prod_db_failover_action';
    const actionType = 'cluster.failover';
    const targetResourceUri = 'cluster://eu-central-1';
    const baseResourceVersion = 'v12';
    const policyRevision = 'pol-2026-11';
    const parameters = { target: 'eu-central-1' };

    const gate = new ApprovalGate([operatorDid]);
    const challengeStore = new ConsentChallengeStore();

    const consentNode = new PasskeyConsentNode({
      name: 'passkey_gate',
      approvalGate: gate,
      challengeStore,
      publicKey,
      operatorDid,
      actionId,
      actionType,
      targetResourceUri,
      resourceVersion: baseResourceVersion,
      policyRevision,
      parameters,
    });

    const protectedDeployNode = new SandboxedExecutionNode({
      name: 'protected_deploy',
      executor: async (args, ctx) => ({
        requestId: 'sbx-req-1',
        state: 'COMPLETED',
        output: {
          deployed: true,
          authority: ctx.executionAuthority,
          consentStatus: args.status,
        },
      }),
    });

    const wf = new Workflow({
      name: 'consent_governed_wf',
      edges: [
        [START, consentNode],
        [consentNode, { authorized: protectedDeployNode }],
      ],
    });

    // Pass 1: pauses at passkey_gate with RequestInput
    const pauseRes = await executeWorkflow(wf, {}, { invocationId: 'inv-consent-1' });
    assert.equal(pauseRes.paused, true);
    const interruptId = pauseRes.interruptIds[0];
    assert.equal(interruptId, 'consent:consent_governed_wf.passkey_gate');

    // Attempt 1: Resuming with a plain-text `{ approved: true }` payload (forged ADK HITL resume) MUST fail!
    await assert.rejects(
      () =>
        executeWorkflow(wf, undefined, {
          invocationId: 'inv-consent-2',
          session: {
            id: pauseRes.session.id,
            state: { ...pauseRes.session.state },
            events: [...pauseRes.session.events],
          },
          interruptResponses: {
            [interruptId]: { approved: true },
          },
        }),
      /CONSENT_PLAIN_TEXT_FORBIDDEN/
    );

    // Attempt 2: Construct authentic Ed25519 PasskeyConsentEnvelope bound to graphTopologyHash
    const challengeKey = Object.keys(pauseRes.session.state).find((k) =>
      k.startsWith('__consent_challenge:')
    );
    assert.ok(challengeKey);
    const storedChallenge = pauseRes.session.state[challengeKey] as {
      challenge_nonce: string;
      resource_version: string;
      request_canonical_hash: string;
      workflow_id: string;
      graph_topology_hash: string;
      node_path: string;
    };
    assert.ok(storedChallenge);

    const expectedBoundVersion = computeGraphBoundResourceVersion({
      baseResourceVersion,
      workflowId: 'consent_governed_wf',
      graphTopologyHash: wf.topologyHash,
      nodePath: storedChallenge.node_path,
    });
    assert.equal(storedChallenge.resource_version, expectedBoundVersion);

    const nowMs = Date.now();
    const requestCanonicalHash = computeRequestCanonicalHash({
      action_type: actionType,
      target_resource_uri: targetResourceUri,
      resource_version: expectedBoundVersion,
      policy_revision: policyRevision,
      parameters,
    });

    const signedEnvelope = signPasskeyConsentEnvelope(
      {
        consent_id: 'consent-graph-001',
        operator_did: operatorDid,
        authenticator_id: 'yubikey-bio-1',
        challenge_nonce: storedChallenge.challenge_nonce,
        request_canonical_hash: requestCanonicalHash,
        action_type: actionType,
        target_resource_uri: targetResourceUri,
        resource_version: expectedBoundVersion,
        policy_revision: policyRevision,
        issued_at: nowMs,
        expires_at: nowMs + 60_000,
        max_invocations: 1,
      },
      privateKey
    );

    const decision: SignedDecision = {
      action_id: actionId,
      verdict: 'approve',
      reason: 'Confirmed failover via WebAuthn',
      decider: operatorDid,
      decided_at: new Date(nowMs).toISOString(),
      signature: signedEnvelope.signature,
    };

    const validResumeRes = await executeWorkflow<{
      output: { deployed: boolean; authority: string; consentStatus: string };
    }>(wf, undefined, {
      invocationId: 'inv-consent-3',
      session: pauseRes.session,
      interruptResponses: {
        [interruptId]: {
          decision,
          envelope: signedEnvelope,
          workflow_id: 'consent_governed_wf',
          graph_topology_hash: wf.topologyHash,
          node_path: storedChallenge.node_path,
          now_ms: nowMs,
        },
      },
    });

    assert.equal(validResumeRes.paused, false);
    assert.equal(validResumeRes.executionAuthority, 'CONSENT_ELEVATED');
    assert.deepEqual(validResumeRes.output?.output, {
      deployed: true,
      authority: 'CONSENT_ELEVATED',
      consentStatus: 'authorized',
    });

    // Part B: ByzantineQuorumNode with 67% BFT Quorum + CryptographicAuditLedger
    const ledger = new CryptographicAuditLedger();
    const squad = createTestSquad();
    const incidentId = 'inc-bft-graph-1';
    const ballots: ConsensusBallot[] = squad.agents.map((agent, idx) => {
      const ts = 1700000000000 + idx;
      const justification = 'Telemetry verified safe for canary promotion';
      const confidence = 0.95;
      const sigPayload = `${incidentId}:${agent.did}:approve:${confidence}:${justification}:${ts}`;
      return {
        ballotId: `ballot-${agent.id}`,
        incidentId,
        agentId: agent.id,
        role: agent.role,
        did: agent.did,
        decision: 'approve',
        confidence,
        justification,
        timestamp: ts,
        signature: hmacSha256Sync(agent.publicKey, sigPayload),
      };
    });

    const quorumNode = new ByzantineQuorumNode({
      name: 'bft_council',
      auditLedger: ledger,
      incidentId,
      squad,
      ballots,
    });

    const afterQuorum = new FunctionNode(
      'after_quorum',
      async (ctx: NodeContext, input: { merkleRootHash: string }) => ({
        verifiedMerkleRoot: input.merkleRootHash,
        authority: ctx.executionAuthority,
      })
    );

    const bftWf = new Workflow({
      name: 'bft_quorum_wf',
      edges: [
        [START, quorumNode],
        [quorumNode, { approved: afterQuorum }],
      ],
    });

    const bftRes = await executeWorkflow<{
      verifiedMerkleRoot: string;
      authority: string;
    }>(bftWf, {});

    assert.equal(bftRes.paused, false);
    assert.equal(bftRes.output?.authority, 'QUORUM_ELEVATED');
    assert.equal(ledger.verifyChainIntegrity(), true);
    assert.equal(ledger.getBlocks().length, 1);
  });

  it('9. Extension 2 + Webhook Intake Taint Propagation: executionAuthority = NONE propagates across branches & JoinNode and blocks unapproved side effects', async () => {
    const branchTainted = new FunctionNode('branch_tainted', async () => ({
      fromTainted: true,
    }));
    const branchClean = new FunctionNode('branch_clean', async () => ({
      fromClean: true,
    }));
    const joiner = new JoinNode({ name: 'join_taint_check' });

    const privilegedSideEffect = new SandboxedExecutionNode({
      name: 'privileged_side_effect',
      executor: async () => ({
        requestId: 'sbx-unapproved',
        state: 'COMPLETED',
        output: { executed: true },
      }),
    });

    const wf = new Workflow({
      name: 'webhook_taint_wf',
      edges: [
        [START, [branchTainted, branchClean]],
        [[branchTainted, branchClean], joiner],
        [joiner, privilegedSideEffect],
      ],
    });

    // Trigger workflow from untrusted WebhookIntakeBoundary (executionAuthority: 'NONE')
    await assert.rejects(
      () => executeWorkflow(wf, {}, { executionAuthority: 'NONE' }),
      (err: unknown) => {
        assert.ok(err instanceof NodePrivilegeEscalationError);
        assert.equal(err.currentAuthority, 'NONE');
        return true;
      }
    );
  });

  it('10. PlaybookRun.compileGraph() / toWorkflow() and Atlas2Engine.compileExecutionGraph() integration', async () => {
    const steps = [
      {
        id: 'verify_metrics',
        kind: 'agent_task' as const,
        agent: 'sre_reliability',
        instruction: 'Check Prometheus latency',
      },
      {
        id: 'drain_traffic',
        kind: 'tool' as const,
        tool: 'envoy.drain',
      },
    ];
    const playbookId = computePlaybookId(
      'Canary Rollback Playbook',
      '1.0.0',
      'alert:high_latency',
      steps
    );
    const run = PlaybookRun.start({
      playbook_id: playbookId,
      name: 'Canary Rollback Playbook',
      version: '1.0.0',
      trigger: 'alert:high_latency',
      steps,
    });

    const compiledGraph = run.compileGraph();
    assert.equal(compiledGraph.topologyHash.length, 64);

    const pbWorkflow = run.toWorkflow();
    const pbRes = await executeWorkflow<{ step_id: string; completed: boolean }>(
      pbWorkflow,
      {}
    );
    assert.equal(pbRes.paused, false);
    assert.equal(pbRes.output?.step_id, 'drain_traffic');
    assert.equal(pbRes.output?.completed, true);

    // Atlas2Engine.compileExecutionGraph()
    const squad = createTestSquad();
    const incident = Atlas2Engine.createIncident(
      'EU Payment Gateway Latency Spike',
      'p99 > 4500ms across eu-central-1',
      squad
    );
    Atlas2Engine.addDeliberationTurn(
      incident,
      squad.agents[0],
      'Detected connection pool exhaustion on shard-2',
      'Shard-2 pool leak',
      [
        {
          toolName: 'k8s.rollout_restart',
          serverName: 'k8s-mcp',
          parameters: { deployment: 'payments-eu' },
          isDryRun: false,
          riskLevel: 'medium',
        },
      ],
      0.92
    );

    const atlasGraphWf = Atlas2Engine.compileExecutionGraph(
      incident,
      'Restore EU Payment Gateway SLA < 200ms'
    );

    assert.ok(atlasGraphWf instanceof Atlas2GraphWorkflow);
    assert.equal(atlasGraphWf.topologyHash.length, 64);
  });

  it('11. (G6) 30-step dynamic ctx.runNode loop + ByzantineQuorumNode (step 12) + AnchoredContextCompactor (step 20) + PasskeyConsentNode pause (step 25) + resume: preserves CompactedEvent in eventsForCurrentRun, zero re-executions of steps 1-24, and elevates to CONSENT_ELEVATED', async () => {
    const stepExecutionCounts = new Map<number, number>();
    const recordStep = (step: number) => {
      stepExecutionCounts.set(step, (stepExecutionCounts.get(step) ?? 0) + 1);
    };

    const ledger = new CryptographicAuditLedger();
    const squad = createTestSquad();
    const incidentId = 'inc-g6-dynamic-30';
    const ballots: ConsensusBallot[] = squad.agents.map((agent, idx) => {
      const ts = 1700001000000 + idx;
      const justification = 'Step 12 BFT quorum approved';
      const confidence = 0.96;
      const sigPayload = `${incidentId}:${agent.did}:approve:${confidence}:${justification}:${ts}`;
      return {
        ballotId: `g6-ballot-${agent.id}`,
        incidentId,
        agentId: agent.id,
        role: agent.role,
        did: agent.did,
        decision: 'approve',
        confidence,
        justification,
        timestamp: ts,
        signature: hmacSha256Sync(agent.publicKey, sigPayload),
      };
    });

    const bftStep12Node = new ByzantineQuorumNode({
      name: 'step_12_bft_quorum',
      auditLedger: ledger,
      incidentId,
      squad,
      ballots,
    });

    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const operatorDid = 'did:key:z6MkG6Operator';
    const actionId = 'g6_step25_action';
    const actionType = 'mesh.rebalance';
    const targetResourceUri = 'mesh://us-east-1';
    const baseResourceVersion = 'v25';
    const policyRevision = 'pol-g6';
    const parameters = { step: 25 };

    const gate = new ApprovalGate([operatorDid]);
    const challengeStore = new ConsentChallengeStore();

    const consentStep25Node = new PasskeyConsentNode({
      name: 'step_25_passkey_consent',
      approvalGate: gate,
      challengeStore,
      publicKey,
      operatorDid,
      actionId,
      actionType,
      targetResourceUri,
      resourceVersion: baseResourceVersion,
      policyRevision,
      parameters,
    });

    const compactor = new AnchoredContextCompactor({
      tokenThreshold: 1,
      eventRetentionSize: 2,
    });

    const stepNodes = Array.from({ length: 30 }, (_, i) => {
      const stepNum = i + 1;
      return new FunctionNode(
        `dyn_step_${stepNum}`,
        async (ctx: NodeContext, input: { prevSum: number }) => {
          recordStep(stepNum);
          return {
            step: stepNum,
            sum: (input?.prevSum ?? 0) + stepNum,
            authorityAtStep: ctx.executionAuthority,
          };
        }
      );
    });

    const wf = new Workflow({
      name: 'g6_dynamic_30_wf',
      dynamicEntry: async (ctx: NodeContext) => {
        let runningSum = 0;
        for (let stepNum = 1; stepNum <= 30; stepNum++) {
          if (stepNum === 12) {
            await ctx.runNode(
              bftStep12Node,
              {},
              { runId: 'run_step_12_bft' }
            );
          }
          if (stepNum === 25) {
            await ctx.runNode(
              consentStep25Node,
              {},
              { runId: 'run_step_25_consent' }
            );
          }

          const stepRes = await ctx.runNode(
            stepNodes[stepNum - 1],
            { prevSum: runningSum },
            { runId: `run_step_${stepNum}` }
          );
          const stepOut = stepRes.output as {
            step: number;
            sum: number;
            authorityAtStep: string;
          };
          runningSum = stepOut.sum;

          // At step 20, compact session events mid-flight while preserving checkpoints
          if (stepNum === 20) {
            await compactor.compact(ctx.invocationContext);
          }
        }
        return {
          totalSteps: 30,
          finalSum: runningSum,
          finalAuthority: ctx.executionAuthority,
        };
      },
    });

    // Pass 1: executes steps 1..24, compacts at step 20, pauses at step 25 on PasskeyConsentNode
    const pauseRes = await executeWorkflow(
      wf,
      {},
      { invocationId: 'g6-inv-1', auditLedger: ledger }
    );
    assert.equal(pauseRes.paused, true);
    assert.equal(pauseRes.interruptIds.length, 1);

    // Verify steps 1..24 executed exactly once, and steps 25..30 have not executed yet
    for (let s = 1; s <= 24; s++) {
      assert.equal(stepExecutionCounts.get(s), 1, `Step ${s} should have executed once before pause`);
    }
    for (let s = 25; s <= 30; s++) {
      assert.equal(stepExecutionCounts.get(s) ?? 0, 0, `Step ${s} should not have executed before consent`);
    }

    // Verify CompactedEvent is present in session.events and preserved by eventsForCurrentRun
    const compactedInSession = pauseRes.session.events.filter(isCompactedEvent);
    assert.equal(compactedInSession.length, 1);
    assert.ok(compactedInSession[0].checkpointManifest);
    assert.equal(
      compactedInSession[0].checkpointManifest?.highestAuthority,
      'QUORUM_ELEVATED'
    );
    const currentRunEvents = eventsForCurrentRun(pauseRes.session.events, wf.name);
    assert.ok(
      currentRunEvents.some(isCompactedEvent),
      'eventsForCurrentRun MUST retain CompactedEvent with checkpointManifest'
    );

    // Sign valid WebAuthn PasskeyConsentEnvelope for step 25
    const interruptId = pauseRes.interruptIds[0];
    const challengeKey = Object.keys(pauseRes.session.state).find((k) =>
      k.startsWith('__consent_challenge:')
    )!;
    const storedChallenge = pauseRes.session.state[challengeKey] as {
      challenge_nonce: string;
      resource_version: string;
      node_path: string;
    };

    const nowMs = Date.now();
    const reqHash = computeRequestCanonicalHash({
      action_type: actionType,
      target_resource_uri: targetResourceUri,
      resource_version: storedChallenge.resource_version,
      policy_revision: policyRevision,
      parameters,
    });
    const signedEnvelope = signPasskeyConsentEnvelope(
      {
        consent_id: 'g6-consent-env-1',
        operator_did: operatorDid,
        authenticator_id: 'passkey-g6',
        challenge_nonce: storedChallenge.challenge_nonce,
        request_canonical_hash: reqHash,
        action_type: actionType,
        target_resource_uri: targetResourceUri,
        resource_version: storedChallenge.resource_version,
        policy_revision: policyRevision,
        issued_at: nowMs,
        expires_at: nowMs + 60_000,
        max_invocations: 1,
      },
      privateKey
    );
    const decision: SignedDecision = {
      action_id: actionId,
      verdict: 'approve',
      reason: 'Approve step 25',
      decider: operatorDid,
      decided_at: new Date(nowMs).toISOString(),
      signature: signedEnvelope.signature,
    };

    // Pass 2: Resume workflow after compaction + HITL pause
    const resumeRes = await executeWorkflow<{
      totalSteps: number;
      finalSum: number;
      finalAuthority: string;
    }>(wf, undefined, {
      invocationId: 'g6-inv-2',
      session: pauseRes.session,
      auditLedger: ledger,
      interruptResponses: {
        [interruptId]: {
          decision,
          envelope: signedEnvelope,
          workflow_id: 'g6_dynamic_30_wf',
          graph_topology_hash: wf.topologyHash,
          node_path: storedChallenge.node_path,
          now_ms: nowMs,
        },
      },
    });

    assert.equal(resumeRes.paused, false);
    assert.equal(resumeRes.executionAuthority, 'CONSENT_ELEVATED');
    assert.deepEqual(resumeRes.output, {
      totalSteps: 30,
      finalSum: (30 * 31) / 2, // 465
      finalAuthority: 'CONSENT_ELEVATED',
    });

    // Critical verification: steps 1..24 executed 0 additional times on resume (total count === 1)
    for (let s = 1; s <= 30; s++) {
      assert.equal(
        stepExecutionCounts.get(s),
        1,
        `Step ${s} must have executed exactly 1 time across pause + compacted resume`
      );
    }

    assert.equal(ledger.verifyChainIntegrity(), true);
    assert.ok(
      ledger
        .getBlocks()
        .some((b) => b.actionType === 'EVENT_COMPACTION_COMMITTED')
    );
  });

  it('12. (G7) Multi-turn task-mode AcrAgentNode + isolationScope: true + TrajectoryThoughtPruningCompactor({ eventRetentionSize: 2 }) + FinishTaskTool & ExitLoopTool', async () => {
    const thoughtCompactor = new TrajectoryThoughtPruningCompactor({
      eventRetentionSize: 2,
    });

    const squad = createTestSquad();
    let turnCounter = 0;

    const finishTaskTool = new FinishTaskTool({
      outputSchema: {
        safeParse: (val: unknown) => {
          if (
            typeof val === 'object' &&
            val !== null &&
            typeof (val as { summary?: unknown }).summary === 'string' &&
            typeof (val as { verified?: unknown }).verified === 'boolean'
          ) {
            return {
              success: true as const,
              data: val as { summary: string; verified: boolean },
            };
          }
          return {
            success: false as const,
            error: {
              issues: [{ path: [], message: 'Expected { summary, verified }' }],
              message: 'Expected { summary: string, verified: boolean }',
            },
          };
        },
      },
    });

    const taskAgentNode = new AcrAgentNode({
      name: 'sre_task_investigator',
      agent: squad.agents[0],
      mode: 'task',
      maxSteps: 6,
      isolationScope: true,
      compactor: thoughtCompactor,
      tools: [finishTaskTool],
      outputSchema: finishTaskTool.outputSchema,
      taskStep: async ({ step, emitThought, callTool }) => {
        turnCounter = step;
        emitThought(
          `Internal chain-of-thought for turn ${step}`,
          `Step ${step} diagnostic progress`
        );

        if (step >= 4) {
          await callTool('finish_task', {
            result: {
              summary: 'Root cause isolated in shard-3',
              verified: true,
            },
          });
        }
      },
    });

    const wf = new Workflow({
      name: 'g7_task_mode_wf',
      edges: [[START, taskAgentNode]],
    });

    const res = await executeWorkflow<{ summary: string; verified: boolean }>(
      wf,
      'Investigate shard-3 latency'
    );

    assert.equal(res.paused, false);
    assert.equal(turnCounter, 4);
    assert.deepEqual(res.output, {
      summary: 'Root cause isolated in shard-3',
      verified: true,
    });

    // Verify TrajectoryThoughtPruningCompactor pruned older thoughts while preserving the most recent window
    const eventsWithThoughts = res.session.events.filter((ev) =>
      (ev.content?.parts ?? []).some((p) => p.thought === true)
    );
    const allThoughtEventsEmitted = res.session.events.filter((ev) =>
      (ev.content?.parts ?? []).some((p) =>
        p.text?.startsWith('Step ')
      )
    );
    assert.equal(allThoughtEventsEmitted.length, 4);
    assert.ok(
      eventsWithThoughts.length <= 2,
      `Expected at most 2 events to retain thoughts, got ${eventsWithThoughts.length}`
    );

    // Verify filterByIsolationScope hides isolation-scoped internal events from an out-of-scope consumer
    const scopedEvents = res.session.events.filter(
      (e) => e.isolationScope !== undefined
    );
    assert.ok(scopedEvents.length > 0);
    const visibleToOutOfScope = filterByIsolationScope(
      res.session.events,
      'external_consumer_scope'
    );
    assert.equal(
      visibleToOutOfScope.some(
        (e) => e.isolationScope === scopedEvents[0].isolationScope
      ),
      false,
      'Internal events with isolationScope must be hidden from external scopes'
    );

    // Verify ExitLoopTool sets actions.escalate = true and actions.skipSummarization = true
    const exitTool = new ExitLoopTool();
    const loopActions = createEventActions();
    await exitTool.runAsync({
      args: {},
      toolContext: {
        invocationContext: createInvocationContext({
          invocationId: 'inv-exit',
          session: res.session,
        }),
        state: new State(),
        actions: loopActions,
      },
    });
    assert.equal(loopActions.escalate, true);
    assert.equal(loopActions.skipSummarization, true);
  });

  it('13. (G8) Predecessor reference injection (<Plan.steps from planner>, <Plan.riskScore from planner>) across CompactedEvent.checkpointManifest.outputsByNode + RoutedAgent deterministic routing', async () => {
    const compactor = new AnchoredContextCompactor({
      tokenThreshold: 1,
      eventRetentionSize: 1,
    });

    const squad = createTestSquad();

    const plannerNode = new FunctionNode(
      'planner',
      async (ctx: NodeContext) => {
        // Emit extra events and compact inside the workflow so planner output lives in CompactedEvent.checkpointManifest.outputsByNode
        ctx.session.events.push(
          createEvent({
            invocationId: ctx.invocationId,
            author: 'planner',
            output: {
              steps: ['drain-canary', 'verify-quorum', 'promote-blue'],
              riskScore: 88,
            },
            nodeInfo: {
              path: 'g8_predecessor_routed_wf.planner',
              runId: '1',
            },
            content: toContent('Planner produced structured remediation plan'),
          }),
          createEvent({
            invocationId: ctx.invocationId,
            author: 'telemetry_collector',
            content: toContent(' intermediate telemetry 1 '),
          }),
          createEvent({
            invocationId: ctx.invocationId,
            author: 'telemetry_collector',
            content: toContent(' intermediate telemetry 2 '),
          })
        );
        await compactor.compact(ctx.invocationContext);
        return {
          steps: ['drain-canary', 'verify-quorum', 'promote-blue'],
          riskScore: 88,
        };
      }
    );

    const synthesizerAgent = new AcrAgentNode({
      name: 'synthesizer',
      agent: squad.agents[0],
      instruction:
        'Execute steps=<Plan.steps from planner> with risk=<Plan.riskScore from planner>',
      deliberate: async (_ctx, _input, resolvedInstruction) => ({
        reasoning: resolvedInstruction,
        proposedHypothesis: 'high_risk',
        confidence: 0.88,
      }),
    });

    const highRiskMitigator = new FunctionNode(
      'high_risk_mitigator',
      async (_ctx: NodeContext, input: { reasoning: string; confidence: number }) => ({
        routedTo: 'high_risk_mitigator',
        instructionSeen: input.reasoning,
        riskScore: Math.round(input.confidence * 100),
      })
    );

    const lowRiskFastTrack = new FunctionNode(
      'low_risk_fast_track',
      async (_ctx: NodeContext, input: { reasoning: string; confidence: number }) => ({
        routedTo: 'low_risk_fast_track',
        instructionSeen: input.reasoning,
        riskScore: Math.round(input.confidence * 100),
      })
    );

    const routerNode = new RoutedAgent({
      name: 'risk_router',
      agents: {
        high_risk: highRiskMitigator,
        low_risk: lowRiskFastTrack,
      },
      router: (_agents, _ic, input) => {
        const data = input as { confidence?: number } | undefined;
        return (data?.confidence ?? 0) >= 0.75 ? 'high_risk' : 'low_risk';
      },
    });

    const wf = new Workflow({
      name: 'g8_predecessor_routed_wf',
      edges: [
        [START, plannerNode],
        [plannerNode, synthesizerAgent],
        [synthesizerAgent, routerNode],
      ],
    });

    const res = await executeWorkflow<{
      routedTo: string;
      instructionSeen: string;
      riskScore: number;
    }>(wf, {});

    assert.equal(res.paused, false);
    assert.equal(res.output?.routedTo, 'high_risk_mitigator');
    assert.equal(
      res.output?.instructionSeen,
      'Execute steps=["drain-canary","verify-quorum","promote-blue"] with risk=88'
    );
  });

  it('14. (G9) WalGuardedReflectRetryPlugin & ToolCallIntegrityPlugin: self-heals pre-dispatch schema errors, blocks blind retry on DISPATCHED/OUTCOME_UNKNOWN WAL records, and rejects tampered functionCall HMAC before tool execution', async () => {
    const wal = new DurableCommandWal<{ status: string }>();
    const ledger = new CryptographicAuditLedger();
    const secretKey = 'g9-hmac-secret-key-2026-acr-opsroom';

    const walReflectPlugin = new WalGuardedReflectRetryPlugin({
      wal,
      maxRetries: 2,
    });
    const integrityPlugin = new ToolCallIntegrityPlugin({
      secretKey,
      verifyBeforeToolExecution: true,
    });

    const pluginManager = new PluginManager([integrityPlugin, walReflectPlugin]);

    // Case A: Pre-dispatch schema error (no WAL record yet) -> WalGuardedReflectRetryPlugin returns reflection guidance so LLM can self-heal
    let toolCallAttempt = 0;
    class DeployCanaryTool extends BaseTool {
      constructor() {
        super({
          name: 'k8s.deploy_canary',
          description: 'Deploys canary release',
        });
      }
      override async runAsync(req: RunAsyncToolRequest): Promise<unknown> {
        toolCallAttempt += 1;
        if (toolCallAttempt === 1 && !req.args['namespace']) {
          throw new Error('SchemaValidationError: missing required field "namespace"');
        }
        return { deployed: true, namespace: req.args['namespace'] };
      }
    }

    const deployTool = new DeployCanaryTool();
    const sessionA = {
      id: 'sess-g9-a',
      appName: 'acr-opsroom',
      userId: 'operator-1',
      state: {},
      events: [] as Event[],
    };
    const icA = createInvocationContext({
      invocationId: 'inv-g9-a',
      session: sessionA,
      pluginManager,
      auditLedger: ledger,
    });

    // Emit and sign valid functionCall event
    const callEventA1 = createEvent({
      invocationId: icA.invocationId,
      author: 'agent',
      content: {
        role: 'model',
        parts: [
          {
            functionCall: {
              id: 'fc-g9-1',
              name: 'k8s.deploy_canary',
              args: { image: 'acr:v2' },
            },
          },
        ],
      },
    });
    await pluginManager.runOnEventCallback({
      invocationContext: icA,
      event: callEventA1,
    });
    assert.ok(callEventA1.customMetadata?.[TOOL_CALL_HMAC_METADATA_KEY]);
    sessionA.events.push(callEventA1);

    const toolNodeA1 = new ToolNode(deployTool, {
      name: 'run_deploy_a1',
    });
    const wfA1 = new Workflow({
      name: 'g9_wf_a1',
      edges: [[START, toolNodeA1]],
    });
    const resA1 = await executeWorkflow<Record<string, unknown>>(
      wfA1,
      { image: 'acr:v2' },
      {
        invocationId: icA.invocationId,
        session: sessionA,
        pluginManager,
        auditLedger: ledger,
      }
    );
    assert.equal(
      resA1.output?.['response_type'],
      'ERROR_HANDLED_BY_REFLECT_AND_RETRY_PLUGIN'
    );
    assert.equal(resA1.output?.['retry_count'], 1);

    // Case B: Side-effecting call already DISPATCHED / OUTCOME_UNKNOWN in DurableCommandWal -> blocks blind LLM retry!
    wal.planCommand({
      commandId: 'wal:g9_wal_plugin_wf:dispatched_side_effect:1',
      runId: 'g9_wal_plugin_wf',
      stepId: 'dispatched_side_effect',
      toolName: 'k8s.deploy_canary',
      actionKind: 'git_push',
      canonicalArgs: JSON.stringify({ image: 'acr:v2', namespace: 'prod' }),
    });
    wal.markDispatched('wal:g9_wal_plugin_wf:dispatched_side_effect:1');

    // Now the WAL has a DISPATCHED record for k8s.deploy_canary -> WalGuardedReflectRetryPlugin blocks blind retry
    const reconcileResponse = await walReflectPlugin.onToolErrorCallback({
      tool: deployTool,
      toolArgs: { image: 'acr:v2', namespace: 'prod' },
      toolContext: {
        invocationContext: icA,
        state: new State(),
        functionCallId: 'fc-g9-2',
      },
      error: new Error('ECONNRESET: socket hang up after dispatch'),
    });

    assert.ok(reconcileResponse);
    assert.equal(
      reconcileResponse?.['response_type'],
      SIDE_EFFECT_RECONCILIATION_REQUIRED_TYPE
    );
    assert.equal(reconcileResponse?.['blind_retry_blocked'], true);
    assert.equal(reconcileResponse?.['retry_blocked'], true);
    assert.equal(reconcileResponse?.['wal_state'], 'DISPATCHED');
    assert.ok(
      ledger
        .getBlocks()
        .some((b) => b.actionType === 'SIDE_EFFECT_RECONCILIATION_REQUIRED')
    );

    // Case C: Tampered functionCall args in session history -> ToolCallIntegrityPlugin throws ToolCallIntegrityError before tool execution!
    let tamperedToolExecuted = false;
    class SensitiveDeleteTool extends BaseTool {
      constructor() {
        super({ name: 'db.drop_shard', description: 'Drops shard' });
      }
      override async runAsync(): Promise<unknown> {
        tamperedToolExecuted = true;
        return { dropped: true };
      }
    }
    const sensitiveTool = new SensitiveDeleteTool();
    const signedCallEvent = createEvent({
      invocationId: 'inv-g9-c',
      author: 'agent',
      content: {
        role: 'model',
        parts: [
          {
            functionCall: {
              id: 'fc-tamper-1',
              name: 'db.drop_shard',
              args: { shard: 'staging-sandbox' },
            },
          },
        ],
      },
    });
    integrityPlugin.signEvent(icA, signedCallEvent);

    // Attacker mutates the signed functionCall args in session history from staging-sandbox to prod-primary
    signedCallEvent.content!.parts![0].functionCall!.args = {
      shard: 'prod-primary',
    };
    signedCallEvent.customMetadata = {
      ...signedCallEvent.customMetadata,
      [RESTORED_EVENT_KEY]: true,
    };

    const sessionC = {
      id: sessionA.id,
      appName: 'acr-opsroom',
      userId: 'operator-1',
      state: {},
      events: [signedCallEvent],
    };

    const toolNodeTampered = new ToolNode(sensitiveTool, {
      name: 'run_tampered_tool',
    });
    const wfTampered = new Workflow({
      name: 'g9_tampered_wf',
      edges: [[START, toolNodeTampered]],
    });

    await assert.rejects(
      () =>
        executeWorkflow(
          wfTampered,
          { shard: 'prod-primary' },
          {
            invocationId: 'inv-g9-c',
            session: sessionC,
            pluginManager,
            auditLedger: ledger,
          }
        ),
      (err: unknown) => {
        assert.ok(err instanceof ToolCallIntegrityError);
        return true;
      }
    );
    assert.equal(tamperedToolExecuted, false);
    assert.ok(
      ledger
        .getBlocks()
        .some((b) => b.actionType === 'TOOL_CALL_INTEGRITY_VIOLATION')
    );
  });

  it('15. (G10) Authority-propagating subWorkflow.asTool() (NodeTool) + buildAbortEvents + Atlas2GraphWorkflow.rewindToCheckpoint', async () => {
    // Part A: subWorkflow.asTool() propagates parent workflowId, graphTopologyHash, scoped nodePath, and elevated CONSENT_ELEVATED authority
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const operatorDid = 'did:key:z6MkG10Operator';
    const gate = new ApprovalGate([operatorDid]);
    const challengeStore = new ConsentChallengeStore();

    const childConsentNode = new PasskeyConsentNode({
      name: 'nested_consent',
      approvalGate: gate,
      challengeStore,
      publicKey,
      operatorDid,
      actionId: 'g10_nested_action',
      actionType: 'vault.unseal',
      targetResourceUri: 'vault://prod-root',
      resourceVersion: 'v1',
      policyRevision: 'pol-g10',
      parameters: { quorum: 1 },
    });

    const childVerifyNode = new FunctionNode(
      'child_verify',
      async (ctx: NodeContext) => ({
        childAuthority: ctx.executionAuthority,
        childWorkflowId: ctx.workflowId,
        childTopologyHash: ctx.graphTopologyHash,
      })
    );

    const subWorkflow = new Workflow({
      name: 'sub_consent_wf',
      edges: [
        [START, childConsentNode],
        [childConsentNode, { authorized: childVerifyNode }],
      ],
    });

    const subWorkflowTool = subWorkflow.asTool({
      name: 'invoke_sub_consent_wf',
      description: 'Runs nested consent sub-workflow as a tool',
    });

    const parentToolNode = new ToolNode(subWorkflowTool, {
      name: 'call_sub_wf_tool',
    });

    const parentAfterTool = new FunctionNode(
      'parent_after_tool',
      async (ctx: NodeContext, input: unknown) => ({
        parentAuthorityAfterSubWf: ctx.executionAuthority,
        subWfResult: input,
      })
    );

    const parentWf = new Workflow({
      name: 'g10_parent_wf',
      edges: [
        [START, parentToolNode],
        [parentToolNode, parentAfterTool],
      ],
    });

    // Run 1: pauses inside subWorkflow.asTool() and propagates interruptId up to parent
    const pauseRes = await executeWorkflow(parentWf, {}, { invocationId: 'g10-inv-1' });
    assert.equal(pauseRes.paused, true);
    assert.equal(pauseRes.interruptIds.length, 1);

    const interruptId = pauseRes.interruptIds[0];
    const challengeKey = Object.keys(pauseRes.session.state).find((k) =>
      k.startsWith('__consent_challenge:')
    )!;
    const storedChallenge = pauseRes.session.state[challengeKey] as {
      challenge_nonce: string;
      resource_version: string;
      workflow_id: string;
      graph_topology_hash: string;
      node_path: string;
    };

    // Verify nested NodeTool bound the challenge to the parent's workflowId and graphTopologyHash!
    assert.equal(storedChallenge.workflow_id, 'g10_parent_wf');
    assert.equal(storedChallenge.graph_topology_hash, parentWf.topologyHash);

    const nowMs = Date.now();
    const reqHash = computeRequestCanonicalHash({
      action_type: 'vault.unseal',
      target_resource_uri: 'vault://prod-root',
      resource_version: storedChallenge.resource_version,
      policy_revision: 'pol-g10',
      parameters: { quorum: 1 },
    });
    const signedEnvelope = signPasskeyConsentEnvelope(
      {
        consent_id: 'g10-consent-1',
        operator_did: operatorDid,
        authenticator_id: 'passkey-g10',
        challenge_nonce: storedChallenge.challenge_nonce,
        request_canonical_hash: reqHash,
        action_type: 'vault.unseal',
        target_resource_uri: 'vault://prod-root',
        resource_version: storedChallenge.resource_version,
        policy_revision: 'pol-g10',
        issued_at: nowMs,
        expires_at: nowMs + 60_000,
        max_invocations: 1,
      },
      privateKey
    );
    const decision: SignedDecision = {
      action_id: 'g10_nested_action',
      verdict: 'approve',
      reason: 'Approved nested sub-workflow consent',
      decider: operatorDid,
      decided_at: new Date(nowMs).toISOString(),
      signature: signedEnvelope.signature,
    };

    const resumeRes = await executeWorkflow<{
      parentAuthorityAfterSubWf: string;
      subWfResult: {
        childAuthority: string;
        childWorkflowId: string;
        childTopologyHash: string;
      };
    }>(parentWf, undefined, {
      invocationId: 'g10-inv-2',
      session: pauseRes.session,
      interruptResponses: {
        [interruptId]: {
          decision,
          envelope: signedEnvelope,
          workflow_id: 'g10_parent_wf',
          graph_topology_hash: parentWf.topologyHash,
          node_path: storedChallenge.node_path,
          now_ms: nowMs,
        },
      },
    });

    assert.equal(resumeRes.paused, false);
    assert.equal(resumeRes.executionAuthority, 'CONSENT_ELEVATED');
    assert.equal(resumeRes.output?.parentAuthorityAfterSubWf, 'CONSENT_ELEVATED');
    assert.equal(resumeRes.output?.subWfResult.childAuthority, 'CONSENT_ELEVATED');
    assert.equal(resumeRes.output?.subWfResult.childWorkflowId, 'g10_parent_wf');
    assert.equal(
      resumeRes.output?.subWfResult.childTopologyHash,
      parentWf.topologyHash
    );

    // Part B: AbortSignal mid-invocation emits synthetic { aborted: true } functionResponse + INVOCATION_ABORTED event via buildAbortEvents
    const abortController = new AbortController();
    const abortingNode = new FunctionNode(
      'aborting_node',
      async (ctx: NodeContext) => {
        ctx.session.events.push(
          createEvent({
            invocationId: ctx.invocationId,
            author: 'aborting_node',
            content: {
              role: 'model',
              parts: [
                {
                  functionCall: {
                    id: 'fc-inflight-abort-1',
                    name: 'long_running_query',
                    args: { query: 'SELECT * FROM spans' },
                  },
                },
              ],
            },
          })
        );
        abortController.abort('operator_cancelled');
        throw new InvocationAbortedError('Aborted by operator');
      }
    );

    const abortWf = new Workflow({
      name: 'g10_abort_wf',
      edges: [[START, abortingNode]],
    });

    const abortSession = {
      id: 'sess-g10-abort',
      state: {},
      events: [] as Event[],
    };
    await executeWorkflow(abortWf, {}, {
      invocationId: 'g10-abort-inv',
      session: abortSession,
      abortSignal: abortController.signal,
    });

    const abortResponseEvent = abortSession.events.find((e) =>
      (e.content?.parts ?? []).some(
        (p) =>
          p.functionResponse?.id === 'fc-inflight-abort-1' &&
          (p.functionResponse?.response as { aborted?: boolean })?.aborted === true
      )
    );
    assert.ok(
      abortResponseEvent,
      'buildAbortEvents must emit synthetic { aborted: true } functionResponse for open functionCall'
    );
    const terminalAbortEvent = abortSession.events.find(
      (e) => e.errorCode === 'INVOCATION_ABORTED'
    );
    assert.ok(
      terminalAbortEvent,
      'buildAbortEvents must emit terminal INVOCATION_ABORTED event'
    );

    // Part C: Atlas2GraphWorkflow.rewindToCheckpoint appends compensating WORKFLOW_CHECKPOINT_REWIND without breaking hash chain integrity
    const squad = createTestSquad();
    const incident = Atlas2Engine.createIncident(
      'G10 Rewind Test Incident',
      'Testing compensating checkpoint rewind',
      squad
    );
    const atlasWf = Atlas2Engine.compileExecutionGraph(
      incident,
      'Rewindable remediation goal'
    );
    const rewindLedger = new CryptographicAuditLedger();
    const rewindSession = {
      id: 'sess-g10-rewind',
      state: {},
      events: [
        createEvent({
          invocationId: 'g10-rewind-inv',
          author: 'step_1',
          output: { status: 'checkpoint_1_ok' },
          nodeInfo: {
            path: 'g10_rewind.step_1',
            runId: '1',
          },
          content: toContent('Step 1 completed'),
        }),
        createEvent({
          invocationId: 'g10-rewind-inv',
          author: 'step_2',
          output: { status: 'step_2_bad_branch' },
          nodeInfo: {
            path: 'g10_rewind.step_2',
            runId: '1',
          },
          content: toContent('Step 2 diverged'),
        }),
      ],
    };

    const rewindEvent = atlasWf.rewindToCheckpoint({
      session: rewindSession,
      auditLedger: rewindLedger,
      invocationId: 'g10-rewind-inv',
      targetNodePath: 'g10_rewind.step_1',
      targetRunId: '1',
      actorDid: operatorDid,
      reason: 'Compensating rewind to step_1 checkpoint',
    });

    assert.ok(isCompactedEvent(rewindEvent));
    assert.ok(
      rewindEvent.checkpointManifest?.runsByPath['g10_rewind.step_1'],
      'Target checkpoint step_1 must remain in checkpointManifest'
    );
    assert.equal(
      rewindEvent.checkpointManifest?.runsByPath['g10_rewind.step_2'],
      undefined,
      'Post-checkpoint step_2 must be excluded from active checkpointManifest'
    );
    assert.equal(rewindLedger.verifyChainIntegrity(), true);
    assert.ok(
      rewindLedger
        .getBlocks()
        .some((b) => b.actionType === 'WORKFLOW_CHECKPOINT_REWIND')
    );
  });
});
