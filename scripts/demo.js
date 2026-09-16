#!/usr/bin/env node
/**
 * ACR OpsRoom - Terminal Deliberation & BFT Quorum Demo
 */

import { 
  Atlas2Engine, 
  MLIncidentRouter, 
  MLStatisticalDetector, 
  ByzantineConsensusEngine, 
  HuddleManager, 
  SandboxExecutor, 
  CryptographicAuditLedger 
} from '../packages/core/dist/src/index.js';

console.log('======================================================================');
console.log('       ACR OPSROOM: AUTONOMOUS WAR ROOM & BYZANTINE DELIBERATION      ');
console.log('======================================================================\n');

// 1. Ingest telemetry & detect anomaly
const telemetrySamples = [12, 14, 15, 13, 16, 14, 8420];
console.log('[1/6] Ingesting real-time telemetry window (replication_lag_ms):', telemetrySamples);

const anomaly = MLStatisticalDetector.detectAnomaly(
  'db_replication_lag_ms',
  telemetrySamples[telemetrySamples.length - 1],
  telemetrySamples.slice(0, telemetrySamples.length - 1)
);
console.log(`      -> Outlier Detected! Z-Score: ${anomaly.zScore}, Severity: ${anomaly.severity}`);

// 2. Route to specialized squad
const routing = MLIncidentRouter.routeIncidentToSquad(
  'PostgreSQL Follower Out-of-Sync',
  'Primary WAL buffer saturated; replica lag critical',
  [anomaly]
);
console.log(`\n[2/6] ML Router dispatched to: [${routing.squadName}] (Score: ${routing.similarityScore})`);

const squad = MLIncidentRouter.createDefaultSquad(routing.squadId);
const incident = Atlas2Engine.createIncident(
  'PostgreSQL Follower Out-of-Sync',
  'Primary WAL buffer saturated; replica lag critical',
  squad
);

// 3. Multi-agent deliberation turns
console.log(`\n[3/6] Starting Multi-Agent Squad Deliberation Turns:`);
Atlas2Engine.transitionPhase(incident, 'deliberating');

const turn1 = Atlas2Engine.addDeliberationTurn(
  incident,
  squad.agents[1], // SRE
  'Detected 8.4s WAL sender buffer lag. Proposing drain and isolated failover to replica-01.',
  'WAL Buffer Saturation',
  [{
    toolName: 'isolate_failing_replica',
    serverName: 'acr-db-mcp',
    parameters: { target: 'db-replica-03' },
    isDryRun: true,
    riskLevel: 'medium'
  }]
);
console.log(`      Turn #1 [${turn1.agentName}]: ${turn1.reasoning}`);
console.log(`              Ed25519 Sig: ${turn1.signature.substring(0, 24)}...`);

const turn2 = Atlas2Engine.addDeliberationTurn(
  incident,
  squad.agents[2], // SecOps
  'Zero-Trust container isolation profile verified. Egress firewall locked.',
  'Sandbox Verified',
  []
);
console.log(`      Turn #2 [${turn2.agentName}]: ${turn2.reasoning}`);

// 4. Quorum consensus voting
console.log(`\n[4/6] Conducting Byzantine Quorum Consensus Ballot:`);
Atlas2Engine.transitionPhase(incident, 'awaiting_quorum');

const ballots = [
  ByzantineConsensusEngine.signBallot(incident.id, squad.agents[0], 'approve', 0.98, 'DAG validated'),
  ByzantineConsensusEngine.signBallot(incident.id, squad.agents[1], 'approve', 0.95, 'Threshold met'),
  ByzantineConsensusEngine.signBallot(incident.id, squad.agents[2], 'approve', 0.96, 'Sandbox verified'),
  ByzantineConsensusEngine.signBallot(incident.id, squad.agents[3], 'approve', 0.92, 'Schema intact'),
  ByzantineConsensusEngine.signBallot(incident.id, squad.agents[4], 'approve', 0.88, 'Cost drift safe'),
];
incident.ballots = ballots;

const quorum = ByzantineConsensusEngine.evaluateQuorum(incident.id, squad, ballots);
console.log(`      -> Quorum Status: ${quorum.status.toUpperCase()}`);
console.log(`      -> Weighted Approval Ratio: ${(quorum.weightedApprovalRatio * 100).toFixed(1)}% (Target: ${(quorum.weightedQuorumTarget * 100).toFixed(1)}%)`);
console.log(`      -> Ballots Merkle Root: ${quorum.merkleRootHash.substring(0, 32)}...`);

// 5. Sandboxed execution
console.log(`\n[5/6] Authorizing Sandboxed Tool Execution:`);
const plan = Atlas2Engine.compileExecutionPlan(incident, 'Isolate failing replica and reroute');
Atlas2Engine.simulateDryRun(plan);

const executor = new SandboxExecutor();
const execResult = await executor.executePlan(plan, true);
console.log(`      -> Plan Execution Succeeded: ${execResult.allSucceeded}`);
for (const receipt of execResult.receipts) {
  console.log(`         [${receipt.sandboxProfile}] ${receipt.outputSummary}`);
}

// 6. Cryptographic audit certificate
console.log(`\n[6/6] Generating Compliance Audit Proof:`);
const ledger = new CryptographicAuditLedger(incident.id);
ledger.recordBlock(incident.id, 'DELIBERATION_TURN', { turnsCount: incident.deliberationTurns.length });
ledger.recordBlock(incident.id, 'QUORUM_EVALUATION', { quorum });
ledger.recordBlock(incident.id, 'STEP_EXECUTION', { receipts: execResult.receipts });

const cert = ledger.generateComplianceCertificate(incident.id);
console.log(`      -> Certificate ID: ${cert.certificateId}`);
console.log(`      -> Merkle Root Hash: ${cert.merkleRootHash}`);
console.log(`      -> Integrity Status: ${cert.complianceValid ? 'VERIFIED (SOC2 / ISO27001 Valid)' : 'COMPROMISED'}\n`);

console.log('======================================================================');
console.log('       AUTONOMOUS WAR ROOM RESOLUTION COMPLETE (ZERO DOWNTIME)       ');
console.log('======================================================================');
