# Security Policy - ACR OpsRoom

## Security Model
ACR OpsRoom operates under a **Zero-Trust Verifiable Execution Model**:
1. **Byzantine Fault Tolerance**: Critical infrastructure state changes require verified $M$-of-$N$ quorum consensus ($\ge 67\%$).
2. **Cryptographic Identity**: Every agent turn, ballot, and execution step is signed with Ed25519 W3C DIDs.
3. **ToolHive Sandboxing**: All tool invocations are partitioned into isolated micro-sandboxes with egress allowlists and read-only filesystem policies.
4. **Dual-Consent Escalation**: Irreversible operations (data drops, secret revocations, failover dispatches) halt execution until human approval is cryptographically logged.

## Reporting Vulnerabilities
If you discover a security vulnerability, please report it confidentially to `security@agentchatrooms.dev`. Do not open public issues.
