# Competitive Battlecard: ACR OpsRoom vs. Salesforce Agentforce & Slack AI

| Feature Dimension | Salesforce Agentforce (in Slack) | ACR OpsRoom (The Evolution) | Enterprise Outcome & Rationale |
|---|---|---|---|
| **Cognitive Engine** | Atlas 1.0 (Single-agent prompt chaining) | **Atlas 2.0 Dynamic DAG** (Deterministic rollbacks) | Static + runtime `ctx.runNode()` graphs with 3-color DFS cycle validation and RFC 8785 JCS `topologyHash` |
| **Consensus & Approval** | Single model decision; plain-text confirmation | **67% Consensus Gate** (Signed by W3C Ed25519 DIDs) + **WebAuthn Passkey Consent** | Cryptographic quorum plus topology-bound `PasskeyConsentNode` challenges that burn pre-verification |
| **Long-Horizon Context & Resume** | Truncates older turns or loses step state on pause | **Checkpoint-Safe Context Compaction** (`CheckpointSafeContextCompactor`) | Compacts 30+ step trajectories while preserving `@runId` checkpoints, `<Class.field from node>` outputs, and `executionAuthority` levels in $O(1)$ lookup |
| **Error Recovery & Retries** | Blind LLM retry loops on tool failure | **WAL-Guarded Self-Healing** (`WalGuardedReflectRetryPlugin` + `DurableCommandWal`) | Self-heals pre-dispatch schema errors via LLM reflection while blocking duplicate retries on `DISPATCHED` or `OUTCOME_UNKNOWN` side effects |
| **Tool-Call Integrity** | Unsigned JSON tool arguments in session state | **HMAC-SHA256 Tool-Call Signing** (`ToolCallIntegrityPlugin`) | Signs every `functionCall` (`__adk_internal_fc_hmac`) and verifies via constant-time `timingSafeEqualHex` before tool execution |
| **Process Containment** | Standard CRM permissions; no OS/process isolation | **ToolHive Micro-Sandboxing** (Process isolation) | Enforces `no-network`, `egress-allowlist`, `workspace-scoped` containment, and `executionAuthority: 'NONE'` webhook taint blocking |
| **Collaborative Surface** | Passive Slack text threads + static Slack Canvas | **Live Collaborative Dynamic Ops Canvas & Synthetic Huddle** | Real-time bi-directional telemetry binding, `RoutedAgent` sub-agent dispatch, and automatic executive synthesis |
| **Auditability & Rewind** | Proprietary cloud log files; editable by admins | **Cryptographic Merkle Audit Ledger** + **Compensating Rewind** | Append-only SHA-256 hash chain with `WORKFLOW_CHECKPOINT_REWIND` and `EVENT_COMPACTION_COMMITTED` proofs for SOC2, ISO27001, and HIPAA |
| **Cost & Economics** | $2.00/conversation + $500/mo base + Data Cloud fees | **$0 Runtime Protocol Tax** (Open-source Apache-2) | Zero per-conversation fees, full data sovereignty, and 80% to 95% lower annual AI operations spend |

