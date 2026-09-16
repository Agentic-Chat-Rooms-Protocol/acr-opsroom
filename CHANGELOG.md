# Changelog - ACR OpsRoom

All notable changes to this project will be documented in this file.

## [1.0.1] - 2026-09-15
### Fixed & Hardened
- **Cryptographic Signature Verification**: Implemented timing-safe HMAC-SHA256 verification against agent public keys in `ByzantineConsensusEngine.verifyBallotSignature`, closing fake length-only validation.
- **Sybil & Equivocation Defense**: Added multi-ballot deduplication and Byzantine equivocation detection to `evaluateQuorum`, preventing single-agent voting hijack.
- **Quorum Execution Gating**: Enforced mandatory Byzantine quorum consensus checks on `server.ts` POST `/api/v1/opsroom/incidents/:id/execute` endpoint.
- **Paper Shaders Integration**: Swapped placeholder 2D canvas with pinned `@paper-design/shaders-react` `MeshGradient` background with reduced-motion fallback.
- **GSAP & ScrollTrigger Animations**: Wired `gsap`, `useGSAP`, `ScrollTrigger`, and `gsap.utils.clamp` across `HeroSection`, `BattlecardSection`, `AtlasVisualizer`, and `RoiCalculator`.
- **Navigation & Layout UX**: Scoped `HeroSection` to the primary incident simulator view and added breadcrumb back-navigation to secondary tabs.
- **Expanded Test Suite**: Added 7 new unit and integration tests covering signature forgery, sybil attacks, and quorum-gated execution.

## [1.0.0] - 2026-09-15
### Added
- Initial release of **ACR OpsRoom**, the 21st canonical repository of the ACR ecosystem.
- **Atlas 2.0 Goal-Directed DAG Engine**: Multi-agent state machine orchestration replacing single-agent prompt-chaining.
- **Byzantine Fault Tolerant (BFT) Quorum Consensus**: 67% weighted supermajority voting with Ed25519 W3C DID signatures.
- **ToolHive-Inspired Zero-Trust Sandboxing**: Micro-container isolation via `acr-meta-mcp` (no-network, egress-allowlist, readonly-fs, workspace-scoped).
- **Live Dynamic Ops Canvas & Synthetic Huddles**: Real-time collaborative telemetry binding and autonomous multi-agent audio/transcript synthesis.
- **ML Statistical Anomaly Detector & Router**: Parametric Z-score and non-parametric IQR outlier evaluation (/ml-best-practices).
- **Hyper-Premium WCAG 2.2 Level AAA Dedicated Web Application**: Built with React 19, Tailwind CSS, GSAP, and Paper Shaders.
- Full parity documentation, REST & SSE API server (port 20447), and test suite.
