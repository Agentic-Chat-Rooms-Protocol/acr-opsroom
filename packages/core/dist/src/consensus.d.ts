/**
 * ACR OpsRoom - Byzantine Fault Tolerant (BFT) Quorum Consensus Engine
 * Solves the critical flaw in single-agent LLM systems like Salesforce Agentforce:
 * Rather than letting one hallucinating model alter production or CRM state,
 * OpsRoom demands an M-of-N weighted quorum signed by Ed25519 agent DIDs.
 */
import { ConsensusBallot, QuorumEvaluation, AgentSquad, AgentProfile, VoteDecision } from './types.js';
export declare class ByzantineConsensusEngine {
    /**
     * Cryptographically verify a ballot using agent's public key or hash signature.
     */
    static verifyBallotSignature(ballot: ConsensusBallot, agent: AgentProfile): boolean;
    /**
     * Evaluate Byzantine anomalies in incoming ballots:
     * 1. Check for contradictory confidence scores (< 0 or > 1)
     * 2. Detect ungrounded radical divergence (e.g., confidence 1.0 on rejection with no rationale)
     * 3. Detect ballot tampering or signature forgery
     */
    static auditBallot(ballot: ConsensusBallot, agent: AgentProfile): {
        isFlagged: boolean;
        reason?: string;
    };
    /**
     * Tally weighted votes and verify whether Byzantine Quorum target (default 67%) is satisfied.
     * Protects against:
     * - Sybil ballot replication (same agent voting multiple times)
     * - Equivocation (same agent voting approve and reject in same round)
     * - Signature tampering
     */
    static evaluateQuorum(incidentId: string, squad: AgentSquad, ballots: ConsensusBallot[], forceHumanGating?: boolean): QuorumEvaluation;
    /**
     * Helper to sign a ballot with simulated or Ed25519 keys.
     */
    static signBallot(incidentId: string, agent: AgentProfile, decision: VoteDecision, confidence: number, justification: string): ConsensusBallot;
}
//# sourceMappingURL=consensus.d.ts.map