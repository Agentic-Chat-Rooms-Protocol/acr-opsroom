# Agent Guidelines - acr-opsroom

## Overview & Scope
`acr-opsroom` is the 21st canonical repository of the ACR ecosystem. It implements the **Autonomous Operations War Room, Byzantine Deliberation Engine, and Supercharged Evolution of Salesforce Agentforce & Slack AI**.

---

## NPM Organization & Publishing
- **Live NPM Organization**: `@acr-js` (All official packages published under `@acr-js/opsroom-*`).
- **Workspace Packages**:
  - `@acr-js/opsroom-core`: Atlas 2.0 State Machine, Byzantine Quorum Engine, ML Anomaly Detector, Ops Canvas Manager, and Sandbox Executor.
  - `@acr-js/opsroom-server`: High-throughput REST & Server-Sent Events (SSE) API server on port 20447.
  - `@acr-js/opsroom-web`: Hyper-premium WCAG 2.2 AAA compliant React 19 web application & interactive showcase.

---

## Architectural Disciplines & Rules
1. **Byzantine Fault Tolerance (BFT) Invariant**:
   - Never allow state mutations (e.g. database failovers, firewall rules, DNS updates, financial dispatch) based on single-agent LLM output.
   - All write actions require an $M$-of-$N$ quorum (default $\ge 67\%$) signed by Ed25519 W3C DIDs.
2. **Dual-Consent Human Escalation**:
   - Any irreversible or critical-tier tool invocation must halt in `escalated_human` status until an explicit human approval is received.
3. **Zero-Trust Sandboxing**:
   - All tool executions must be routed through `acr-meta-mcp` (port 20445) under strict containment profiles (`no-network`, `egress-allowlist`, `readonly-fs`, or `workspace-scoped`).
4. **Port Conventions**:
   - Web Client: `30447` (with `ACR_OPSROOM_WEB_PORT` override)
   - Backend Server: `20447` (with `ACR_OPSROOM_PORT` override)
   - Meta-MCP Gateway: `20445`
   - Core Daemon: `20443`
5. **Deterministic Verification**:
   - Run `npm test` before committing any changes. Maintain 100% test pass rate across all core algorithms and server endpoints.
