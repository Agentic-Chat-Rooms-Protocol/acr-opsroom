# Architecture Specification - ACR OpsRoom

## Executive Summary
**ACR OpsRoom** is the autonomous operations war room and Byzantine deliberation engine for enterprise AI agents. It represents the architectural evolution beyond Salesforce Agentforce and Slack AI by introducing:
1. **Goal-Directed DAG Planning (Atlas 2.0)** instead of brittle single-agent prompt-chaining.
2. **Byzantine Fault Tolerant (BFT) Quorum Consensus** ($M$-of-$N$ weighted supermajority with Ed25519 W3C DID signatures) ensuring no rogue or hallucinating agent alters production state without verified peer agreement.
3. **ToolHive-Inspired Zero-Trust Sandboxing** via `acr-meta-mcp` (process isolation, `no-network`, `egress-allowlist`, and `workspace-scoped` containment).
4. **Live Dynamic Ops Canvas & Real-Time Huddle Fabric** providing bi-directional telemetry binding, structured action items, execution DAG status, and autonomous multi-agent synthetic huddle summaries.
5. **Immutable Merkle Audit Ledger** establishing cryptographic provenance for every prompt, tool invocation, ballot, and execution result.

---

## 1. Architectural Topology

```
+-------------------------------------------------------------------------+
|                            ACR OpsRoom Client                           |
|       (Hyper-Premium WCAG 2.2 AAA Web App / React 19 + GSAP + Vite)     |
+------------------------------------+------------------------------------+
                                     | REST (Port 20447) / SSE Stream
                                     v
+------------------------------------+------------------------------------+
|                         @acr-js/opsroom-server                          |
|         (Fastify / Node HTTP & Server-Sent Events Gateway)             |
+------------------------------------+------------------------------------+
                                     |
                                     v
+------------------------------------+------------------------------------+
|                          @acr-js/opsroom-core                           |
|  +---------------------+  +--------------------+  +------------------+  |
|  |   Atlas 2.0 Engine  |  |  Byzantine Quorum  |  |   ML Statistical |  |
|  |  (State Machine DAG)|  | (M-of-N Consensus) |  |   Anomaly Router |  |
|  +----------+----------+  +---------+----------+  +--------+---------+  |
|             |                       |                      |            |
|             +-----------------------+----------------------+            |
|                                     |                                   |
|  +---------------------+  +---------+----------+  +------------------+  |
|  |  Live Ops Canvas    |  |  Synthetic Huddle  |  |  Cryptographic   |  |
|  |     Manager         |  |      Fabric        |  |  Audit Ledger    |  |
|  +---------------------+  +--------------------+  +------------------+  |
+------------------------------------+------------------------------------+
                                     |
                                     v
+------------------------------------+------------------------------------+
|                      acr-meta-mcp (Port 20445)                          |
|            (ToolHive Micro-Sandboxing & Multi-Cipher Auth Vault)        |
+------------------------------------+------------------------------------+
                                     |
                                     v
+------------------------------------+------------------------------------+
|                        acr-core (Port 20443)                            |
|             (NATS JetStream Bus & W3C DID Ed25519 Identity)             |
+-------------------------------------------------------------------------+
```

---

## 2. Core Subsystems

### A. Atlas 2.0 State Machine
Unlike Salesforce Atlas 1.0 (which relies on single-turn prompt chaining that easily loops or misinterprets customer data), Atlas 2.0 traverses an explicit state machine:
- **Phase 1: Sensing**: Evaluates real-time telemetry metrics using both parametric (Z-score) and non-parametric (IQR) anomaly bounds.
- **Phase 2: Grounding**: Ingests ambient context from system logs, git commit diffs, database WAL metrics, and available MCP tools.
- **Phase 3: Squad Deliberation**: Coordinates a specialized squad of agents (Orchestrator, SRE, SecOps, DataOps, FinOps) that debate root cause hypotheses and propose mitigation tools.
- **Phase 4: Byzantine Quorum Consensus**: Each agent casts an Ed25519-signed ballot. Requires a 2/3 weighted supermajority to approve execution.
- **Phase 5: Sandboxed Preflight & Execution**: Simulates preflight dry-runs and executes tools inside isolated micro-containers.
- **Phase 6: Verification & Projection**: Re-measures telemetry delta post-execution and updates the Live Ops Canvas.

### B. Byzantine Quorum Consensus
- Weighted voting: Agents have calibrated vote weights ($w_i$) and confidence scores ($c_i$).
- Consensus score formula:
  $$\text{Score} = \frac{\sum_{\text{approve}} w_i \cdot c_i}{\sum_{\text{decided}} w_i \cdot c_i} \ge 0.67$$
