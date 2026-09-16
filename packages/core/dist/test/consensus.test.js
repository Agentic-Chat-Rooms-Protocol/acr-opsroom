import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ByzantineConsensusEngine } from '../src/consensus.js';
import { MLIncidentRouter } from '../src/ml-router.js';
describe('ByzantineConsensusEngine', () => {
    const squad = MLIncidentRouter.createDefaultSquad('squad-sre-core');
    test('successfully approves plan when supermajority (>= 67%) agrees', () => {
        const ballots = [
            ByzantineConsensusEngine.signBallot('inc-1', squad.agents[0], 'approve', 0.95, 'Safe mitigation plan verified'),
            ByzantineConsensusEngine.signBallot('inc-1', squad.agents[1], 'approve', 0.90, 'Telemetry matches failover threshold'),
            ByzantineConsensusEngine.signBallot('inc-1', squad.agents[2], 'approve', 0.85, 'Zero-trust sandbox profile verified'),
            ByzantineConsensusEngine.signBallot('inc-1', squad.agents[3], 'approve', 0.80, 'Schema consistency preserved'),
            ByzantineConsensusEngine.signBallot('inc-1', squad.agents[4], 'reject', 0.70, 'Minor budget drift risk'),
        ];
        const result = ByzantineConsensusEngine.evaluateQuorum('inc-1', squad, ballots);
        assert.equal(result.status, 'approved');
        assert.equal(result.thresholdReached, true);
        assert.ok(result.weightedApprovalRatio >= 0.67);
        assert.equal(result.byzantineAnomaliesDetected, false);
        assert.ok(result.merkleRootHash.length === 64);
    });
    test('rejects when quorum threshold fails to reach 67%', () => {
        const ballots = [
            ByzantineConsensusEngine.signBallot('inc-2', squad.agents[0], 'approve', 0.8, 'Safe plan'),
            ByzantineConsensusEngine.signBallot('inc-2', squad.agents[1], 'reject', 0.9, 'Danger of data corruption'),
            ByzantineConsensusEngine.signBallot('inc-2', squad.agents[2], 'reject', 0.95, 'Security posture violated'),
            ByzantineConsensusEngine.signBallot('inc-2', squad.agents[3], 'reject', 0.85, 'WAL replication gap'),
        ];
        const result = ByzantineConsensusEngine.evaluateQuorum('inc-2', squad, ballots);
        assert.notEqual(result.status, 'approved');
        assert.equal(result.thresholdReached, false);
    });
    test('detects Byzantine ballot anomalies (tampered DID or negative confidence)', () => {
        const validBallot = ByzantineConsensusEngine.signBallot('inc-3', squad.agents[0], 'approve', 0.9, 'Safe plan');
        // Corrupted ballot with invalid confidence
        const corruptedBallot = {
            ...validBallot,
            ballotId: 'ballot-corrupt',
            confidence: -1.5,
        };
        const audit = ByzantineConsensusEngine.auditBallot(corruptedBallot, squad.agents[0]);
        assert.equal(audit.isFlagged, true);
        assert.equal(audit.reason, 'Invalid confidence bounds');
    });
    test('escalates to human commander when forceHumanGating or Byzantine fault is present', () => {
        const ballots = [
            ByzantineConsensusEngine.signBallot('inc-4', squad.agents[0], 'approve', 0.95, 'Safe plan'),
            ByzantineConsensusEngine.signBallot('inc-4', squad.agents[1], 'approve', 0.90, 'Safe plan'),
            // Injected malicious agent ballot
            {
                ballotId: 'ballot-malicious',
                incidentId: 'inc-4',
                agentId: squad.agents[2].id,
                did: 'did:key:fakeSpoofedIdentityKey',
                role: squad.agents[2].role,
                decision: 'approve',
                confidence: 0.99,
                justification: 'All good',
                timestamp: Date.now(),
                signature: 'invalid-signature-hash',
            }
        ];
        const result = ByzantineConsensusEngine.evaluateQuorum('inc-4', squad, ballots);
        assert.equal(result.status, 'escalated_human');
        assert.equal(result.byzantineAnomaliesDetected, true);
    });
    test('detects signature forgery and payload tampering', () => {
        const validBallot = ByzantineConsensusEngine.signBallot('inc-tamper', squad.agents[0], 'reject', 0.95, 'High risk of data loss');
        // Attacker modifies decision to 'approve' but keeps old signature
        const tamperedBallot = {
            ...validBallot,
            decision: 'approve',
        };
        const audit = ByzantineConsensusEngine.auditBallot(tamperedBallot, squad.agents[0]);
        assert.equal(audit.isFlagged, true);
        assert.equal(audit.reason, 'Cryptographic DID signature verification failed');
        // Attacker fabricates an invalid hex signature
        const forgedBallot = {
            ...validBallot,
            signature: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        };
        const auditForged = ByzantineConsensusEngine.auditBallot(forgedBallot, squad.agents[0]);
        assert.equal(auditForged.isFlagged, true);
        assert.equal(auditForged.reason, 'Cryptographic DID signature verification failed');
    });
    test('detects Sybil duplicate and equivocation attacks in quorum evaluation', () => {
        const agent0 = squad.agents[0];
        const agent1 = squad.agents[1];
        const agent2 = squad.agents[2];
        const b0 = ByzantineConsensusEngine.signBallot('inc-sybil', agent0, 'approve', 0.95, 'Plan verified');
        const b1 = ByzantineConsensusEngine.signBallot('inc-sybil', agent1, 'approve', 0.90, 'Plan verified');
        // Agent 2 equivocates: submits both approve and reject in the same round
        const b2Approve = ByzantineConsensusEngine.signBallot('inc-sybil', agent2, 'approve', 0.92, 'Approving plan');
        const b2Reject = ByzantineConsensusEngine.signBallot('inc-sybil', agent2, 'reject', 0.88, 'Rejecting secretly');
        const ballots = [b0, b1, b2Approve, b2Reject];
        const result = ByzantineConsensusEngine.evaluateQuorum('inc-sybil', squad, ballots);
        assert.equal(result.byzantineAnomaliesDetected, true);
        assert.ok(result.flaggedAgentIds.includes(agent2.id));
        assert.equal(result.status, 'escalated_human');
    });
});
//# sourceMappingURL=consensus.test.js.map