# REST & SSE API Reference - ACR OpsRoom

**Default Base URL:** `http://localhost:20447`

---

## 1. System Endpoints

### `GET /health`
Returns service status, active incident count, and timestamp.

**Response:**
```json
{
  "status": "online",
  "service": "acr-opsroom",
  "version": "1.0.0",
  "activeIncidents": 1,
  "squadsAvailable": 3,
  "timestamp": 1726456000000
}
```

### `GET /api/v1/opsroom/battlecard`
Returns the competitive battlecard comparing ACR OpsRoom to Salesforce Agentforce.

---

## 2. Real-Time Streaming

### `GET /api/v1/opsroom/stream`
Server-Sent Events (SSE) connection streaming real-time operational events.
- `INCIDENT_TRIGGERED`
- `DELIBERATION_TURN`
- `CONSENSUS_BALLOT`
- `QUORUM_EVALUATED`
- `EXECUTION_COMPLETED`

---

## 3. Incident Management

### `POST /api/v1/opsroom/incidents/trigger`
Triggers an autonomous operational incident with ML anomaly routing and optional canonical workflow initialization.

**Request Body:**
```json
{
  "title": "Postgres Replication Lag Spike",
  "description": "Follower db-replica-03 lagging by 8,420ms",
  "telemetry": [15, 14, 18, 16, 8420],
  "workflowType": "postgres-split-brain",
  "workflowConfig": {
    "drainGraceSec": 5,
    "failoverTarget": "read-replica-01"
  }
}
```

### `POST /api/v1/opsroom/incidents/:id/deliberate`
Submits a specialized agent deliberation turn.

### `POST /api/v1/opsroom/incidents/:id/vote`
Submits an Ed25519-signed consensus ballot.

### `POST /api/v1/opsroom/incidents/:id/evaluate-quorum`
Evaluates the Byzantine Quorum (checks for 67% supermajority and flags anomalies).

### `POST /api/v1/opsroom/incidents/:id/execute`
Executes the approved plan inside zero-trust ToolHive sandboxes.

**Request Body:**
```json
{
  "humanApproved": true
}
```

### `GET /api/v1/opsroom/incidents/:id/audit-cert`
Generates and downloads a cryptographically chained SOC2 / ISO27001 audit certificate.

---

## 4. Canonical Operational Workflows (RFC-0001 through RFC-0018)

ACR OpsRoom coordinates 18 canonical operational workflows with Atlas 2.0 Dynamic DAG scheduling and Byzantine quorum consensus:

| # | Workflow ID | Category | Protocol Spec | Primary Outcome |
|---|---|---|---|---|
| 1 | `postgres-split-brain` | Infrastructure & DB | RFC-0016 / RFC-0002 | Isolates lagging follower replica and reroutes read traffic |
| 2 | `egress-token-anomaly` | SecOps & Zero-Trust | RFC-0018 / RFC-0021 | Revokes compromised credentials and isolates container egress |
| 3 | `ingress-oom-autoscaling` | Cloud & Compute | RFC-0016 / ToolHive | Mitigates pod heap exhaustion via horizontal auto-scaling |
| 4 | `canary-deployment-rollback` | CI/CD & Rollout | RFC-0016 / RFC-0012 | Reverts failing canary deployments to stable checkpoints |
| 5 | `code-review-tla-verification` | Quality & Formal Methods | RFC-0002 / TLA+ | Verifies concurrency and deadlock safety in formal TLA+ |
| 6 | `saif-compliance-audit` | Compliance & Security | RFC-0018 / RFC-0019 | Audits agent actions against Google SAIF and WASI fuel caps |
| 7 | `bft-consensus-deliberation` | Governance & Consensus | RFC-0002 / RFC-0012 | Enforces 67% BFT supermajority quorum with dissent preservation |
| 8 | `twinseal-passkey-approval` | Human-in-the-Loop | RFC-0012 / WebAuthn | Freezes execution until two human officers sign passkeys |
| 9 | `durable-wal-recovery` | Data & Engine Lifecycles | RFC-0016 / ADR-0041 | Replays write-ahead command logs and reconciles state |
| 10 | `context-compaction-pruning` | Memory & Context | RFC-0015 / RFC-0020 | Prunes scratchpad thoughts and compacts vectors into RVF |
| 11 | `byzantine-fault-slashing` | Security & Reputation | RFC-0014 / RFC-0021 | Slashes reputation stakes of rogue or equivocating agents |
| 12 | `identity-key-rotation` | Identity & Key Management | RFC-0013 / W3C DID Core | Rotates Ed25519 signing keys and updates DID documents |
| 13 | `micro-sandbox-isolation` | Process Isolation | RFC-0018 / Onyxbox | Spawns zero-trust ToolHive ephemeral micro-containers |
| 14 | `cross-model-agentflex-synthesis` | Cognitive Architecture | RFC-0002 / Agentflex | Synthesizes proposals across Claude, GPT, and Gemini models |
| 15 | `declarative-step-playbook` | Workflow Automation | RFC-0016 / PlaybookRun | Executes structured JSON step playbooks with automated retry |
| 16 | `postguard-injection-defense` | Prompt Security | RFC-0019 / Postguard | Screens prompt injections and jailbreaks before execution |
| 17 | `dynamic-dag-topology` | Graph Scheduling | RFC-0016 / ADK 2.0 | Dynamically reorganizes DAG execution with JoinNode barriers |
| 18 | `transitive-trust-federation` | Identity Federation | RFC-0017 / Web of Trust | Traverses transitive trust chains using peer BFS traversal |