- Detects Byzantine anomalies: tampered DIDs, negative confidence values, ungrounded inversions, and out-of-bounds metrics.
- Dual-Consent Escalation: If high-risk tools (e.g. DNS failover, database truncate, credential invalidation) are proposed, or if Byzantine behavior is detected, the state machine halts and alerts human commanders.

### C. Live Dynamic Ops Canvas
- Replaces static Slack Canvases with reactive, bi-directional field bindings.
- Tracks live traffic impact %, error rate spikes, estimated cost drift, and active MCP sandbox profiles.
- Maintained under cryptographic Merkle root hashes updated after every mutation.

### D. Zero-Trust Sandbox Isolation
- Bridges to `acr-meta-mcp` (Port 20445).
- Four sandboxing profiles:
  1. `no-network`: Complete network isolation for pure computation and cryptographic operations.
  2. `egress-allowlist`: Explicit firewall egress allowed only to verified telemetry and API endpoints.
  3. `readonly-fs`: Prevents disk persistence and tampering.
  4. `workspace-scoped`: File mutations restricted to a temporary chroot / ephemeral workspace directory.

---

## 3. Canonical Workflow Orchestration (RFC-0001 through RFC-0018)

Atlas 2.0 schedules and executes 18 canonical operational workflows across the ACR ecosystem:

| # | Workflow ID | Category | Protocol RFC | Operational Focus |
|---|---|---|---|---|
| 1 | `postgres-split-brain` | Infrastructure & DB | RFC-0016 / RFC-0002 | PostgreSQL follower isolation and standby read failover |
| 2 | `egress-token-anomaly` | SecOps & Zero-Trust | RFC-0018 / RFC-0021 | Exfiltration detection, container quarantine & key revocation |
| 3 | `ingress-oom-autoscaling` | Cloud & Compute | RFC-0016 / ToolHive | Pod heap exhaustion auto-recovery and rate shedding |
| 4 | `canary-deployment-rollback` | CI/CD & Rollout | RFC-0016 / RFC-0012 | Automated canary analysis and ingress rollback to stable checkpoint |
| 5 | `code-review-tla-verification` | Quality & Formal Methods | RFC-0002 / TLA+ | AST diff security review and formal TLA+ deadlock proof |
| 6 | `saif-compliance-audit` | Compliance & Security | RFC-0018 / RFC-0019 | Google SAIF alignment and WASI execution fuel cap enforcement |
| 7 | `bft-consensus-deliberation` | Governance & Consensus | RFC-0002 / RFC-0012 | 67% Byzantine supermajority voting with immutable dissent logging |
| 8 | `twinseal-passkey-approval` | Human-in-the-Loop | RFC-0012 / WebAuthn | Dual-consent passkey gate freezing high-risk DAG transitions |
| 9 | `durable-wal-recovery` | Data & Engine Lifecycles | RFC-0016 / ADR-0041 | Write-ahead command log replay and DAG idempotency reconcile |
| 10 | `context-compaction-pruning` | Memory & Context | RFC-0015 / RFC-0020 | Scratchpad pruning and high-entropy RVF vector compaction |
| 11 | `byzantine-fault-slashing` | Security & Reputation | RFC-0014 / RFC-0021 | Rogue agent detection and Wilson reputation score slashing |
| 12 | `identity-key-rotation` | Identity & Key Management | RFC-0013 / W3C DID Core | Continuous DID signing key rotation with signed audit lineage |
| 13 | `micro-sandbox-isolation` | Process Isolation | RFC-0018 / Onyxbox | 15-minute auto-purge ToolHive micro-container isolation |
| 14 | `cross-model-agentflex-synthesis` | Cognitive Architecture | RFC-0002 / Agentflex | Multi-model proposal synthesis (Claude + GPT + Gemini) |
| 15 | `declarative-step-playbook` | Workflow Automation | RFC-0016 / PlaybookRun | Structured JSON step execution with retry policies and parking |
| 16 | `postguard-injection-defense` | Prompt Security | RFC-0019 / Postguard | Inbound prompt screening and tool output sanitization |
| 17 | `dynamic-dag-topology` | Graph Scheduling | RFC-0016 / ADK 2.0 | Dynamic runtime dependency reordering and JoinNode barriers |
| 18 | `transitive-trust-federation` | Identity Federation | RFC-0017 / Web of Trust | Transitive peer endorsement traversal using breadth-first search |
