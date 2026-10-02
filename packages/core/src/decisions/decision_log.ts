/**
 * Immutable Decision Record Ledger
 *
 * Implements content-addressed (BLAKE3/SHA-256) immutable decision records
 * capturing the durable rationale behind autopilot actions and approvals (ADR-0045).
 */

import { sha256Sync } from '../crypto-compat.js';

export interface DecisionRecord {
  id: string; // Content-addressed identifier
  title: string;
  decision: string;
  rationale: string;
  board: string;
  decided_by: string;
  decided_at: string;
  signature?: string;
}

export function composeDecisionContent(
  title: string,
  decision: string,
  rationale: string,
  board: string,
  decidedBy: string,
  decidedAt: string
): string {
  const parts = [title, decision, rationale, board, decidedBy, decidedAt];
  let out = 'agentbbs.decision.v1\n';
  for (const p of parts) {
    out += `${Buffer.byteLength(p, 'utf8')}:${p}\n`;
  }
  return out;
}

export function computeDecisionId(
  title: string,
  decision: string,
  rationale: string,
  board: string,
  decidedBy: string,
  decidedAt: string
): string {
  const bytes = composeDecisionContent(title, decision, rationale, board, decidedBy, decidedAt);
  return sha256Sync(bytes);
}

export class DecisionLog {
  private readonly records: Map<string, DecisionRecord> = new Map();

  /**
   * Appends a verified DecisionRecord to the log.
   */
  public append(record: DecisionRecord): boolean {
    const computed = computeDecisionId(
      record.title,
      record.decision,
      record.rationale,
      record.board,
      record.decided_by,
      record.decided_at
    );

    if (computed.toLowerCase() !== record.id.toLowerCase()) {
      return false; // Reject mismatched content hash
    }

    if (!this.records.has(record.id)) {
      this.records.set(record.id, record);
      return true;
    }

    return false; // Already present
  }

  public get(id: string): DecisionRecord | undefined {
    return this.records.get(id);
  }

  public list(): DecisionRecord[] {
    return Array.from(this.records.values());
  }

  public count(): number {
    return this.records.size;
  }
}
