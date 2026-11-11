/**
 * Cryptographic Human Approval Gates Engine
 *
 * Implements fail-closed veto enforcement, content-addressed action proposals,
 * and signed human decisions (RFC-0012).
 */

import crypto from 'node:crypto';
import { sha256Sync } from '../crypto-compat.js';

export type Verdict = 'approve' | 'reject';

export interface ActionProposal {
  action_id: string;
  kind: string;
  summary: string;
  proposer: string;
  board: string;
  created_at: string;
}

export interface SignedDecision {
  action_id: string;
  verdict: Verdict;
  reason: string;
  decider: string;
  decided_at: string;
  signature?: string;
}

export type ApprovalStatus = 'pending' | 'authorized' | 'rejected';

/**
 * Extension 5 & Experiment 6: Passkey Consent Envelope binding verified human operator
 * to exact request hash, action type, target resource URI, resource version, policy revision,
 * expiration, and usage limit.
 */
export interface PasskeyConsentEnvelope {
  consent_id: string;
  operator_did: string;
  authenticator_id: string;
  challenge_nonce: string;
  request_canonical_hash: string;
  action_type: string;
  target_resource_uri: string;
  resource_version: string;
  policy_revision: string;
  issued_at: number;
  expires_at: number;
  max_invocations: number;
  signature: string;
}

export interface ExpectedConsentContext {
  request_canonical_hash: string;
  action_type: string;
  target_resource_uri: string;
  resource_version: string;
  policy_revision: string;
}

export function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJsonStringify(item)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const entries = sortedKeys.map(
    (k) => `${JSON.stringify(k)}:${canonicalJsonStringify(obj[k])}`
  );
  return `{${entries.join(',')}}`;
}

export function computeRequestCanonicalHash(params: {
  action_type: string;
  target_resource_uri: string;
  resource_version: string;
  policy_revision: string;
  parameters?: Record<string, unknown>;
}): string {
  const canonicalParams = params.parameters ? canonicalJsonStringify(params.parameters) : '{}';
  const parts = [
    params.action_type,
    params.target_resource_uri,
    params.resource_version,
    params.policy_revision,
    canonicalParams,
  ];
  let out = 'acr.consent.request.v1\n';
  for (const p of parts) {
    out += `${Buffer.byteLength(p, 'utf8')}:${p}\n`;
  }
  return sha256Sync(out);
}

export function composeConsentSigningPayload(env: Omit<PasskeyConsentEnvelope, 'signature'>): Buffer {
  const parts = [
    env.consent_id,
    env.operator_did,
    env.authenticator_id,
    env.challenge_nonce,
    env.request_canonical_hash,
    env.action_type,
    env.target_resource_uri,
    env.resource_version,
    env.policy_revision,
    String(env.issued_at),
    String(env.expires_at),
    String(env.max_invocations),
  ];
  let out = 'acr.passkey.consent.v1\n';
  for (const p of parts) {
    out += `${Buffer.byteLength(p, 'utf8')}:${p}\n`;
  }
  return Buffer.from(out, 'utf-8');
}


export class ConsentChallengeStore {
  private readonly challenges = new Map<string, { operatorDid: string; expiresAt: number }>();

  public issueChallenge(operatorDid: string, ttlMs = 60_000, nowMs = Date.now()): string {
    const nonce = crypto.randomBytes(16).toString('hex');
    this.challenges.set(nonce, {
      operatorDid: operatorDid.toLowerCase().trim(),
      expiresAt: nowMs + ttlMs,
    });
    return nonce;
  }

  /**
   * Atomically consumes and deletes the challenge BEFORE cryptographic signature verification
   * so that failed or replayed assertions immediately burn the challenge.
   */
  public takeChallenge(nonce: string, operatorDid: string, nowMs = Date.now()): boolean {
    const rec = this.challenges.get(nonce);
    // Unconditionally delete on first lookup attempt
    this.challenges.delete(nonce);
    if (!rec) {
      return false;
    }
    if (nowMs > rec.expiresAt) {
      return false;
    }
    return rec.operatorDid === operatorDid.toLowerCase().trim();
  }
}

export function signPasskeyConsentEnvelope(
  unsignedEnvelope: Omit<PasskeyConsentEnvelope, 'signature'>,
  privateKey: crypto.KeyObject
): PasskeyConsentEnvelope {
  const payload = composeConsentSigningPayload(unsignedEnvelope);
  const sig = crypto.sign(null, payload, privateKey).toString('hex');
  return {
    ...unsignedEnvelope,
    signature: sig,
  };
}

