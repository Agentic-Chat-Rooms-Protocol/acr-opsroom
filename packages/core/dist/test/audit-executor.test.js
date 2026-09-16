import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CryptographicAuditLedger } from '../src/audit-ledger.js';
import { SandboxExecutor } from '../src/sandbox-executor.js';
describe('CryptographicAuditLedger & SandboxExecutor', () => {
    test('creates Merkle chain and verifies unbroken integrity', () => {
        const ledger = new CryptographicAuditLedger('inc-audit-1');
        assert.equal(ledger.verifyChainIntegrity(), true);
        ledger.recordBlock('inc-audit-1', 'DELIBERATION_TURN', { turn: 1, agent: 'atlas' });
        ledger.recordBlock('inc-audit-1', 'CONSENSUS_BALLOT', { votes: 4, decision: 'approve' });
        ledger.recordBlock('inc-audit-1', 'STEP_EXECUTION', { step: 1, tool: 'scale_pod' });
        assert.equal(ledger.getBlocks().length, 4);
        assert.equal(ledger.verifyChainIntegrity(), true);
        const cert = ledger.generateComplianceCertificate('inc-audit-1');
        assert.equal(cert.complianceValid, true);
        assert.equal(cert.chainLength, 4);
        assert.ok(cert.merkleRootHash.length === 64);
    });
    test('sandbox executor blocks steps requiring dual consent when unapproved', async () => {
        const executor = new SandboxExecutor();
        const criticalStep = {
            id: 'step-crit-1',
            stepNumber: 1,
            title: 'Emergency failover to secondary datacenter',
            toolName: 'trigger_datacenter_failover',
            serverTarget: 'acr-sre-mcp',
            parameters: { targetRegion: 'us-west-2' },
            sandboxProfile: 'no-network',
            requiresDualConsent: true,
            status: 'pending',
            durationMs: 0,
            auditHash: '',
        };
        const receipt = await executor.executeStep(criticalStep, false);
        assert.equal(receipt.success, false);
        assert.equal(criticalStep.status, 'failed');
        assert.ok(criticalStep.error?.includes('dual consent'));
    });
    test('sandbox executor executes step when dual consent is provided', async () => {
        const executor = new SandboxExecutor();
        const safeStep = {
            id: 'step-safe-1',
            stepNumber: 1,
            title: 'Query replica lag',
            toolName: 'get_replica_lag_stats',
            serverTarget: 'acr-db-mcp',
            parameters: { host: 'db-replica-1' },
            sandboxProfile: 'workspace-scoped',
            requiresDualConsent: false,
            status: 'pending',
            durationMs: 0,
            auditHash: '',
        };
        const receipt = await executor.executeStep(safeStep);
        assert.equal(receipt.success, true);
        assert.equal(safeStep.status, 'completed');
        assert.ok(receipt.cryptographicReceipt.length === 64);
    });
});
//# sourceMappingURL=audit-executor.test.js.map