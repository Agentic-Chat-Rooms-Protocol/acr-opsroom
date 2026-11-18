# ACR OpsRoom

> **The Cryptographic, Governed War Room for Enterprise AI Operations. Built to Replace Single-Agent Prompt Chains.**

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Ecosystem](https://img.shields.io/badge/ACR_Ecosystem-Repo_21-FF5500.svg)](https://github.com/Agentic-Chat-Rooms-Protocol)
[![WCAG](https://img.shields.io/badge/WCAG_2.2-Level_AAA_Compliant-emerald.svg)](docs/WCAG-2.2-COMPLIANCE.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](package.json)
[![Security](https://img.shields.io/badge/Security-Zero_Trust_Sandbox-FF5500.svg)](docs/ARCHITECTURE.md)

## Executive Overview

Single-agent prompt chains drift during live outages, mutate production systems without consensus, and bill per conversation. **ACR OpsRoom** is the governed operations war room and deliberation engine for enterprise infrastructure and AI workloads.

Where Salesforce Agentforce locks teams into single-agent prompt chains, unverified CRM writes, closed cloud silos, and a **$2.00-per-conversation fee**, **ACR OpsRoom** delivers:
1. **Atlas 2.0 Dynamic DAG** decomposes complex production incidents into state-machine plans with deterministic rollbacks and loop prevention.
2. **67% Consensus Gate** enforces $M$-of-$N$ weighted supermajority voting signed by W3C Ed25519 DIDs so no single hallucinating agent alters production state.
3. **ToolHive Micro-Sandboxing** enforces process isolation (`no-network`, `egress-allowlist`, `readonly-fs`, `workspace-scoped`) through `acr-meta-mcp`.
4. **Live Collaborative Ops Canvas & Synthetic Huddles** bind real-time telemetry, DAG progression, and multi-agent audio and transcript synthesis.
5. **$0 Runtime Protocol Tax** keeps the core Apache-2.0 open-source protocol free of per-conversation fees, cutting enterprise AI operations spend by 80% to 95%.

## Competitive Battlecard: OpsRoom vs. Salesforce Agentforce

| Feature Dimension | Salesforce Agentforce + Slack | ACR OpsRoom (The Evolution) |
|---|---|---|
| **Cognitive Engine** | Atlas 1.0 (Single-agent prompt chaining; sequential topics) | **Atlas 2.0 Dynamic DAG** with deterministic rollbacks and cross-agent critique |
| **Safety & Consensus** | Single LLM decision; vulnerable to prompt hallucinations | **67% Consensus Gate** signed by W3C Ed25519 DIDs |
| **Execution Sandboxing** | Standard CRM object permissions; zero process isolation | **ToolHive Micro-Sandboxing** via `acr-meta-mcp` |
| **Collaborative Surface** | Passive Slack text threads + static Slack Canvas | **Live Collaborative Ops Canvas** with real-time telemetry binding |
| **Huddle Collaboration** | Passive AI note-taker for human calls | **Governed Multi-Agent Synthetic Huddle Fabric** with executive briefs |
| **Audit & Provenance** | Proprietary cloud logs; modifiable by administrators | **Cryptographic Audit Ledger** (SOC2 / ISO27001 export) |
| **Pricing & Lock-In** | $2.00/conversation + $500/mo base + Data Cloud fees | **$0 Runtime Protocol Tax** under open-source Apache-2.0 |

## Architecture & Port Map

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
|      Atlas 2.0 Engine · 67% Consensus Gate · ML Statistical Anomaly     |
|      Ops Canvas Manager · Synthetic Huddle · Cryptographic Audit        |
+------------------------------------+------------------------------------+
                                     |
             +-----------------------+-----------------------+
             |                                               |
             v                                               v
+----------------------------+             +------------------------------+
|   acr-meta-mcp (Port 20445)|             |      acr-core (Port 20443)   |
| (ToolHive Sandbox & Vault) |             |  (NATS Event Store & DIDs)   |
+----------------------------+             +------------------------------+
```

## Mathematical Consensus Model

An operational squad $\mathcal{A} = \{a_1, a_2, \dots, a_n\}$ votes on every mitigation step. Each agent $a_i$ casts an Ed25519-signed ballot containing decision $d_i$, confidence $c_i$, weight $w_i$, and justification $j_i$.

$$\text{Quorum Score} = \frac{\sum_{i: d_i = \text{approve}} w_i \cdot c_i}{\sum_{i: d_i \in \{\text{approve}, \text{reject}\}} w_i \cdot c_i} \ge 0.67$$

If any high-risk tool is proposed or if signature anomalies are detected (such as tampered signatures or negative confidence), the engine automatically escalates to **Human-in-the-Loop (HITL) Dual Consent**.

## Quickstart

### Prerequisites
- Node.js >= 18.0.0 (Tested on Node 22 & 26)
- npm >= 9.0.0

### Installation & Build
```bash
git clone https://github.com/Agentic-Chat-Rooms-Protocol/acr-opsroom.git
cd acr-opsroom
npm install
npm run typecheck && npm run build
```

### Running Test Suite
```bash
npm test
```
*Executes all unit and integration tests across core algorithms, anomaly detection, 67% Consensus Gate voting, and server routes.*

### Starting OpsRoom Server & Web Client
```bash
# Start backend REST & SSE server (Port 20447)
npm start

# In a separate terminal, launch the dedicated web client (Port 30447)
npm run dev
```

Visit `http://localhost:30447` to open the interactive War Room simulator.

## WCAG 2.2 AAA COMPLIANT Accessibility

The OpsRoom interface is **WCAG 2.2 AAA COMPLIANT** across all interactive views:
- **Contrast Ratios** reach 18.2:1 text contrast and 14.8:1 accent contrast against obsidian backgrounds.
- **Keyboard Navigation** supports full keyboard control (`Tab`, `Shift+Tab`, `Enter`, `Space`, `Esc`, and a dedicated `?` shortcut modal).
- **Target Size** enforces a minimum 44 × 44 CSS pixels on all clickable and interactive controls.
- **Reduced Motion** honors `prefers-reduced-motion: reduce` across all animations and shaders.
- **Screen Readers** receive semantic ARIA landmarks (`role="banner"`, `role="main"`, `role="status"`, `aria-live="polite"`).

## License & Ecosystem
Licensed under the [Apache-2.0 License](LICENSE).
Part of the **Agentic Chat Rooms (ACR)** monorepo ecosystem. Published under the `@acr-js` NPM organization.