/**
 * Computes deterministic signing bytes for an ActionProposal.
 */
export function composeProposalBytes(
  kind: string,
  summary: string,
  proposer: string,
  board: string,
  createdAt: string
): string {
  const parts = [kind, summary, proposer, board, createdAt];
  let out = 'agentbbs.approval.v1\n';
  for (const p of parts) {
    out += `${Buffer.byteLength(p, 'utf8')}:${p}\n`;
  }
  return out;
}

/**
 * Computes deterministic action_id hash.
 */
export function computeActionId(
  kind: string,
  summary: string,
  proposer: string,
  board: string,
  createdAt: string
): string {
  const bytes = composeProposalBytes(kind, summary, proposer, board, createdAt);
  return sha256Sync(bytes);
}

export interface ConsentSessionGrant {
  consent_id: string;
  action_id: string;
  operator_did: string;
  expected: ExpectedConsentContext;
  expires_at: number;
  max_invocations: number;
  remaining_invocations: number;
  executions_consumed: number;
}

export class ApprovalGate {
  private readonly allowedDeciders: Set<string>;
  private readonly decisions: Map<string, SignedDecision[]> = new Map();
  private readonly consentInvocations = new Map<string, number>();
  private readonly grants = new Map<string, ConsentSessionGrant>();

  constructor(allowedDeciders: string[] = []) {
    this.allowedDeciders = new Set(allowedDeciders.map((d) => d.toLowerCase().trim()));
  }

  public allowDecider(decider: string): void {
    this.allowedDeciders.add(decider.toLowerCase().trim());
  }

  public isAllowedDecider(decider: string): boolean {
    return this.allowedDeciders.has(decider.toLowerCase().trim());
  }

  /**
   * Records a signed decision on an action.
   */
  public submitDecision(decision: SignedDecision): void {
    const aid = decision.action_id.toLowerCase().trim();
    if (!this.decisions.has(aid)) {
      this.decisions.set(aid, []);
    }
    this.decisions.get(aid)!.push(decision);
  }

  /**
   * Extension 5 & Experiment 6: Verifies a PasskeyConsentEnvelope against the exact
   * request hash, action type, target resource URI, resource version, policy revision,
   * expiration, and max_invocations before recording the approval decision.
   */
  public submitDecisionWithConsent(params: {
    decision: SignedDecision;
    envelope: PasskeyConsentEnvelope;
    expected: ExpectedConsentContext;
    publicKey: crypto.KeyObject;
    challengeStore: ConsentChallengeStore;
    nowMs?: number;
  }): void {
    const nowMs = params.nowMs ?? Date.now();
    const { decision, envelope, expected, publicKey, challengeStore } = params;

    const decider = decision.decider.toLowerCase().trim();
    if (!this.allowedDeciders.has(decider)) {
      throw new Error(`CONSENT_REJECTED: unauthorized operator ${decision.decider}`);
    }
    if (envelope.operator_did.toLowerCase().trim() !== decider) {
      throw new Error('CONSENT_REJECTED: operator_did mismatch');
    }

    // Step 1: Atomic pre-verification challenge consumption (single-use challenge)
    const usedCount = this.consentInvocations.get(envelope.consent_id) ?? 0;
    if (usedCount === 0) {
      const challengeOk = challengeStore.takeChallenge(
        envelope.challenge_nonce,
        envelope.operator_did,
        nowMs
      );
      if (!challengeOk) {
        throw new Error(
          'CONSENT_REJECTED: CHALLENGE_ALREADY_BURNED (challenge_nonce invalid, expired, or already consumed)'
        );
      }
    }

    // Step 2: Expiration & max_invocations check
    if (nowMs > envelope.expires_at) {
      throw new Error('CONSENT_REJECTED: CONSENT_EXPIRED (consent envelope expired)');
    }
    if (envelope.max_invocations <= 0 || usedCount >= envelope.max_invocations) {
      throw new Error('CONSENT_REJECTED: USAGE_LIMIT_EXHAUSTED (max_invocations exceeded)');
    }

    // Step 3: Cryptographic signature verification over canonical consent payload
    const signingBytes = composeConsentSigningPayload(envelope);
    const sigBuf = Buffer.from(envelope.signature, 'hex');
    const sigValid = crypto.verify(null, signingBytes, publicKey, sigBuf);
    if (!sigValid) {
      throw new Error('CONSENT_REJECTED: invalid cryptographic signature');
    }

    // Step 4: Strict binding to exact request, action, resource URI, resource version, and policy revision
    if (envelope.action_type !== expected.action_type) {
      throw new Error(
        `CONSENT_SCOPE_MISMATCH: action_type ${envelope.action_type} !== ${expected.action_type}`
      );
    }
    if (envelope.target_resource_uri !== expected.target_resource_uri) {
      throw new Error(
        `CONSENT_SCOPE_MISMATCH: target_resource_uri ${envelope.target_resource_uri} !== ${expected.target_resource_uri}`
      );
    }
    if (envelope.resource_version !== expected.resource_version) {
      throw new Error(
        `CONSENT_SCOPE_MISMATCH: resource_version ${envelope.resource_version} !== ${expected.resource_version}`
      );
    }
    if (envelope.policy_revision !== expected.policy_revision) {
      throw new Error(
        `CONSENT_SCOPE_MISMATCH: policy_revision ${envelope.policy_revision} !== ${expected.policy_revision}`
      );
    }
    if (envelope.request_canonical_hash !== expected.request_canonical_hash) {
      throw new Error('CONSENT_SCOPE_MISMATCH: request_canonical_hash mismatch');
    }

    this.consentInvocations.set(envelope.consent_id, usedCount + 1);
    if (!this.grants.has(envelope.consent_id)) {
      this.grants.set(envelope.consent_id, {
        consent_id: envelope.consent_id,
        action_id: decision.action_id,
        operator_did: envelope.operator_did,
        expected: { ...expected },
        expires_at: envelope.expires_at,
        max_invocations: envelope.max_invocations,
        remaining_invocations: envelope.max_invocations,
        executions_consumed: 0,
      });
    }
    this.submitDecision(decision);
  }

