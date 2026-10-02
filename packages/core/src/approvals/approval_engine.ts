/**
 * Cryptographic Human Approval Gates Engine
 *
 * Implements fail-closed veto enforcement, content-addressed action proposals,
 * and signed human decisions (RFC-0012).
 */

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

export class ApprovalGate {
  private readonly allowedDeciders: Set<string>;
  private readonly decisions: Map<string, SignedDecision[]> = new Map();

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
