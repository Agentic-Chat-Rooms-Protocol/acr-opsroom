/**
 * ACR OpsRoom - Cryptographic Audit Ledger & Merkle Chain
 * Provides tamper-evident proof of every prompt, deliberation turn, consensus ballot,
 * and sandboxed execution. Essential for enterprise SOC2, ISO27001, and HIPAA compliance.
 */
import { AuditBlock } from './types.js';
export interface AuditCertificate {
    certificateId: string;
    incidentId: string;
    chainLength: number;
    genesisHash: string;
    merkleRootHash: string;
    issuedAt: number;
    signatureStandard: 'Ed25519-ACR-V1';
    complianceValid: boolean;
}
export declare class CryptographicAuditLedger {
    private blocks;
    private genesisHash;
    constructor(incidentId?: string);
    /**
     * Append an immutable block to the chain.
     */
    recordBlock(incidentId: string, actionType: AuditBlock['actionType'], payload: Record<string, unknown>, signatures?: Array<{
        did: string;
        signature: string;
    }>): AuditBlock;
    /**
     * Verify cryptographic integrity of the entire block chain.
     */
    verifyChainIntegrity(): boolean;
    /**
     * Generate an enterprise compliance certificate for the incident.
     */
    generateComplianceCertificate(incidentId: string): AuditCertificate;
    getBlocks(): AuditBlock[];
}
//# sourceMappingURL=audit-ledger.d.ts.map