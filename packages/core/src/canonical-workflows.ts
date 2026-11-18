/**
 * Canonical 18 Workflow Definitions & Contract Parity for ACR OpsRoom.
 *
 * Synchronized 1-for-1 with `acr-web/api/_utils/cloudWorkflows.mjs`,
 * `acr-web/api/_utils/cloudWorkflowService.mjs`, and `acr-web/src/lib/workflowRegistry.ts`.
 */

import { OpsSeverity } from './types.js';

export type WorkflowRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface CanonicalWorkflowStep {
  id: string;
  title: string;
  tool: string;
  server: string;
  risk: WorkflowRiskLevel;
  parameters: Record<string, unknown>;
  dependencies?: string[];
  requiresDualConsent?: boolean;
}

export interface CanonicalWorkflowConfigField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  defaultValue: unknown;
  options?: string[];
  min?: number;
  max?: number;
  description: string;
  required?: boolean;
}

export interface CanonicalWorkflowDefinition {
  id: string;
  presetId: string;
  aliases: string[];
  name: string;
  title: string;
  category: string;
  severity: OpsSeverity;
  rfc: string;
  description: string;
  steps: CanonicalWorkflowStep[];
  configSchema: CanonicalWorkflowConfigField[];
  defaultConfig: Record<string, unknown>;
}

export interface CanonicalWorkflowStepState {
  stepId: string;
  index: number;
  title: string;
  tool: string;
  server: string;
  risk: WorkflowRiskLevel;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  startedAt: string | null;
  completedAt: string | null;
  outputs: Record<string, unknown> | null;
}

export interface CanonicalWorkflowState {
  workflowId: string;
  canonicalId: string;
  status: 'idle' | 'in_progress' | 'completed' | 'failed';
  currentStepIndex: number;
  totalSteps: number;
  config: Record<string, unknown>;
  startedAt: string;
  completedAt: string | null;
  steps: CanonicalWorkflowStepState[];
}

export interface WorkflowConfigJsonSchema {
  type: 'object';
  additionalProperties: false;
  properties: Record<string, Record<string, unknown>>;
}

export interface WorkflowContractDefinition {
  id: string;
  preset_id: string;
  name: string;
  category: string;
  protocol_reference: string;
  intent: string;
  config_schema: WorkflowConfigJsonSchema;
  default_config: Record<string, unknown>;
  execution_supported: boolean;
}

export interface WorkflowContractExport {
  schemaVersion: '1.0';
  registryRevision: string;
  workflows: WorkflowContractDefinition[];
}

