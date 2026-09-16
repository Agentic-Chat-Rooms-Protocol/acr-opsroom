import { OpsIncident, AgentSquad, AgentProfile } from '@acr-js/opsroom-core';

export interface IncidentPreset {
  id: string;
  title: string;
  description: string;
  severity: 'P0' | 'P1' | 'P2';
  category: 'Infrastructure & DB' | 'SecOps & Zero-Trust' | 'Cloud & Compute';
  telemetry: {
    name: string;
    value: number;
    unit: string;
    baseline: number;
    zScore: number;
  }[];
}

export const INCIDENT_PRESETS: IncidentPreset[] = [
  {
    id: 'preset-postgres-split-brain',
    title: 'PostgreSQL Read-Replica Replication Lag & Split-Brain Risk',
    description: 'Follower db-replica-03 replication lag exceeded 8,420ms. Primary node WAL sender buffer saturated. Write transactions stalling on read queries.',
    severity: 'P0',
    category: 'Infrastructure & DB',
    telemetry: [
      { name: 'Replication Lag', value: 8420, unit: 'ms', baseline: 15, zScore: 6.8 },
      { name: 'WAL Sender Buffer', value: 98.4, unit: '%', baseline: 25, zScore: 4.2 },
      { name: 'Stalled Transactions', value: 412, unit: 'tx/s', baseline: 2, zScore: 5.9 },
    ],
  },
  {
    id: 'preset-egress-anomaly',
    title: 'Suspicious Egress Volume & Unauthorized MCP Token Ingress',
    description: 'Unrecognized outbound network spike to unknown external endpoint 198.51.100.44 detected from worker-pod-88. Auth Vault flagged token mismatch.',
    severity: 'P1',
    category: 'SecOps & Zero-Trust',
    telemetry: [
      { name: 'Egress Traffic Spike', value: 4850, unit: 'MB/s', baseline: 120, zScore: 5.4 },
      { name: 'Auth Vault Ingress Mismatches', value: 37, unit: 'req/m', baseline: 0, zScore: 7.1 },
      { name: 'Quarantine Status', value: 1, unit: 'active', baseline: 0, zScore: 3.5 },
    ],
  },
  {
    id: 'preset-ingress-oom',
    title: 'Kubernetes Ingress Gateway CrashLoopBackOff & 503 Cascade',
    description: 'Traefik ingress router crashing due to memory ceiling exhaustion during payload reassembly. Latency p99 degraded to 4,200ms.',
    severity: 'P2',
    category: 'Cloud & Compute',
    telemetry: [
      { name: '503 Gateway Errors', value: 14.8, unit: '%', baseline: 0.02, zScore: 4.6 },
      { name: 'p99 Ingress Latency', value: 4200, unit: 'ms', baseline: 180, zScore: 5.1 },
      { name: 'Pod Restarts (10m)', value: 18, unit: 'events', baseline: 0, zScore: 4.9 },
    ],
  },
];

export const DEFAULT_SQUAD_AGENTS: AgentProfile[] = [
  {
    id: 'agent-atlas-1',
    did: 'did:key:z6MkuSREatlasOrchestrator0184x7',
    role: 'atlas_orchestrator',
    name: 'Atlas 2.0 Orchestrator',
    capabilities: ['Goal Decomposition', 'Dynamic DAG State Machine', 'Consensus Gating'],
    voteWeight: 1.5,
    publicKey: '037b5a19c671b56a3e9c4d924151b6817290fbb0124803d2745300fbc4b48ec193',
    status: 'idle',
  },
  {
    id: 'agent-sre-1',
    did: 'did:key:z6MkuSREreliabilityGuardian0927v1',
    role: 'sre_reliability',
    name: 'SRE Reliability Guardian',
    capabilities: ['Telemetry Diagnostics', 'Automatic Failover', 'Circuit Breaking'],
    voteWeight: 1.2,
    publicKey: '0289a3f912e75390bb9a6ec27265bc1010375685718dfb01037365027464917a12',
    status: 'idle',
  },
  {
    id: 'agent-secops-1',
    did: 'did:key:z6MkuSecOpsZeroTrustSentinel442m9',
    role: 'secops_guardian',
    name: 'SecOps Zero-Trust Sentinel',
    capabilities: ['ToolHive Sandboxing', 'Egress Inspection', 'Dual-Consent Enforcement'],
    voteWeight: 1.3,
    publicKey: '02fba7295719302847cbb391054a88371904726510378401928471928374619284',
    status: 'idle',
  },
  {
    id: 'agent-dataops-1',
    did: 'did:key:z6MkuDataOpsIntegrityMarshal831p5',
    role: 'dataops_engineer',
    name: 'DataOps Integrity Marshal',
    capabilities: ['Schema Validation', 'WAL Inspection', 'Replication Repair'],
    voteWeight: 1.0,
    publicKey: '031029384756192837465928172635481920394857162534182930495817263541',
    status: 'idle',
  },
  {
    id: 'agent-finops-1',
    did: 'did:key:z6MkuFinOpsResourceOverseer109w8',
    role: 'finops_overseer',
    name: 'FinOps Resource Overseer',
    capabilities: ['Token Burn Rate Guard', 'Compute Budget Ceiling', 'Egress Toll Tracking'],
    voteWeight: 1.0,
    publicKey: '029485716253410293847561829304958172635418293049581726354819203948',
    status: 'idle',
  },
];

export const BATTLECARD_ITEMS = [
  {
    feature: 'Multi-Agent Reasoning',
    agentforce: 'Single-agent prompt chaining; rigid pre-made templates; no cross-agent critique.',
    opsroom: 'Atlas 2.0 Dynamic Graph State Machine; heterogeneous specialized squads deliberating in parallel.',
    winner: 'ACR OpsRoom',
  },
  {
    feature: 'Safety & Fault Tolerance',
    agentforce: 'Single LLM decision; vulnerable to hallucinations; unverified CRM write actions.',
    opsroom: 'Byzantine Fault Tolerant (BFT) Quorum Consensus with 2/3 supermajority & Ed25519 signatures.',
    winner: 'ACR OpsRoom',
  },
  {
    feature: 'Tool Sandboxing & Security',
    agentforce: 'Standard CRM object permissions; no process containment; broad cloud API keys.',
    opsroom: 'ToolHive-inspired micro-sandboxing via acr-meta-mcp (no-network, egress-allowlist, readonly-fs).',
    winner: 'ACR OpsRoom',
  },
  {
    feature: 'Collaborative Surface',
    agentforce: 'Static Slack channel messages + passive Slack Canvas with slow, asynchronous syncing.',
    opsroom: 'Live Collaborative Ops Canvas: real-time telemetry graphs, DAG state progression, synthetic huddles.',
    winner: 'ACR OpsRoom',
  },
  {
    feature: 'Audit & Compliance',
    agentforce: 'Proprietary cloud event logs; prone to administrator modification or loss.',
    opsroom: 'Cryptographic Merkle Audit Ledger; exportable tamper-evident SOC2 / ISO27001 certificates.',
    winner: 'ACR OpsRoom',
  },
  {
    feature: 'Cost & Vendor Lock-In',
    agentforce: '$2.00 per conversation + $500/month org base + Data Cloud consumption credits.',
    opsroom: '100% Open-Source Protocol (Apache-2.0); self-hostable with $0 per-conversation tax.',
    winner: 'ACR OpsRoom',
  },
];
