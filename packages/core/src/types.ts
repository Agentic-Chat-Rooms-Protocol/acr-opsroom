/**
 * ACR OpsRoom - Canonical Types & Data Models
 * The Cryptographic, Byzantine-Fault-Tolerant War Room for Autonomous Enterprise AI.
 * Beyond Salesforce Agentforce & Slack.
 */

export type OpsSeverity = 'P0' | 'P1' | 'P2' | 'P3';

export type IncidentStatus = 
  | 'detecting'
  | 'deliberating'
  | 'awaiting_quorum'
  | 'executing'
  | 'verifying'
  | 'resolved'
  | 'mitigated'
  | 'escalated_human'
  | 'aborted';

export interface TelemetryMetric {
  metricName: string;
  value: number;
  unit: string;
  baselineMean: number;
  baselineStd: number;
  zScore: number;
  iqrLower?: number;
  iqrUpper?: number;
  isAnomaly: boolean;
  timestamp: number;
}

export type AgentRole = 
  | 'atlas_orchestrator'
  | 'sre_reliability'
  | 'secops_guardian'
  | 'dataops_engineer'
  | 'finops_overseer'
  | 'compliance_auditor';

export interface AgentProfile {
  id: string;
  did: string;
  role: AgentRole;
  name: string;
  capabilities: string[];
  voteWeight: number;
  publicKey: string;
  status: 'idle' | 'deliberating' | 'voting' | 'executing';
}

export interface AgentSquad {
  id: string;
  name: string;
  specialization: string;
  agents: AgentProfile[];
  consensusThreshold: number; // e.g., 0.67 for 2/3 Byzantine fault tolerance
}

export type DeliberationPhase = 
  | 'detect'
  | 'ground'
  | 'deliberate'
  | 'quorum'
  | 'execute'
  | 'verify'
  | 'completed'
  | 'vetoed';

export interface ToolCallProposal {
  toolName: string;
  serverName: string;
  parameters: Record<string, unknown>;
  isDryRun: boolean;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

export interface DeliberationTurn {
  id: string;
  turnIndex: number;
  agentId: string;
  role: AgentRole;
  agentName: string;
  phase: DeliberationPhase;
  reasoning: string;
  proposedHypothesis?: string;
  proposedActions: ToolCallProposal[];
  confidence: number; // 0.0 - 1.0
  timestamp: number;
  signature: string; // Ed25519 signature of payload
}

export type VoteDecision = 'approve' | 'reject' | 'abstain';

export interface ConsensusBallot {
  ballotId: string;
  incidentId: string;
  agentId: string;
  did: string;
  role: AgentRole;
  decision: VoteDecision;
  confidence: number;
  justification: string;
  timestamp: number;
  signature: string;
}

export interface QuorumEvaluation {
  incidentId: string;
  squadId: string;
  totalMembers: number;
  votesCounted: number;
  approvals: number;
  rejections: number;
  abstentions: number;
  weightedApprovalRatio: number;
  weightedQuorumTarget: number;
  thresholdReached: boolean;
  byzantineAnomaliesDetected: boolean;
  flaggedAgentIds: string[];
  status: 'approved' | 'rejected' | 'insufficient_quorum' | 'escalated_human';
  evaluationTimestamp: number;
  merkleRootHash: string;
}

export type SandboxProfile = 
  | 'no-network'
  | 'egress-allowlist'
  | 'readonly-fs'
  | 'workspace-scoped';

export interface ExecutionStep {
  id: string;
  stepNumber: number;
  title: string;
  toolName: string;
  serverTarget: string;
  parameters: Record<string, unknown>;
  sandboxProfile: SandboxProfile;
  requiresDualConsent: boolean;
  status: 'pending' | 'dry_run_passed' | 'executing' | 'completed' | 'failed' | 'rolled_back';
  output?: Record<string, unknown>;
  error?: string;
  durationMs: number;
  auditHash: string;
}

export interface ExecutionPlan {
  planId: string;
  incidentId: string;
  targetGoal: string;
  steps: ExecutionStep[];
  dryRunValidated: boolean;
  canRollback: boolean;
  createdAt: number;
  completedAt?: number;
}

export interface CanvasActionItem {
  id: string;
  title: string;
  assignedToRole: AgentRole;
  status: 'todo' | 'in_progress' | 'verified' | 'blocked';
  priority: 'p0' | 'p1' | 'p2';
  proofUrl?: string;
}

export interface OpsCanvas {
  id: string;
  incidentId: string;
  title: string;
  version: number;
  status: IncidentStatus;
  summaryMarkdown: string;
  actionItems: CanvasActionItem[];
  liveFields: {
    serviceName: string;
    affectedCluster: string;
    trafficImpactPercent: number;
    errorRateSpike: number;
    estimatedCostDriftUsd: number;
    activeQuorumRatio: number;
    mcpSandboxIsolation: string;
  };
  auditMerkleRoot: string;
  lastUpdated: number;
}

export interface HuddleLine {
  speakerId: string;
  speakerName: string;
  role: AgentRole;
  text: string;
  audioFrequencyData?: number[];
  timestamp: number;
}

export interface HuddleSession {
  id: string;
  incidentId: string;
  status: 'active' | 'summarized' | 'concluded';
  participants: AgentProfile[];
  lines: HuddleLine[];
  executiveBrief: string;
  keyActionItemsExtracted: string[];
  canvasSyncTimestamp: number;
}

export interface AuditBlock {
  index: number;
  timestamp: number;
  incidentId: string;
  actionType: 'INCIDENT_TRIGGERED' | 'DELIBERATION_TURN' | 'CONSENSUS_BALLOT' | 'QUORUM_EVALUATION' | 'STEP_EXECUTION' | 'CANVAS_MUTATION';
  payloadHash: string;
  previousHash: string;
  blockHash: string;
  signatures: Array<{ did: string; signature: string }>;
}

export interface OpsIncident {
  id: string;
  title: string;
  description: string;
  severity: OpsSeverity;
  status: IncidentStatus;
  createdAt: number;
  resolvedAt?: number;
  telemetry: TelemetryMetric[];
  squad: AgentSquad;
  deliberationTurns: DeliberationTurn[];
  ballots: ConsensusBallot[];
  quorum?: QuorumEvaluation;
  executionPlan?: ExecutionPlan;
  canvas: OpsCanvas;
  huddle?: HuddleSession;
}
