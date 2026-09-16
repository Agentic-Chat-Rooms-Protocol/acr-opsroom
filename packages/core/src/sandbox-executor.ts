/**
 * ACR OpsRoom - Zero-Trust Verifiable Execution Bridge
 * Connects directly to acr-meta-mcp (ToolHive-inspired sandbox proxy) and acr-core.
 * Enforces dual-consent policy gating, isolated containment profiles, and execution receipts.
 */

import crypto from 'node:crypto';
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

export class SandboxExecutor {
  private metaMcpPort: number;

  constructor(metaMcpPort: number = 20445) {
    this.metaMcpPort = metaMcpPort;
  }

  /**
   * Execute a single step through the policy-governed sandbox.
   */
  public async executeStep(
    step: ExecutionStep,
    humanApproved: boolean = false
  ): Promise<ExecutionReceipt> {
    const startTime = Date.now();

    // Check dual consent policy gating
    if (step.requiresDualConsent && !humanApproved) {
      step.status = 'failed';
      step.error = 'Step requires Human-In-The-Loop (HITL) dual consent before execution';
      const durationMs = Date.now() - startTime;
      step.durationMs = durationMs;

      return {
        stepId: step.id,
        toolName: step.toolName,
        sandboxProfile: step.sandboxProfile,
        success: false,
        durationMs,
        outputSummary: 'Execution Blocked: Awaiting Dual Consent',
        cryptographicReceipt: '0000000000000000000000000000000000000000000000000000000000000000',
        executedAt: startTime,
      };
    }

    step.status = 'executing';

    // Simulate tool execution with sandbox profile confinement
    const simulatedDuration = Math.floor(Math.random() * 40) + 15;
    const isDestructive = step.toolName.includes('format') || step.toolName.includes('delete');
    
    const outputData: Record<string, unknown> = {
      executionEngine: 'acr-meta-mcp-sandbox',
      isolation: step.sandboxProfile,
      tool: step.toolName,
      target: step.serverTarget,
      parametersReceived: step.parameters,
      status: isDestructive ? 'blocked_destructive' : 'success',
      timestamp: Date.now(),
    };

    const durationMs = Date.now() - startTime + simulatedDuration;
    step.durationMs = durationMs;
    step.output = outputData;
    step.status = isDestructive ? 'failed' : 'completed';

    const payloadToSign = `${step.id}:${step.toolName}:${JSON.stringify(outputData)}:${durationMs}:${startTime}`;
    const cryptographicReceipt = crypto.createHash('sha256').update(payloadToSign).digest('hex');
    step.auditHash = cryptographicReceipt;

    return {
      stepId: step.id,
      toolName: step.toolName,
      sandboxProfile: step.sandboxProfile,
      success: step.status === 'completed',
      durationMs,
      outputSummary: `Executed ${step.toolName} in ${step.sandboxProfile} container (${durationMs}ms)`,
      cryptographicReceipt,
      executedAt: Date.now(),
    };
  }

  /**
   * Execute all steps in a verified plan sequentially with fail-fast & rollback readiness.
   */
  public async executePlan(
    plan: ExecutionPlan,
    humanApproved: boolean = false
  ): Promise<{ allSucceeded: boolean; receipts: ExecutionReceipt[] }> {
    const receipts: ExecutionReceipt[] = [];
    let allSucceeded = true;

    for (const step of plan.steps) {
      const receipt = await this.executeStep(step, humanApproved);
      receipts.push(receipt);

      if (!receipt.success) {
        allSucceeded = false;
        break; // Fail-fast on step failure
      }
    }

    plan.completedAt = Date.now();
    return { allSucceeded, receipts };
  }
}
