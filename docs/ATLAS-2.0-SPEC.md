# Atlas 2.0 Reasoning & State Machine Specification

## 1. Motivation: The Pitfalls of Atlas 1.0
Salesforce's Atlas 1.0 engine was built around linear topic classification and sequential prompt chaining:
- **Topic-Locking**: Rigid topics pigeonhole enterprise requests into narrow buckets.
- **Single-Agent Cognitive Bias**: No mechanism for an adversarial or specialized agent to challenge hypotheses.
- **Uncontrolled Cycling**: Prone to infinite loops when encountering unexpected API errors.
- **Opaque Black Box**: Closed-source prompts without verifiable execution proofs.

---

## 2. Atlas 2.0 Architecture
**Atlas 2.0** models reasoning as a **Goal-Directed Directed Acyclic Graph (DAG)** governed by a formal state machine:

```
[Detecting]
    │
    ▼ (Parametric Z-Score & Non-Parametric IQR Anomaly Detection)
[Deliberating]
    │
    ▼ (Multi-Agent Hypothesis & Counter-Proposal Turns)
[Awaiting Quorum]
    │
    ├─► If Quorum Approved (>=67%) ──► [Executing] ──► [Verifying] ──► [Resolved]
    │
    └─► If Flagged / Critical Tier ──► [Escalated Human] ──► (Dual Consent)
```

### Key Technical Mechanisms
1. **Loop-Prevention Guard**:
   - Maximum turn limit strictly bounded ($\le 10$ turns per incident).
   - Duplicate action proposal deduplication prevents infinite cycling.
2. **Preflight Dry-Run Simulation**:
   - Before executing state-altering tools, the engine performs a preflight dry run.
   - Any destructive command (e.g. `rm -rf`, `DROP TABLE`) is blocked deterministically.
3. **Rollback Readiness**:
   - Every step registers an inverse compensation step to facilitate automatic rollback if post-execution telemetry verification fails.
