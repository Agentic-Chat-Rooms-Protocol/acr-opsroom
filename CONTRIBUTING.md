# Contributing to ACR OpsRoom

We welcome contributions to the **ACR OpsRoom** repository. Please adhere to the following workflow:

## Development Workflow
1. **Repository Setup**: Clone and install workspace dependencies via `npm install`.
2. **Deterministic Verification**: Ensure all tests pass via `npm test` before committing any code.
3. **Byzantine Fault Tolerance Standard**: Any modification to the consensus or state machine engine must maintain full mathematical test coverage.
4. **WCAG 2.2 Standard**: Any UI addition in `packages/web` must strictly maintain WCAG 2.2 Level AA/AAA contrast and keyboard accessibility.
5. **Code Style**: Format with clean ES2022 TypeScript, explicit types, and zero implicit any.