  /**
   * Consumes one execution invocation from an established ConsentSessionGrant.
   * Enforces fail-closed authorization, TTL expiration, and CAS quota limits.
   */
  public consumeGrantForExecution(consentId: string, nowMs = Date.now()): ConsentSessionGrant {
    const grant = this.grants.get(consentId);
    if (!grant) {
      throw new Error(`CONSENT_REJECTED: CONSENT_GRANT_NOT_FOUND (${consentId})`);
    }
    if (nowMs > grant.expires_at) {
      throw new Error('CONSENT_REJECTED: CONSENT_EXPIRED (consent session grant expired)');
    }
    if (!this.isAuthorized(grant.action_id)) {
      throw new Error(`CONSENT_REJECTED: action ${grant.action_id} is not authorized`);
    }
    if (grant.remaining_invocations <= 0 || grant.executions_consumed >= grant.max_invocations) {
      throw new Error('CONSENT_REJECTED: USAGE_LIMIT_EXHAUSTED (max_invocations exceeded)');
    }
    grant.executions_consumed += 1;
    grant.remaining_invocations -= 1;
    this.consentInvocations.set(
      consentId,
      Math.max(this.consentInvocations.get(consentId) ?? 0, grant.executions_consumed)
    );
    return { ...grant };
  }

  /**
   * Evaluates the authorization status of an action proposal.
   *
   * Invariants (Fail-Closed Semantics):
   * 1. If any allowed decider submitted a 'reject' verdict, action is REJECTED (immediate veto).
   * 2. If at least one allowed decider submitted an 'approve' verdict and zero rejected, action is AUTHORIZED.
   * 3. Otherwise, action is PENDING.
   */
  public evaluate(actionId: string): ApprovalStatus {
    const aid = actionId.toLowerCase().trim();
    const list = this.decisions.get(aid) ?? [];

    let hasApproval = false;

    for (const d of list) {
      const decider = d.decider.toLowerCase().trim();
      if (!this.allowedDeciders.has(decider)) {
        continue; // Ignore un-whitelisted entities
      }

      if (d.verdict === 'reject') {
        return 'rejected'; // Immediate veto prevails
      }

      if (d.verdict === 'approve') {
        hasApproval = true;
      }
    }

    return hasApproval ? 'authorized' : 'pending';
  }

  /**
   * Helper check returning true if authorized to execute.
   */
  public isAuthorized(actionId: string): boolean {
    return this.evaluate(actionId) === 'authorized';
  }

  /**
   * Returns all decisions submitted for an action.
   */
  public getDecisions(actionId: string): SignedDecision[] {
    const aid = actionId.toLowerCase().trim();
    return this.decisions.get(aid) ?? [];
  }
}

