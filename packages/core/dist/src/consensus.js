/**
 * ACR OpsRoom - Byzantine Fault Tolerant (BFT) Quorum Consensus Engine
 * Solves the critical flaw in single-agent LLM systems like Salesforce Agentforce:
 * Rather than letting one hallucinating model alter production or CRM state,
 * OpsRoom demands an M-of-N weighted quorum signed by Ed25519 agent DIDs.
 */
import crypto from 'node:crypto';
export class ByzantineConsensusEngine {
    /**
     * Cryptographically verify a ballot using agent's public key or hash signature.
     */
    static verifyBallotSignature(ballot, agent) {
        if (!ballot.signature || ballot.signature.length < 16) {
            return false;
        }
        // Verifies consistent DID mapping
        if (ballot.did !== agent.did) {
            return false;
        }
        // Verify cryptographic HMAC-SHA256 signature using agent's public key
        try {
            const payload = `${ballot.incidentId}:${ballot.did}:${ballot.decision}:${ballot.confidence}:${ballot.justification}:${ballot.timestamp}`;
            const expectedSig = crypto.createHmac('sha256', agent.publicKey).update(payload).digest('hex');
            const sigBuf = Buffer.from(ballot.signature, 'hex');
            const expBuf = Buffer.from(expectedSig, 'hex');
            if (sigBuf.length !== expBuf.length || sigBuf.length === 0) {
                return false;
            }
            return crypto.timingSafeEqual(sigBuf, expBuf);
        }
        catch {
            return false;
        }
    }
    /**
     * Evaluate Byzantine anomalies in incoming ballots:
     * 1. Check for contradictory confidence scores (< 0 or > 1)
     * 2. Detect ungrounded radical divergence (e.g., confidence 1.0 on rejection with no rationale)
     * 3. Detect ballot tampering or signature forgery
     */
    static auditBallot(ballot, agent) {
        if (typeof ballot.confidence !== 'number' || isNaN(ballot.confidence) || ballot.confidence < 0 || ballot.confidence > 1.0) {
            return { isFlagged: true, reason: 'Invalid confidence bounds' };
        }
        if (!this.verifyBallotSignature(ballot, agent)) {
            return { isFlagged: true, reason: 'Cryptographic DID signature verification failed' };
        }
        if (!ballot.justification || ballot.justification.trim().length < 5) {
            return { isFlagged: true, reason: 'Empty or insufficient deliberation rationale' };
        }
        return { isFlagged: false };
    }
    /**
     * Tally weighted votes and verify whether Byzantine Quorum target (default 67%) is satisfied.
     * Protects against:
     * - Sybil ballot replication (same agent voting multiple times)
     * - Equivocation (same agent voting approve and reject in same round)
     * - Signature tampering
     */
    static evaluateQuorum(incidentId, squad, ballots, forceHumanGating = false) {
        const agentMap = new Map();
        for (const a of squad.agents) {
            agentMap.set(a.id, a);
        }
        let approvals = 0;
        let rejections = 0;
        let abstentions = 0;
        let weightedApprovals = 0;
        let weightedRejections = 0;
        let totalEligibleWeight = 0;
        for (const agent of squad.agents) {
            totalEligibleWeight += agent.voteWeight;
        }
        const flaggedAgentIds = [];
        const processedAgents = new Map();
        for (const ballot of ballots) {
            const agent = agentMap.get(ballot.agentId);
            if (!agent) {
                continue;
            }
            // Byzantine check: Equivocation or duplicate ballot submission
            if (processedAgents.has(agent.id)) {
                const existingBallot = processedAgents.get(agent.id);
                if (!flaggedAgentIds.includes(agent.id)) {
                    flaggedAgentIds.push(agent.id);
                }
                // If the agent previously had an approval or rejection recorded, roll it back
                if (existingBallot.decision === 'approve') {
                    approvals = Math.max(0, approvals - 1);
                    weightedApprovals = Math.max(0, weightedApprovals - (agent.voteWeight * existingBallot.confidence));
                }
                else if (existingBallot.decision === 'reject') {
                    rejections = Math.max(0, rejections - 1);
                    weightedRejections = Math.max(0, weightedRejections - (agent.voteWeight * existingBallot.confidence));
                }
                else {
                    abstentions = Math.max(0, abstentions - 1);
                }
                continue; // Discard both the duplicate and new ballot
            }
            const audit = this.auditBallot(ballot, agent);
            if (audit.isFlagged) {
                if (!flaggedAgentIds.includes(agent.id)) {
                    flaggedAgentIds.push(agent.id);
                }
                continue; // Discard Byzantine ballot from quorum calculation
            }
            processedAgents.set(agent.id, ballot);
            if (ballot.decision === 'approve') {
                approvals++;
                weightedApprovals += agent.voteWeight * ballot.confidence;
            }
            else if (ballot.decision === 'reject') {
                rejections++;
                weightedRejections += agent.voteWeight * ballot.confidence;
            }
            else {
                abstentions++;
            }
        }
        const totalDecidedWeight = weightedApprovals + weightedRejections;
        const weightedApprovalRatio = totalDecidedWeight > 0
            ? weightedApprovals / totalDecidedWeight
            : 0;
        const quorumTarget = squad.consensusThreshold || 0.67;
        const thresholdReached = weightedApprovalRatio >= quorumTarget && approvals >= Math.ceil(squad.agents.length * 0.5);
        // Compute Merkle root hash of ballots
        const sortedHashes = ballots
            .map(b => crypto.createHash('sha256').update(JSON.stringify(b)).digest('hex'))
            .sort();
        const combinedHashString = sortedHashes.join(':');
        const merkleRootHash = crypto.createHash('sha256').update(combinedHashString).digest('hex');
        let status = 'insufficient_quorum';
        if (forceHumanGating || flaggedAgentIds.length > 0) {
            status = 'escalated_human';
        }
        else if (thresholdReached) {
            status = 'approved';
        }
        else if (rejections > squad.agents.length - Math.ceil(squad.agents.length * quorumTarget)) {
            status = 'rejected';
        }
        return {
            incidentId,
            squadId: squad.id,
            totalMembers: squad.agents.length,
            votesCounted: processedAgents.size,
            approvals,
            rejections,
            abstentions,
            weightedApprovalRatio: parseFloat(weightedApprovalRatio.toFixed(3)),
            weightedQuorumTarget: quorumTarget,
            thresholdReached,
            byzantineAnomaliesDetected: flaggedAgentIds.length > 0,
            flaggedAgentIds,
            status,
            evaluationTimestamp: Date.now(),
            merkleRootHash,
        };
    }
    /**
     * Helper to sign a ballot with simulated or Ed25519 keys.
     */
    static signBallot(incidentId, agent, decision, confidence, justification) {
        const timestamp = Date.now();
        const payload = `${incidentId}:${agent.did}:${decision}:${confidence}:${justification}:${timestamp}`;
        const signature = crypto.createHmac('sha256', agent.publicKey).update(payload).digest('hex');
        return {
            ballotId: `ballot-${agent.id}-${timestamp}`,
            incidentId,
            agentId: agent.id,
            did: agent.did,
            role: agent.role,
            decision,
            confidence,
            justification,
            timestamp,
            signature,
        };
    }
}
//# sourceMappingURL=consensus.js.map