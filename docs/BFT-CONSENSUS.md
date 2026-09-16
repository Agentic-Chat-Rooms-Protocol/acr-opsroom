# Byzantine Fault Tolerant (BFT) Quorum Consensus Specification

## Overview
Single-agent AI systems (such as Salesforce Agentforce) create severe single points of failure in enterprise environments. When an individual LLM hallucinates an invalid command or encounters a poisoned context prompt, it executes directly against production systems or CRM records.

**ACR OpsRoom solves this by mandating an $M$-of-$N$ Byzantine Fault Tolerant (BFT) Quorum Consensus signed by W3C Ed25519 decentralized identifiers (DIDs).**

---

## 1. Consensus Mathematical Model

Let $\mathcal{A} = \{a_1, a_2, \dots, a_n\}$ be the set of $n$ agents in an operational squad.
Each agent $a_i$ is parameterized by:
- **Role**: $\mathcal{R}_i \in \{\text{Atlas}, \text{SRE}, \text{SecOps}, \text{DataOps}, \text{FinOps}\}$
- **Weight**: $w_i \in \mathbb{R}^+$ where $\sum_{i=1}^n w_i = W_{total}$
- **Public Key**: $pk_i$ (Ed25519 keypair)
- **DID**: $\text{did:key:z6Mku}\dots$

### Ballot Structure
Every ballot $b_i$ submitted by agent $a_i$ contains:
$$b_i = \langle \text{incidentId}, a_i, \text{did}_i, d_i, c_i, j_i, t_i, \sigma_i \rangle$$
Where:
- $d_i \in \{\text{approve}, \text{reject}, \text{abstain}\}$ is the decision.
- $c_i \in [0.0, 1.0]$ is the calibrated model confidence.
- $j_i$ is the natural-language justification string ($\ge 5$ characters).
- $t_i$ is the millisecond timestamp.
- $\sigma_i = \text{Sign}_{sk_i}(\text{incidentId} \parallel \text{did}_i \parallel d_i \parallel c_i \parallel j_i \parallel t_i)$.

### Weighted Supermajority Evaluation
The weighted approval score $S_{approval}$ is defined as:
$$S_{approval} = \frac{\sum_{i: d_i = \text{approve}} w_i \cdot c_i}{\sum_{i: d_i \in \{\text{approve}, \text{reject}\}} w_i \cdot c_i}$$

A plan is approved if and only if:
1. $S_{approval} \ge \tau$ (where default threshold $\tau = 0.67$, corresponding to 2/3 Byzantine fault tolerance).
2. The raw count of approvals satisfies $N_{approve} \ge \lceil \frac{n}{2} \rceil$.
3. Zero unresolved Byzantine anomalies are detected in $\mathcal{A}$.

---

## 2. Byzantine Anomaly Detection Rules

The engine audits all ballots before tallying:
1. **Cryptographic Signature Verification**:
   $$\text{Verify}_{pk_i}(\text{payload}, \sigma_i) \equiv \text{True}$$
   If verification fails, the ballot is discarded, and $a_i$ is quarantined.
2. **Confidence Range Boundary**:
   If $c_i < 0.0$ or $c_i > 1.0$ or $\text{isNaN}(c_i)$, flag as corrupt.
3. **Justification Completeness**:
   Empty or whitespace-only justifications are rejected.
4. **Human-In-The-Loop (HITL) Dual-Consent Trigger**:
   If any critical-tier tool (e.g. database purge, secret revocation, route severance) is included in the execution plan, or if any Byzantine anomaly is flagged, status transitions to `escalated_human`.
