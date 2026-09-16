# ACR OpsRoom ⚡

> **The Cryptographic, Byzantine-Fault-Tolerant War Room for Autonomous Enterprise AI. Beyond Salesforce Agentforce & Slack.**

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Ecosystem](https://img.shields.io/badge/ACR_Ecosystem-Repo_21-cyan.svg)](http://localhost:3300/ACR)
[![WCAG](https://img.shields.io/badge/WCAG_2.2-Level_AAA_Compliant-emerald.svg)](docs/WCAG-2.2-COMPLIANCE.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](package.json)
[![Security](https://img.shields.io/badge/Security-Zero_Trust_Sandbox-purple.svg)](docs/ARCHITECTURE.md)

---

## 🌟 Executive Overview
**ACR OpsRoom** is the autonomous operations war room and deliberation engine for modern enterprise infrastructure and AI workloads. It is the branded, decentralized, and cryptographically verified evolution of what Salesforce and Slack assembled with Agentforce.

Where Salesforce locks enterprises into single-agent prompt chains, unverified direct-write CRM risks, closed cloud silos, and an exorbitant **$2.00-per-conversation penalty**, **ACR OpsRoom** provides:
1. **Goal-Directed DAG Planning (Atlas 2.0)**: State machine decomposition of complex production incidents with automatic rollback dags and loop prevention.
2. **Byzantine Fault Tolerant (BFT) Quorum Consensus**: $M$-of-$N$ weighted supermajority voting signed by Ed25519 W3C DIDs ensuring no rogue or hallucinating agent alters production state.
3. **ToolHive Zero-Trust Sandboxing**: Process containment (`no-network`, `egress-allowlist`, `readonly-fs`, `workspace-scoped`) via integration with `acr-meta-mcp`.
4. **Live Dynamic Ops Canvas & Synthetic Huddles**: Real-time bi-directional telemetry binding, collaborative DAG progression, and autonomous multi-agent audio/transcript synthesis.
5. **100% Open Protocol & Zero Vendor Tax**: Free and open-source under Apache-2.0, saving 80% to 95% on enterprise AI operations.

---

## ⚔️ Competitive Battlecard: OpsRoom vs. Salesforce Agentforce

| Feature Dimension | Salesforce Agentforce + Slack | ACR OpsRoom (The Evolution) |
|---|---|---|
| **Cognitive Engine** | Atlas 1.0 (Single-agent prompt chaining; sequential topics) | **Atlas 2.0 Dynamic Graph State Machine** with cross-agent critique |
| **Safety & Consensus** | Single LLM decision; vulnerable to prompt hallucinations | **Byzantine Fault Tolerant (BFT) Quorum Consensus (67% supermajority)** |
| **Execution Sandboxing** | Standard CRM object permissions; zero process isolation | **ToolHive Micro-Sandboxing** via `acr-meta-mcp` |
| **Collaborative Surface** | Passive Slack text threads + static Slack Canvas | **Live Collaborative Ops Canvas** with real-time telemetry binding |
| **Huddle Collaboration** | Passive AI note-taker for human calls | **Autonomous Multi-Agent Synthetic Huddle Fabric** with executive briefs |
| **Audit & Provenance** | Proprietary cloud logs; modifiable by administrators | **Cryptographic Merkle Tree Audit Ledger** (SOC2 / ISO27001 export) |
| **Pricing & Lock-In** | $2.00/conversation + $500/mo base + Data Cloud fees | **100% Free Open Protocol**; self-hostable with $0 per-conversation tax |

---

## 🏗️ Architecture & Port Map

```
+-------------------------------------------------------------------------+
|                  ACR OpsRoom Dedicated Web Application                  |
|     (Port 30447: Vite + React 19 + Tailwind + GSAP + Neural Canvas)     |
+------------------------------------+------------------------------------+
                                     | REST / SSE Stream
                                     v
+------------------------------------+------------------------------------+
|                         @acr-js/opsroom-server                          |
|         (Port 20447: REST Endpoints & Real-Time SSE Hub)                |
+------------------------------------+------------------------------------+
                                     |
                                     v
+------------------------------------+------------------------------------+
|                          @acr-js/opsroom-core                           |
|      Atlas 2.0 Engine · Byzantine Quorum · ML Statistical Anomaly       |
|      Ops Canvas Manager · Synthetic Huddle · Cryptographic Audit        |
+------------------------------------+------------------------------------+
                                     |
             +-----------------------+-----------------------+
             |                                               |
             v                                               v
+----------------------------+             +------------------------------+
|   acr-meta-mcp (Port 20445)|             |      acr-core (Port 20443)   |
| (ToolHive Sandbox & Vault) |             |  (NATS JetStream & W3C DIDs) |
+----------------------------+             +------------------------------+
```

---

## 📐 Mathematical Consensus Model

An operational squad $\mathcal{A} = \{a_1, a_2, \dots, a_n\}$ votes on every mitigation step. Each agent $a_i$ casts an Ed25519-signed ballot containing decision $d_i$, confidence $c_i$, weight $w_i$, and justification $j_i$.

$$\text{Quorum Score} = \frac{\sum_{i: d_i = \text{approve}} w_i \cdot c_i}{\sum_{i: d_i \in \{\text{approve}, \text{reject}\}} w_i \cdot c_i} \ge 0.67$$

If any high-risk tool is proposed or if Byzantine anomalies are detected (e.g. tampered signatures or negative confidence), the engine automatically escalates to **Human-in-the-Loop (HITL) Dual Consent**.

---

## 🚀 Quickstart

### Prerequisites
- Node.js >= 18.0.0 (Tested on Node 22 & 26)
- npm >= 9.0.0

### Installation & Build
```bash
git clone http://localhost:3300/ACR/acr-opsroom.git
cd acr-opsroom
npm install
npm run build
```

### Running Test Suite
```bash
npm test
```
*Executes all comprehensive unit and integration tests across core algorithms, anomaly detection, Byzantine quorum, and server routes.*

### Starting OpsRoom Server & Web Client
```bash
# Start backend REST & SSE server (Port 20447)
npm start

# In a separate terminal, launch the dedicated web client (Port 30447)
npm run dev
```

Visit `http://localhost:30447` to experience the interactive War Room simulator.

---

## ♿ WCAG 2.2 Level AAA Accessibility

The OpsRoom interface strictly adheres to WCAG 2.2 Level AA and AAA specifications:
- **Contrast Ratios**: 18.2:1 text contrast and 14.8:1 accent contrast against obsidian backgrounds.
- **Keyboard Navigation**: Full keyboard control (`Tab`, `Shift+Tab`, `Enter`, `Space`, `Esc`, and dedicated `?` shortcut modal).
- **Target Size**: Minimum 44 × 44 CSS pixels on all clickable/interactive controls.
- **Reduced Motion**: Complete adherence to `prefers-reduced-motion: reduce`.
- **Screen Readers**: Semantic ARIA landmarks (`role="banner"`, `role="main"`, `role="status"`, `aria-live="polite"`).

---

## 📄 License & Ecosystem
Licensed under the [Apache-2.0 License](LICENSE).
Part of the **Agentic Chat Rooms (ACR)** monorepo ecosystem. Published under the `@acr-js` NPM organization.
