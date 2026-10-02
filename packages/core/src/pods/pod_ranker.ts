/**
 * Pareto Pod Ranker across {domain x host x tier}
 *
 * Evaluates candidate pods against multi-objective Pareto frontiers:
 * - Accuracy (maximize)
 * - Cost ($/task, minimize)
 * - Latency (ms, minimize)
 *
 * Invariant: Zero emoji.
 */

import { PodDomain, ModelTier } from './pod_controller.js';

export interface PodRankCandidate {
  id: string;
  domain: PodDomain;
  host: string;
  tier: ModelTier;
  accuracy: number;  // [0.0, 1.0], higher is better
  costUsd: number;   // USD / task, lower is better
  latencyMs: number; // Execution latency in ms, lower is better
  sampleSize?: number;
}

export interface RankedPod extends PodRankCandidate {
  paretoRank: number; // 1 = Pareto frontier (non-dominated), 2 = next tier...
  isDominated: boolean;
}

const EPSILON = 1e-9;

/**
 * Returns true if candidate `a` Pareto-dominates candidate `b`.
 * Candidate `a` must be at least as good in all 3 objectives and strictly better in at least one.
 */
export function podDominates(a: PodRankCandidate, b: PodRankCandidate): boolean {
  const notWorse =
    a.accuracy >= b.accuracy - EPSILON &&
    a.costUsd <= b.costUsd + EPSILON &&
    a.latencyMs <= b.latencyMs + EPSILON;

  const strictlyBetter =
    a.accuracy > b.accuracy + EPSILON ||
    a.costUsd < b.costUsd - EPSILON ||
    a.latencyMs < b.latencyMs - EPSILON;

  return notWorse && strictlyBetter;
}

/**
 * Computes non-dominated Pareto tiers for an array of pod candidates.
 * Returns RankedPod items with paretoRank (1 is optimal non-dominated frontier).
 */
export function rankPods(candidates: PodRankCandidate[]): RankedPod[] {
  if (candidates.length === 0) return [];

  const n = candidates.length;
  const ranks = new Array<number>(n).fill(0);
  let remaining: number[] = candidates.map((_, i) => i);
  let currentRank = 1;

  while (remaining.length > 0) {
    const front = remaining.filter((i) => {
      return !remaining.some((j) => j !== i && podDominates(candidates[j], candidates[i]));
    });

    const activeFront = front.length === 0 ? remaining.slice() : front;
    for (const idx of activeFront) {
      ranks[idx] = currentRank;
    }

    const frontSet = new Set(activeFront);
    remaining = remaining.filter((i) => !frontSet.has(i));
    currentRank++;
  }

  return candidates.map((cand, idx) => ({
    ...cand,
    paretoRank: ranks[idx],
    isDominated: ranks[idx] > 1,
  })).sort((a, b) => {
    if (a.paretoRank !== b.paretoRank) return a.paretoRank - b.paretoRank;
    if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
    return a.costUsd - b.costUsd;
  });
}

/**
 * Filters candidates to return only the optimal Pareto frontier (rank 1).
 */
export function extractParetoFrontier(candidates: PodRankCandidate[]): RankedPod[] {
  return rankPods(candidates).filter((p) => p.paretoRank === 1);
}

/**
 * Groups and ranks pods per domain, returning the frontier for each domain.
 */
export function rankPodsByDomain(
  candidates: PodRankCandidate[]
): Map<PodDomain, { frontier: RankedPod[]; all: RankedPod[] }> {
  const groups = new Map<PodDomain, PodRankCandidate[]>();

  for (const c of candidates) {
    const list = groups.get(c.domain) ?? [];
    list.push(c);
    groups.set(c.domain, list);
  }

  const result = new Map<PodDomain, { frontier: RankedPod[]; all: RankedPod[] }>();
  for (const [domain, list] of groups.entries()) {
    const ranked = rankPods(list);
    result.set(domain, {
      frontier: ranked.filter((p) => p.paretoRank === 1),
      all: ranked,
    });
  }

  return result;
}
