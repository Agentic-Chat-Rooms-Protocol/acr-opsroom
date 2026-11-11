# Atlas 2.0 Dynamic DAG & Long-Horizon Workflow Specification

## 1. Motivation: The Limits of Atlas 1.0
Salesforce's Atlas 1.0 engine relies on linear topic classification and single-agent prompt chaining. Rigid topic buckets misroute cross-domain production incidents, while single-agent chains lack adversarial deliberation or a cryptographic quorum check before executing mutating tools. Unbounded prompt loops and blind tool retries risk duplicate external mutations when an API times out after dispatch. Naive history truncation also drops node checkpoints on long runs, forcing completed steps to re-execute after a human-in-the-loop pause.

## 2. Atlas 2.0 Dynamic DAG Architecture
**Atlas 2.0** compiles incident remediation (`Atlas2Engine.compileExecutionGraph()`) and operational playbooks (`PlaybookRun.toWorkflow()`) into a content-addressed **Atlas 2.0 Dynamic DAG** governed by a formal state machine and RFC 8785 JCS `topologyHash`:

```text
[Detecting]
    |
    v (Parametric Z-Score & Non-Parametric IQR Anomaly Detection)
[Deliberating: Multi-Turn task-Mode AcrAgentNode + RoutedAgent]
    |
    v (67% Consensus Gate Signed by W3C Ed25519 DIDs)
[ByzantineQuorumNode]
    |
    +--> If Quorum Approved (>=67%) --> [WalBackedToolNode / SandboxedExecutionNode] --> [Resolved]
    |
    +--> If High/Critical Risk -------> [PasskeyConsentNode (WebAuthn Envelope)] ------> [Executing]
```

## 3. Core Technical Mechanisms

### 3.1 Static + Dynamic Graph Scheduling (`Workflow` & `DynamicNodeScheduler`)
Supports sequential chains, parallel fan-out branches, `JoinNode` fan-in barriers, conditional routes, and runtime `ctx.runNode()` dynamic loops with `ParallelWorker` concurrency limits. Rejects unconditional cycles at build time via 3-color DFS (`detectUnconditionalCycles`) while permitting conditional review loops.

### 3.2 Checkpoint-Safe Context Compaction & $O(1)$ Dynamic Rehydration
`AnchoredContextCompactor`, `TokenBasedContextCompactor`, `AgentControlledContextCompactor`, and `TrajectoryThoughtPruningCompactor` compress long trajectories into a `CompactedEvent`. Every `CompactedEvent` embeds `compactedEventIds` and a `checkpointManifest` (`runsByPath`, `outputsByNode`, `highestAuthority`), preserving `@runId` checkpoints and `executionAuthority` levels across HITL pauses (`eventsForCurrentRun`) with $O(1)$ per-node rehydration lookup.

### 3.3 Multi-Turn `task`-Mode `AcrAgentNode` & Predecessor Injection
Runs autonomous multi-step sub-tasks (`mode: 'task'`) equipped with `FinishTaskTool`, `ExitLoopTool`, and `isolationScope` scratchpad filtering (`filterByIsolationScope`). Resolves `<Class.field from node>` predecessor references across both active events and `CompactedEvent.checkpointManifest.outputsByNode`.

### 3.4 WAL-Guarded Reflection Retries & Cryptographic Tool-Call Integrity
`WalGuardedReflectRetryPlugin` allows self-healing LLM reflection retries on pre-dispatch schema errors up to `maxRetries`, but checks `DurableCommandWal` (`DISPATCHED` / `OUTCOME_UNKNOWN`) to block blind retries on already-dispatched side effects (`SIDE_EFFECT_RECONCILIATION_REQUIRED`). `ToolCallIntegrityPlugin` signs every `functionCall` with `"v1:" + HMAC-SHA256` (`__adk_internal_fc_hmac`) and verifies signatures via constant-time `timingSafeEqualHex` before tool execution.

### 3.5 Authority-Propagating `NodeTool` & Compensating Checkpoint Rewind
`subWorkflow.asTool()` propagates parent `workflowId`, `graphTopologyHash`, scoped `nodePath`, and `CONSENT_ELEVATED` authority across nested sub-workflows. `Atlas2GraphWorkflow.rewindToCheckpoint()` appends a compensating `CompactedEvent` and a `WORKFLOW_CHECKPOINT_REWIND` block to `CryptographicAuditLedger` without truncating the append-only Merkle hash chain.