export const CANONICAL_WORKFLOWS: CanonicalWorkflowDefinition[] = [
  // 1. PostgreSQL Split-Brain
  {
    id: 'postgres-split-brain',
    presetId: 'preset-postgres-split-brain',
    aliases: [
      'postgres-split-brain',
      'preset-postgres-split-brain',
      'postgres_split_brain',
      'db-failover-ops',
    ],
    name: 'PostgreSQL Read-Replica Lag & Split-Brain Mitigation',
    title: 'PostgreSQL Read-Replica Replication Lag & Split-Brain Risk',
    category: 'Infrastructure & DB',
    severity: 'P0',
    rfc: 'RFC-0016 / RFC-0002',
    description:
      'Isolate lagging follower db-replica-03 and route read traffic to healthy secondary replica read-replica-01.',
    steps: [
      {
        id: 'isolate_replica',
        title: 'Isolate Failing Follower Replica',
        tool: 'isolate_failing_node',
        server: 'acr-sre-mcp',
        risk: 'medium',
        parameters: { targetNode: 'db-replica-03', drainGraceSec: 5 },
        dependencies: [],
      },
      {
        id: 'reroute_reads',
        title: 'Activate Secondary Read Route',
        tool: 'activate_secondary_route',
        server: 'acr-mesh-mcp',
        risk: 'low',
        parameters: { targetRoute: 'read-replica-01' },
        dependencies: ['isolate_replica'],
      },
    ],
    configSchema: [
      {
        key: 'drainGraceSec',
        label: 'Drain Grace Period (seconds)',
        type: 'number',
        defaultValue: 5,
        min: 0,
        max: 60,
        description: 'Time allocated to finish in-flight read queries before detaching follower replica.',
        required: true,
      },
      {
        key: 'failoverTarget',
        label: 'Failover Target Replica',
        type: 'select',
        defaultValue: 'read-replica-01',
        options: ['read-replica-01', 'read-replica-02', 'db-standby-sync'],
        description: 'Target secondary replica to receive read traffic redirect.',
      },
    ],
    defaultConfig: { drainGraceSec: 5, failoverTarget: 'read-replica-01' },
  },

  // 2. Suspicious Egress Volume & Token Quarantine
  {
    id: 'egress-token-anomaly',
    presetId: 'preset-egress-anomaly',
    aliases: [
      'egress-anomaly',
      'preset-egress-anomaly',
      'egress-token-anomaly',
      'preset-egress-token-anomaly',
      'egress_token_anomaly',
      'egress_anomaly',
    ],
    name: 'Suspicious Egress Volume & Token Quarantine',
    title: 'Suspicious Egress Volume & Unauthorized MCP Token Ingress',
    category: 'SecOps & Zero-Trust',
    severity: 'P1',
    rfc: 'RFC-0018 / RFC-0021 / Onyxbox',
    description:
      'Quarantine compromised worker pod, revoke leaked Autovault token, and shift egress traffic to verified mesh gateway.',
    steps: [
      {
        id: 'quarantine_pod',
        title: 'Quarantine Compromised Worker Pod',
        tool: 'quarantine_pod',
        server: 'acr-secops-mcp',
        risk: 'high',
        parameters: { podId: 'worker-pod-88', networkPolicy: 'deny-all' },
        dependencies: [],
        requiresDualConsent: true,
      },
      {
        id: 'revoke_token',
        title: 'Revoke Compromised Auth Vault Token',
        tool: 'revoke_vault_token',
        server: 'acr-auth-vault-mcp',
        risk: 'medium',
        parameters: { tokenId: 'tok_mcp_unauth_88' },
        dependencies: ['quarantine_pod'],
      },
      {
        id: 'shift_traffic',
        title: 'Shift Egress Traffic to Verified Gateway',
        tool: 'shift_traffic_mesh',
        server: 'acr-mesh-mcp',
        risk: 'low',
        parameters: { targetGateway: 'egress-gw-verified-01' },
        dependencies: ['revoke_token'],
      },
    ],
    configSchema: [
      {
        key: 'quarantineNamespace',
        label: 'Pod Kubernetes Namespace',
        type: 'string',
        defaultValue: 'mesh-workers',
        description: 'Cluster namespace where compromised pod is executing.',
        required: true,
      },
      {
        key: 'cascadeTokenRevocation',
        label: 'Cascade Token Revocation to Child Scopes',
        type: 'boolean',
        defaultValue: true,
        description: 'Whether to invalidate all downstream API tokens minted by this token.',
      },
    ],
    defaultConfig: { quarantineNamespace: 'mesh-workers', cascadeTokenRevocation: true },
  },

  // 3. Kubernetes Ingress OOM Recovery
  {
    id: 'ingress-oom-autoscaling',
    presetId: 'preset-ingress-oom',
    aliases: [
      'ingress-oom',
      'preset-ingress-oom',
      'ingress-oom-autoscaling',
      'preset-ingress-oom-autoscaling',
      'ingress_oom',
      'ingress_oom_autoscaling',
    ],
    name: 'Ingress OOM Recovery & Dynamic Autoscaling',
    title: 'Kubernetes Ingress Gateway CrashLoopBackOff & 503 Cascade',
    category: 'Cloud & Compute',
    severity: 'P2',
    rfc: 'RFC-0016 / ToolHive',
    description:
      'Patch Traefik memory allocation ceiling (+1.5 GiB) and scale deployment replicas from 4 to 12.',
    steps: [
      {
        id: 'patch_limits',
        title: 'Patch Ingress Gateway Memory Limit',
        tool: 'patch_deployment_resources',
        server: 'acr-k8s-mcp',
        risk: 'medium',
        parameters: { deployment: 'traefik-ingress', memoryLimit: '2.5Gi' },
        dependencies: [],
      },
      {
        id: 'scale_replicas',
        title: 'Autoscale Ingress Replica Pool',
        tool: 'scale_ingress_replicas',
        server: 'acr-k8s-mcp',
        risk: 'low',
        parameters: { deployment: 'traefik-ingress', replicas: 12 },
        dependencies: ['patch_limits'],
      },
    ],
    configSchema: [
      {
        key: 'targetReplicas',
        label: 'Target Replica Count',
        type: 'number',
        defaultValue: 12,
        min: 1,
        max: 50,
        description: 'Horizontal pod scale target for load rebalancing.',
      },
      {
        key: 'memoryLimit',
        label: 'New Memory Limit',
        type: 'string',
        defaultValue: '2.5Gi',
        description: 'Memory ceiling string per pod container resource spec.',
      },
    ],
    defaultConfig: { targetReplicas: 12, memoryLimit: '2.5Gi' },
  },

  // 4. Canary Rollout & Checkpoint Rollback
  {
    id: 'canary-deployment-rollback',
    presetId: 'preset-canary-rollback',
    aliases: [
      'canary-rollback',
      'preset-canary-rollback',
      'canary-deployment-rollback',
      'preset-canary-deployment-rollback',
      'canary_rollback',
      'canary_deployment_rollback',
    ],
    name: 'Canary Rollout & Automated Checkpoint Rollback',
    title: 'Canary Deployment Error Budget Depletion & Automated DAG Rollback',
    category: 'CI/CD & Rollout',
    severity: 'P1',
    rfc: 'RFC-0016 / RFC-0012 / Atlas 2.0',
    description:
      'Drain canary gateway traffic, verify baseline cluster health, and trigger deterministic rollback to stable release v2.4.0.',
    steps: [
      {
        id: 'drain_canary',
        title: 'Drain Inbound Canary Traffic',
        tool: 'drain_canary_traffic',
        server: 'acr-mesh-mcp',
        risk: 'medium',
        parameters: { canaryPercentage: 0, drainGraceSec: 10 },
        dependencies: [],
      },
      {
        id: 'rollback_release',
        title: 'Trigger Checkpoint Rollback to v2.4.0',
        tool: 'trigger_checkpoint_rollback',
        server: 'acr-k8s-mcp',
        risk: 'high',
        parameters: { targetRelease: 'v2.4.0', runMerkleVerification: true },
        dependencies: ['drain_canary'],
        requiresDualConsent: true,
      },
    ],
    configSchema: [
      {
        key: 'targetReleaseVersion',
        label: 'Stable Target Version',
        type: 'string',
        defaultValue: 'v2.4.0',
        description: 'Known stable image tag or semantic version for rollback.',
        required: true,
      },
    ],
    defaultConfig: { targetReleaseVersion: 'v2.4.0' },
  },

  // 5. AST Diff Code Review & TLA+ Deadlock Proof
  {
    id: 'code-review-tla-verification',
    presetId: 'preset-code-review-tla',
    aliases: [
      'code-review-tla',
      'preset-code-review-tla',
      'code-review-tla-verification',
      'preset-code-review-tla-verification',
      'code_review_tla',
    ],
    name: 'AST Diff Code Review & TLA+ Deadlock Proof',
    title: 'AST Semantic Diff Inspection & TLA+ Concurrency Deadlock Proof',
    category: 'Quality & Formal Methods',
    severity: 'P2',
    rfc: 'RFC-0002 / TLA+ / Agentflex',
    description:
      'Run deterministic AST parsing, invoke TLC model checker on ACRCompositionSafety.tla, and record review consensus.',
    steps: [
      {
        id: 'parse_ast',
        title: 'Parse Semantic AST Diff',
        tool: 'parse_ast_diff',
        server: 'acr-code-mcp',
        risk: 'low',
        parameters: { repo: 'acr-core', targetBranch: 'main' },
        dependencies: [],
      },
      {
        id: 'run_tla',
        title: 'Execute TLC Model Checker on ACRCompositionSafety.tla',
        tool: 'execute_tla_model_checker',
        server: 'acr-tla-mcp',
        risk: 'low',
        parameters: { specPath: 'formal/ACRCompositionSafety.tla', workers: 4 },
        dependencies: ['parse_ast'],
      },
    ],
    configSchema: [
      {
        key: 'tlaWorkers',
        label: 'TLC Worker Concurrency',
        type: 'number',
        defaultValue: 4,
        min: 1,
        max: 32,
        description: 'Number of parallel threads for TLC state space exploration.',
      },
    ],
    defaultConfig: { tlaWorkers: 4 },
  },

  // 6. SAIF Compliance & WASI Fuel Budget Audit
  {
    id: 'saif-compliance-audit',
    presetId: 'preset-saif-audit',
    aliases: [
      'saif-audit',
      'preset-saif-audit',
      'saif-compliance-audit',
      'preset-saif-compliance-audit',
      'saif_audit',
    ],
    name: 'SAIF Compliance & WASI Fuel Budget Audit',
    title: 'SAIF Model Security Audit & WASI Fuel Budget Enforcement',
    category: 'Compliance & Security',
    severity: 'P1',
    rfc: 'RFC-0018 / RFC-0019 / SAIF',
    description:
      'Audit WASI runtime fuel consumption, clamp container capability bitmask, and emit tamper-evident SOC2 audit proof.',
    steps: [
      {
        id: 'audit_fuel',
        title: 'Audit WASI Runtime Fuel Consumption',
        tool: 'audit_wasi_fuel_consumption',
        server: 'acr-secops-mcp',
        risk: 'low',
        parameters: { maxFuelThreshold: 10000000 },
        dependencies: [],
      },
      {
        id: 'clamp_caps',
        title: 'Enforce Zero-Trust Capability Bitmask',
        tool: 'enforce_capability_bitmask',
        server: 'acr-secops-mcp',
        risk: 'medium',
        parameters: { allowedBits: ['NET_OUT_SECURED', 'FS_READ_SCOPED'] },
        dependencies: ['audit_fuel'],
      },
    ],
    configSchema: [
      {
        key: 'complianceFramework',
        label: 'Compliance Standard',
        type: 'select',
        defaultValue: 'SAIF-Core-v2',
        options: ['SAIF-Core-v2', 'SOC2-Type-II', 'ISO-27001-AI', 'NIST-AI-RMF'],
        description: 'Regulatory compliance framework for emitted audit proofs.',
      },
    ],
    defaultConfig: { complianceFramework: 'SAIF-Core-v2' },
  },

  // 7. BFT Multi-Agent Deliberation & 67% Quorum Gate
  {
    id: 'bft-consensus-deliberation',
    presetId: 'preset-bft-deliberation',
    aliases: [
      'bft-deliberation',
      'preset-bft-deliberation',
      'bft-consensus-deliberation',
      'preset-bft-consensus-deliberation',
      'bft_consensus_deliberation',
    ],
    name: 'BFT Multi-Agent Deliberation & 67% Quorum Gate',
    title: 'Byzantine Fault-Tolerant Multi-Agent Deliberation & 67% Quorum Gate',
    category: 'Governance & Consensus',
    severity: 'P1',
    rfc: 'RFC-0002 / RFC-0012 / GAP-08',
    description:
      'Facilitate adversarial deliberation between Claude, GPT, and Gemini agents, capture signed ballots, and enforce 2/3 BFT supermajority.',
    steps: [
      {
        id: 'open_ballot',
        title: 'Open Cryptographic Proposal Ballot',
        tool: 'acr_create_consensus_proposal',
        server: 'acr-consensus-mcp',
        risk: 'low',
        parameters: { quorumThreshold: 0.67 },
        dependencies: [],
      },
      {
        id: 'tally_votes',
        title: 'Tally Signed Ballots and Verify 67% Quorum',
        tool: 'acr_evaluate_bft_quorum',
        server: 'acr-consensus-mcp',
        risk: 'low',
        parameters: { minVoters: 3 },
        dependencies: ['open_ballot'],
      },
    ],
    configSchema: [
      {
        key: 'quorumThreshold',
        label: 'Consensus Threshold (fraction)',
        type: 'number',
        defaultValue: 0.67,
        min: 0.51,
        max: 1.0,
        description: 'Supermajority fraction required to pass proposal.',
        required: true,
      },
    ],
    defaultConfig: { quorumThreshold: 0.67 },
  },

  // 8. Twinseal Passkey Dual-Consent Approval Gate
  {
    id: 'twinseal-passkey-approval',
    presetId: 'preset-twinseal-consent',
    aliases: [
      'twinseal-consent',
      'preset-twinseal-consent',
      'twinseal-passkey-approval',
      'preset-twinseal-passkey-approval',
      'twinseal_consent',
    ],
    name: 'Twinseal Passkey Dual-Consent Approval Gate',
    title: 'Twinseal WebAuthn Passkey Dual-Consent Gate for Privileged Mutation',
    category: 'Human-in-the-Loop',
    severity: 'P0',
    rfc: 'RFC-0012 / WebAuthn / Twinseal',
    description:
      'Issue cryptographic consent challenge, park execution runner in fail-closed state, and verify dual WebAuthn signatures.',
    steps: [
      {
        id: 'issue_challenge',
        title: 'Issue Cryptographic Consent Challenge',
        tool: 'issue_consent_challenge',
        server: 'acr-approvals-mcp',
        risk: 'critical',
        parameters: { scope: 'mutation:drop_table_partition', ttlSeconds: 300 },
        dependencies: [],
        requiresDualConsent: true,
      },
      {
        id: 'verify_signatures',
        title: 'Verify Dual WebAuthn Passkey Signatures',
        tool: 'verify_passkey_consent_envelope',
        server: 'acr-approvals-mcp',
        risk: 'high',
        parameters: { minPasskeys: 2 },
        dependencies: ['issue_challenge'],
        requiresDualConsent: true,
      },
    ],
    configSchema: [
      {
        key: 'challengeTtlSec',
        label: 'Challenge Expiry TTL (seconds)',
        type: 'number',
        defaultValue: 300,
        min: 30,
        max: 1800,
        description: 'Time window during which human commanders must complete passkey gesture.',
      },
    ],
    defaultConfig: { challengeTtlSec: 300 },
  },

  // 9. Durable WAL Recovery & Idempotency Reconcile
  {
    id: 'durable-wal-recovery',
    presetId: 'preset-durable-wal-recovery',
    aliases: [
      'durable-wal-recovery',
      'preset-durable-wal-recovery',
      'durable_wal_recovery',
      'wal-recovery',
    ],
    name: 'Durable WAL Recovery & Idempotency Reconcile',
    title: 'Durable Command WAL Reconcile & Side-Effect Idempotency Recovery',
    category: 'Data & Engine Lifecycles',
    severity: 'P1',
    rfc: 'RFC-0016 / DurableCommandWal / ADR-0041',
    description:
      'Inspect append-only WAL, detect DISPATCHED state prior to crash, probe external API, and reconcile without duplicating mutations.',
    steps: [
      {
        id: 'inspect_wal',
        title: 'Inspect Command WAL for Stalled DISPATCHED Records',
        tool: 'inspect_command_wal',
        server: 'acr-wal-mcp',
        risk: 'low',
        parameters: { targetTable: 'command_wal_events' },
        dependencies: [],
      },
      {
        id: 'probe_reconcile',
        title: 'Probe External Resource & Reconcile Idempotency State',
        tool: 'reconcile_external_side_effect',
        server: 'acr-wal-mcp',
        risk: 'low',
        parameters: { reconcileMode: 'idempotent_read_after_write' },
        dependencies: ['inspect_wal'],
      },
    ],
    configSchema: [
      {
        key: 'reconcileTimeoutMs',
        label: 'Reconciliation Probe Timeout (ms)',
        type: 'number',
        defaultValue: 5000,
        min: 500,
        max: 30000,
        description: 'Maximum latency wait for upstream provider response before declaring OUTCOME_UNKNOWN.',
      },
    ],
    defaultConfig: { reconcileTimeoutMs: 5000 },
  },

  // 10. Context Compaction & Trajectory Thought Pruning
  {
    id: 'context-compaction-pruning',
    presetId: 'preset-context-compaction',
    aliases: [
      'context-compaction',
      'preset-context-compaction',
      'context-compaction-pruning',
      'preset-context-compaction-pruning',
      'context_compaction',
    ],
    name: 'Context Compaction & Trajectory Thought Pruning',
    title: 'Checkpoint-Safe Context Compaction & Trajectory Thought Pruning',
    category: 'Memory & Context Engineering',
    severity: 'P3',
    rfc: 'RFC-0015 / RFC-0020 / ADK 2.0',
    description:
      'Prune intermediate chain-of-thought traces, summarize conversation milestones into a CompactedEvent, and verify checkpoint manifests.',
    steps: [
      {
        id: 'prune_scratchpad',
        title: 'Prune Ephemeral Chain-of-Thought Traces',
        tool: 'prune_thought_trajectories',
        server: 'acr-context-mcp',
        risk: 'low',
        parameters: { eventRetentionSize: 2 },
        dependencies: [],
      },
      {
        id: 'compact_event',
        title: 'Generate Checkpoint-Safe CompactedEvent',
        tool: 'generate_compacted_event',
        server: 'acr-context-mcp',
        risk: 'low',
        parameters: { summarizeMilestones: true },
        dependencies: ['prune_scratchpad'],
      },
    ],
    configSchema: [
      {
        key: 'retainedTurnCount',
        label: 'Retained Raw Recent Turns',
        type: 'number',
        defaultValue: 2,
        min: 1,
        max: 20,
        description: 'Number of active recent events to preserve verbatim after compaction.',
      },
    ],
    defaultConfig: { retainedTurnCount: 2 },
  },

  // 11. Byzantine Fault Detection & Rogue Slashing
  {
    id: 'byzantine-fault-slashing',
    presetId: 'preset-byzantine-slashing',
    aliases: [
      'byzantine-slashing',
      'preset-byzantine-slashing',
      'byzantine-fault-slashing',
      'preset-byzantine-fault-slashing',
      'byzantine_slashing',
    ],
    name: 'Byzantine Fault Detection & Rogue Agent Slashing',
    title: 'Rogue Agent Equivocation Detection & Wilson Reputation Slashing',
    category: 'Security & Reputation',
    severity: 'P1',
    rfc: 'RFC-0014 / RFC-0021',
    description:
      'Detect cryptographic signature equivocation, revoke agent mesh delegation, and slash Wilson confidence score.',
    steps: [
      {
        id: 'detect_equivocation',
        title: 'Detect Cryptographic Ballot Equivocation',
        tool: 'detect_equivocation_anomaly',
        server: 'acr-secops-mcp',
        risk: 'medium',
        parameters: { proposalId: 'prop-infra-remediation' },
        dependencies: [],
      },
      {
        id: 'slash_score',
        title: 'Slash Wilson Reputation Score and Revoke DID',
        tool: 'slash_reputation_score',
        server: 'acr-reputation-mcp',
        risk: 'high',
        parameters: { targetDid: 'did:key:z6Mkq4v9XzaPn728BwXk19N...claude', slashFactor: 0.5 },
        dependencies: ['detect_equivocation'],
        requiresDualConsent: true,
      },
    ],
    configSchema: [
      {
        key: 'slashPenaltyRatio',
        label: 'Reputation Slash Penalty (0-1.0)',
        type: 'number',
        defaultValue: 0.5,
        min: 0.05,
        max: 1.0,
        description: 'Proportion of Wilson confidence interval to deduct upon proven Byzantine infraction.',
      },
    ],
    defaultConfig: { slashPenaltyRatio: 0.5 },
  },

  // 12. Continuous DID Key Rotation Chain
  {
    id: 'identity-key-rotation',
    presetId: 'preset-identity-rotation',
    aliases: [
      'identity-rotation',
      'preset-identity-rotation',
      'identity-key-rotation',
      'preset-identity-key-rotation',
      'identity_rotation',
    ],
    name: 'Continuous DID Key Rotation Chain',
    title: 'Continuous Ed25519 DID Key Rotation Chain & Verification',
    category: 'Identity & Key Management',
    severity: 'P2',
    rfc: 'RFC-0013 / W3C DID Core',
    description:
      'Generate dual-signed rotation envelope linking old and new Ed25519 keys, verify continuous provenance, and update DID document.',
    steps: [
      {
        id: 'gen_envelope',
        title: 'Generate Dual-Signed Key Rotation Envelope',
        tool: 'generate_rotation_envelope',
        server: 'acr-identity-mcp',
        risk: 'medium',
        parameters: { curve: 'Ed25519' },
        dependencies: [],
      },
      {
        id: 'anchor_chain',
        title: 'Anchor Rotation Envelope to Cryptographic Provenance Chain',
        tool: 'anchor_did_chain',
        server: 'acr-identity-mcp',
        risk: 'low',
        parameters: { verifyPriorSignature: true },
        dependencies: ['gen_envelope'],
      },
    ],
    configSchema: [
      {
        key: 'cryptographicCurve',
        label: 'Cryptographic Signature Scheme',
        type: 'select',
        defaultValue: 'Ed25519',
        options: ['Ed25519', 'Secp256k1', 'P-256'],
        description: 'Elliptic curve algorithm for new key generation.',
      },
    ],
    defaultConfig: { cryptographicCurve: 'Ed25519' },
  },

  // 13. Onyxbox Micro-Sandbox Isolation
  {
    id: 'micro-sandbox-isolation',
    presetId: 'preset-micro-sandbox',
    aliases: [
      'micro-sandbox',
      'preset-micro-sandbox',
      'micro-sandbox-isolation',
      'preset-micro-sandbox-isolation',
      'micro_sandbox',
    ],
    name: 'Onyxbox Micro-Sandbox Provisioning & Auto-Purge',
    title: 'Onyxbox ToolHive Ephemeral Micro-Sandbox Provisioning & Auto-Purge',
    category: 'Process Isolation & Runtime',
    severity: 'P2',
    rfc: 'RFC-0018 / Onyxbox / ToolHive',
    description:
      'Spawn ephemeral micro-container with network lockdown, execute untrusted tool payload, and verify automated 15-minute purge sweep.',
    steps: [
      {
        id: 'spawn_sandbox',
        title: 'Spawn Ephemeral Onyxbox Micro-Sandbox',
        tool: 'provision_micro_sandbox',
        server: 'acr-sandbox-mcp',
        risk: 'medium',
        parameters: { isolateNetwork: true, readOnlyRoot: true },
        dependencies: [],
      },
      {
        id: 'purge_timer',
        title: 'Arm 15-Minute Auto-Purge Garbage Sweep',
        tool: 'schedule_auto_purge_timer',
        server: 'acr-sandbox-mcp',
        risk: 'low',
        parameters: { autoPurgeDelayMinutes: 15 },
        dependencies: ['spawn_sandbox'],
      },
    ],
    configSchema: [
      {
        key: 'autoPurgeMinutes',
        label: 'Auto-Purge Delay (minutes)',
        type: 'number',
        defaultValue: 15,
        min: 1,
        max: 60,
        description: 'Hard TTL before micro-sandbox container is forcefully destroyed.',
      },
    ],
    defaultConfig: { autoPurgeMinutes: 15 },
  },

  // 14. Cross-Model Agentflex Plan Synthesis
  {
    id: 'cross-model-agentflex-synthesis',
    presetId: 'preset-agentflex-synthesis',
    aliases: [
      'agentflex-synthesis',
      'preset-agentflex-synthesis',
      'cross-model-agentflex-synthesis',
      'preset-cross-model-agentflex-synthesis',
      'agentflex_synthesis',
    ],
    name: 'Cross-Model Agentflex Plan Synthesis & Critique',
    title: 'Cross-Model Agentflex Plan Synthesis & Pairwise Adversarial Critique',
    category: 'Cognitive Architecture',
    severity: 'P2',
    rfc: 'RFC-0002 / Agentflex',
    description:
      'Gather parallel plan proposals from 3 frontier model families, execute pairwise critique matrices, and synthesize unified consensus plan.',
    steps: [
      {
        id: 'dispatch_parallel',
        title: 'Dispatch Parallel Proposal Generation to Frontier LLMs',
        tool: 'dispatch_parallel_prompts',
        server: 'acr-agentflex-mcp',
        risk: 'low',
        parameters: { models: ['claude-3-7-sonnet', 'gpt-4o', 'gemini-2.0-flash'] },
        dependencies: [],
      },
      {
        id: 'pairwise_critique',
        title: 'Run Adversarial Pairwise Critique Matrix',
        tool: 'execute_pairwise_critique',
        server: 'acr-agentflex-mcp',
        risk: 'low',
        parameters: { rounds: 2 },
        dependencies: ['dispatch_parallel'],
      },
    ],
    configSchema: [
      {
        key: 'critiqueRounds',
        label: 'Pairwise Critique Rounds',
        type: 'number',
        defaultValue: 2,
        min: 1,
        max: 5,
        description: 'Iterations of dialectical peer critique before synthesizing final plan.',
      },
    ],
    defaultConfig: { critiqueRounds: 2 },
  },

  // 15. Declarative Step Playbook & Gate Parking
  {
    id: 'declarative-step-playbook',
    presetId: 'preset-declarative-playbook',
    aliases: [
      'declarative-playbook',
      'preset-declarative-playbook',
      'declarative-step-playbook',
      'preset-declarative-step-playbook',
      'declarative_playbook',
    ],
    name: 'Declarative Step Playbook & Gate Parking',
    title: 'RFC-0016 Content-Addressed Step Playbook Execution & Gate Parking',
    category: 'Workflow Automation',
    severity: 'P2',
    rfc: 'RFC-0016 / PlaybookRun',
    description:
      'Compile playbook steps into content-addressed hash, step through automated agent tasks, and park execution safely at approval gates.',
    steps: [
      {
        id: 'verify_hash',
        title: 'Verify Content-Addressed Playbook Hash',
        tool: 'verify_playbook_hash',
        server: 'acr-playbook-mcp',
        risk: 'low',
        parameters: { expectedAlgorithm: 'BLAKE3' },
        dependencies: [],
      },
      {
        id: 'advance_step',
        title: 'Advance Step Execution with Gate Parking Guard',
        tool: 'advance_playbook_cursor',
        server: 'acr-playbook-mcp',
        risk: 'medium',
        parameters: { parkOnHumanGate: true },
        dependencies: ['verify_hash'],
      },
    ],
    configSchema: [
      {
        key: 'stopOnFirstError',
        label: 'Stop Execution On Step Failure',
        type: 'boolean',
        defaultValue: true,
        description: 'Halt the entire playbook sequence immediately if any step returns non-zero error.',
      },
    ],
    defaultConfig: { stopOnFirstError: true },
  },

  // 16. Postguard Prompt Injection & Jailbreak Firewall
  {
    id: 'postguard-injection-defense',
    presetId: 'preset-postguard-firewall',
    aliases: [
      'postguard-firewall',
      'preset-postguard-firewall',
      'postguard-injection-defense',
      'preset-postguard-injection-defense',
      'postguard_defense',
      'postguard_firewall',
    ],
    name: 'Postguard Prompt Injection & Jailbreak Firewall',
    title: 'Postguard Pre-Model Prompt Injection & Jailbreak Firewall',
    category: 'Prompt & Content Security',
    severity: 'P0',
    rfc: 'RFC-0019 / Postguard / SAIF',
    description:
      'Inspect incoming prompt strings, detect prompt-injection token anomalies, block pre-model inference dispatch, and record audit evidence.',
    steps: [
      {
        id: 'screen_stream',
        title: 'Screen Prompt String for Jailbreak & Injection Vectors',
        tool: 'screen_inbound_payload',
        server: 'acr-postguard-mcp',
        risk: 'high',
        parameters: { sensitivityLevel: 'strict' },
        dependencies: [],
        requiresDualConsent: true,
      },
      {
        id: 'quarantine_audit',
        title: 'Record Tamper-Proof Audit Proof of Firewall Drop',
        tool: 'record_firewall_rejection',
        server: 'acr-postguard-mcp',
        risk: 'medium',
        parameters: { logToAuditLedger: true },
        dependencies: ['screen_stream'],
      },
    ],
    configSchema: [
      {
        key: 'sensitivityLevel',
        label: 'Firewall Sensitivity Level',
        type: 'select',
        defaultValue: 'strict',
        options: ['permissive', 'balanced', 'strict', 'paranoid'],
        description: 'Anomaly score threshold for dropping suspect prompt turns.',
      },
    ],
    defaultConfig: { sensitivityLevel: 'strict' },
  },

  // 17. Dynamic DAG Scheduling & JoinNode Barrier
  {
    id: 'dynamic-dag-topology',
    presetId: 'preset-dynamic-dag-topology',
    aliases: [
      'dynamic-dag-topology',
      'preset-dynamic-dag-topology',
      'dynamic_dag_topology',
      'dynamic-dag',
    ],
    name: 'Dynamic DAG Scheduling & JoinNode Barrier',
    title: 'Dynamic DAG Branch Scheduling, Parallel Fanout & JoinNode Barrier',
    category: 'Graph Scheduling',
    severity: 'P2',
    rfc: 'RFC-0016 / ADK 2.0 / JCS RFC 8785',
    description:
      'Validate acyclic topology via 3-color DFS, schedule parallel worker branches, synchronize at JoinNode barrier, and verify deterministic topology hash.',
    steps: [
      {
        id: 'validate_dag',
        title: 'Validate DAG Topology via 3-Color DFS',
        tool: 'validate_graph_topology',
        server: 'acr-dag-mcp',
        risk: 'low',
        parameters: { allowConditionalReviewLoops: true },
        dependencies: [],
      },
      {
        id: 'fanout_workers',
        title: 'Fan-Out Parallel Worker Branch Pool',
        tool: 'fanout_parallel_workers',
        server: 'acr-dag-mcp',
        risk: 'low',
        parameters: { maxParallelWorkers: 4 },
        dependencies: ['validate_dag'],
      },
      {
        id: 'join_barrier',
        title: 'Synchronize at JoinNode Barrier',
        tool: 'synchronize_join_barrier',
        server: 'acr-dag-mcp',
        risk: 'low',
        parameters: { timeoutMs: 15000 },
        dependencies: ['fanout_workers'],
      },
    ],
    configSchema: [
      {
        key: 'maxParallelWorkers',
        label: 'Max Parallel Workers',
        type: 'number',
        defaultValue: 4,
        min: 1,
        max: 16,
        description: 'Maximum parallel branch concurrency limit.',
      },
    ],
    defaultConfig: { maxParallelWorkers: 4 },
  },

  // 18. Transitive Web of Trust Federation & BFS Path Verification (RFC-0017)
  {
    id: 'transitive-trust-federation',
    presetId: 'preset-trust-federation',
    aliases: [
      'trust-federation',
      'transitive-trust-federation',
      'preset-trust-federation',
      'web-of-trust',
      'transitive_trust_federation',
      'trust_federation',
    ],
    name: 'Transitive Web of Trust & Peer BFS Federation',
    title: 'Transitive Web of Trust Endorsement & BFS Path Verification',
    category: 'Identity & Trust Federation',
    severity: 'P1',
    rfc: 'RFC-0017 / Web of Trust',
    description:
      'Evaluate decentralized peer-to-peer transitive trust via Ed25519-signed endorsements, depth-bounded BFS traversal (max depth 3), and signature chain attestation.',
    steps: [
      {
        id: 'verify_endorsements',
        title: 'Verify Ed25519 Endorsement Signatures',
        tool: 'verify_trust_endorsements',
        server: 'acr-identity-mcp',
        risk: 'low',
        parameters: { maxDepth: 3, requireDoubleSigning: true },
        dependencies: [],
      },
      {
        id: 'traverse_bfs',
        title: 'Traverse Transitive Trust Graph BFS',
        tool: 'evaluate_transitive_trust_bfs',
        server: 'acr-trust-mcp',
        risk: 'low',
        parameters: { maxDepth: 3 },
        dependencies: ['verify_endorsements'],
      },
      {
        id: 'commit_peers',
        title: 'Commit Verified Peers to Mesh Routing',
        tool: 'commit_verified_trust_peers',
        server: 'acr-mesh-mcp',
        risk: 'medium',
        parameters: { isolationScope: true },
        dependencies: ['traverse_bfs'],
      },
    ],
    configSchema: [
      {
        key: 'maxBfsDepth',
        label: 'Max BFS Traversal Depth',
        type: 'number',
        defaultValue: 3,
        min: 1,
        max: 8,
        description: 'Maximum depth for transitive trust BFS path evaluation (RFC-0017 default 3, max 8).',
        required: true,
      },
      {
        key: 'requireDoubleSigning',
        label: 'Require Double Signing',
        type: 'boolean',
        defaultValue: true,
        description: 'Require both old and new keys to sign rotation links.',
      },
    ],
    defaultConfig: { maxBfsDepth: 3, requireDoubleSigning: true },
  },
];

