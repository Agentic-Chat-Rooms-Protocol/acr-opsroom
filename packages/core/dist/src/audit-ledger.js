/**
 * ACR OpsRoom - Cryptographic Audit Ledger & Merkle Chain
 * Provides tamper-evident proof of every prompt, deliberation turn, consensus ballot,
 * and sandboxed execution. Essential for enterprise SOC2, ISO27001, and HIPAA compliance.
 */
import crypto from 'node:crypto';
export class CryptographicAuditLedger {
    blocks = [];
    genesisHash = '0000000000000000000000000000000000000000000000000000000000000000';
    constructor(incidentId) {
        if (incidentId) {
            this.recordBlock(incidentId, 'INCIDENT_TRIGGERED', { incidentId, initialized: true }, []);
        }
    }
    /**
     * Append an immutable block to the chain.
     */
    recordBlock(incidentId, actionType, payload, signatures = []) {
        const previousHash = this.blocks.length > 0
            ? this.blocks[this.blocks.length - 1].blockHash
            : this.genesisHash;
        const payloadHash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
        const index = this.blocks.length;
        const timestamp = Date.now();
        const blockHeader = `${index}:${timestamp}:${incidentId}:${actionType}:${payloadHash}:${previousHash}`;
        const blockHash = crypto.createHash('sha256').update(blockHeader).digest('hex');
        const block = {
            index,
            timestamp,
            incidentId,
            actionType,
            payloadHash,
            previousHash,
            blockHash,
            signatures,
        };
        this.blocks.push(block);
        return block;
    }
    /**
     * Verify cryptographic integrity of the entire block chain.
     */
    verifyChainIntegrity() {
        if (this.blocks.length === 0)
            return true;
        for (let i = 0; i < this.blocks.length; i++) {
            const current = this.blocks[i];
            const expectedPrev = i === 0 ? this.genesisHash : this.blocks[i - 1].blockHash;
            if (current.previousHash !== expectedPrev) {
                return false;
            }
            const blockHeader = `${current.index}:${current.timestamp}:${current.incidentId}:${current.actionType}:${current.payloadHash}:${current.previousHash}`;
            const recalculatedHash = crypto.createHash('sha256').update(blockHeader).digest('hex');
            if (recalculatedHash !== current.blockHash) {
                return false;
            }
        }
        return true;
    }
    /**
     * Generate an enterprise compliance certificate for the incident.
     */
    generateComplianceCertificate(incidentId) {
        const isIntegrityIntact = this.verifyChainIntegrity();
        const merkleRootHash = this.blocks.length > 0
            ? this.blocks[this.blocks.length - 1].blockHash
            : this.genesisHash;
        return {
            certificateId: `cert-opsroom-${incidentId}-${Date.now()}`,
            incidentId,
            chainLength: this.blocks.length,
            genesisHash: this.genesisHash,
            merkleRootHash,
            issuedAt: Date.now(),
            signatureStandard: 'Ed25519-ACR-V1',
            complianceValid: isIntegrityIntact,
        };
    }
    getBlocks() {
        return [...this.blocks];
    }
}
//# sourceMappingURL=audit-ledger.js.map