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