/**
 * Find a canonical workflow by its canonical ID, preset ID, or any alias.
 */
export function findCanonicalWorkflow(id: unknown): CanonicalWorkflowDefinition | null {
  if (!id || typeof id !== 'string') return null;
  const raw = id.trim().toLowerCase();
  if (!raw) return null;
  const stripped = raw.replace(/^preset-/, '');
  const rawSnake = raw.replace(/-/g, '_');
  const strippedSnake = stripped.replace(/-/g, '_');

  return (
    CANONICAL_WORKFLOWS.find((w) => {
      const wId = w.id.toLowerCase();
      const wPreset = w.presetId.toLowerCase();
      const wAliases = w.aliases.map((a) => a.toLowerCase());

      return (
        wId === raw ||
        wId === stripped ||
        wPreset === raw ||
        wPreset === `preset-${stripped}` ||
        wAliases.includes(raw) ||
        wAliases.includes(stripped) ||
        wAliases.includes(rawSnake) ||
        wAliases.includes(strippedSnake) ||
        wId.replace(/-/g, '_') === rawSnake ||
        wId.replace(/-/g, '_') === strippedSnake
      );
    }) || null
  );
}

/**
 * Strictly validate a workflow configuration payload against its formal config schema.
 */
export function validateCanonicalWorkflowConfig(
  workflowId: unknown,
  config: unknown = {}
): { valid: boolean; errors: string[] } {
  const workflow = findCanonicalWorkflow(workflowId);
  if (!workflow) {
    return {
      valid: false,
      errors: [`Workflow "${String(workflowId)}" not found in canonical registry.`],
    };
  }
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return { valid: false, errors: ['Configuration must be a valid key-value object.'] };
  }

  const record = config as Record<string, unknown>;
  const errors: string[] = [];
  const schema = workflow.configSchema;
  const knownKeys = new Set(schema.map((field) => field.key));

  for (const key of Object.keys(record)) {
    if (!knownKeys.has(key)) {
      errors.push(`Unknown configuration field: "${key}"`);
    }
  }

  for (const field of schema) {
    const val = record[field.key];
    if (val === undefined || (field.required && (val === null || val === ''))) {
      if (field.required) {
        errors.push(`Missing required configuration field: "${field.key}" (${field.label})`);
      }
      continue;
    }

    switch (field.type) {
      case 'number': {
        if (typeof val !== 'number' || !Number.isFinite(val)) {
          errors.push(`Field "${field.key}" must be a valid number, got ${typeof val}`);
        } else if (field.min !== undefined && val < field.min) {
          errors.push(`Field "${field.key}" must be >= ${field.min}, got ${val}`);
        } else if (field.max !== undefined && val > field.max) {
          errors.push(`Field "${field.key}" must be <= ${field.max}, got ${val}`);
        }
        break;
      }
      case 'boolean': {
        if (typeof val !== 'boolean') {
          errors.push(`Field "${field.key}" must be a boolean (true/false), got ${typeof val}`);
        }
        break;
      }
      case 'string': {
        if (typeof val !== 'string' || val.length > 2000) {
          errors.push(`Field "${field.key}" must be a string, got ${typeof val}`);
        }
        break;
      }
      case 'select': {
        if (typeof val !== 'string' || (Array.isArray(field.options) && !field.options.includes(val))) {
          errors.push(
            `Field "${field.key}" must be one of [${(field.options ?? []).join(', ')}], got "${String(val)}"`
          );
        }
        break;
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Initialize a pristine workflow execution state for an OpsIncident.
 */
export function initializeCanonicalWorkflowState(
  workflowId: string,
  config: Record<string, unknown> = {}
): CanonicalWorkflowState | null {
  const workflow = findCanonicalWorkflow(workflowId);
  if (!workflow) return null;
  const mergedConfig = { ...workflow.defaultConfig, ...config };
  return {
    workflowId: workflow.id,
    canonicalId: workflow.id,
    status: 'idle',
    currentStepIndex: 0,
    totalSteps: workflow.steps.length,
    config: mergedConfig,
    startedAt: new Date().toISOString(),
    completedAt: null,
    steps: workflow.steps.map((s, idx) => ({
      stepId: s.id,
      index: idx,
      title: s.title,
      tool: s.tool,
      server: s.server,
      risk: s.risk,
      status: 'pending',
      startedAt: null,
      completedAt: null,
      outputs: null,
    })),
  };
}

export function buildWorkflowConfigSchema(
  workflow: CanonicalWorkflowDefinition
): WorkflowConfigJsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    properties: Object.fromEntries(
      workflow.configSchema.map((field) => [
        field.key,
        {
          type: field.type === 'select' ? 'string' : field.type,
          description: field.description,
          default: field.defaultValue,
          ...(field.type === 'select' && field.options ? { enum: field.options } : {}),
          ...(field.type === 'number' && field.min !== undefined ? { minimum: field.min } : {}),
          ...(field.type === 'number' && field.max !== undefined ? { maximum: field.max } : {}),
          ...(field.type === 'string' ? { maxLength: 2000 } : {}),
        },
      ])
    ),
  };
}

export function toWorkflowContractDefinition(
  workflow: CanonicalWorkflowDefinition,
  options: { executionSupported?: boolean } = {}
): WorkflowContractDefinition {
  return {
    id: workflow.id,
    preset_id: workflow.presetId,
    name: workflow.name,
    category: workflow.category,
    protocol_reference: workflow.rfc,
    intent: workflow.description,
    config_schema: buildWorkflowConfigSchema(workflow),
    default_config: { ...workflow.defaultConfig },
    execution_supported: options.executionSupported ?? false,
  };
}

export function exportWorkflowContract(
  registryRevision: string = 'local',
  options: { executionSupported?: boolean } = {}
): WorkflowContractExport {
  return {
    schemaVersion: '1.0',
    registryRevision,
    workflows: CANONICAL_WORKFLOWS.map((wf) => toWorkflowContractDefinition(wf, options)),
  };
}
