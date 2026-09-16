/**
 * ACR OpsRoom - Zero-Trust Verifiable Execution Bridge
 * Connects directly to acr-meta-mcp (ToolHive-inspired sandbox proxy) and acr-core.
 * Enforces dual-consent policy gating, isolated containment profiles, and execution receipts.
 */
import { ExecutionStep, ExecutionPlan, SandboxProfile } from './types.js';
export interface ExecutionReceipt {
    stepId: string;
    toolName: string;
    sandboxProfile: SandboxProfile;
    success: boolean;
    durationMs: number;
    outputSummary: string;
    cryptographicReceipt: string;
    executedAt: number;
}
export declare class SandboxExecutor {
    private metaMcpPort;
    constructor(metaMcpPort?: number);
    /**
     * Execute a single step through the policy-governed sandbox.
     */
    executeStep(step: ExecutionStep, humanApproved?: boolean): Promise<ExecutionReceipt>;
    /**
     * Execute all steps in a verified plan sequentially with fail-fast & rollback readiness.
     */
    executePlan(plan: ExecutionPlan, humanApproved?: boolean): Promise<{
        allSucceeded: boolean;
        receipts: ExecutionReceipt[];
    }>;
}
//# sourceMappingURL=sandbox-executor.d.ts.map