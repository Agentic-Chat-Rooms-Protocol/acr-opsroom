/**
 * Pareto-Frontier Dominance Optimizer (NSGA-II Non-Dominated Sorting)
 *
 * Implements multi-objective optimization over accuracy (requirement_coverage, maximize)
 * and cost ($/task, minimize) to identify the Pareto frontier and prune dominated configurations.
 */

export interface ParetoPoint {
  coverage: number; // [0.0, 1.0], higher is better
  cost: number;     // USD / task, lower is better
}

const EPS = 1e-9;

/**
 * Returns true if point `a` dominates point `b`:
 * At least as accurate and at least as cheap, and strictly better on at least one axis.
 */
export function dominates(a: ParetoPoint, b: ParetoPoint): boolean {
  const notWorse = a.coverage >= b.coverage - EPS && a.cost <= b.cost + EPS;
  const strictlyBetter = a.coverage > b.coverage + EPS || a.cost < b.cost - EPS;
  return notWorse && strictlyBetter;
}

/**
 * Computes non-dominated sorting tiers per input index (1 = frontier, 2 = next tier...).
 * Deterministic and order-independent.
 */
export function nondominatedTiers(points: ParetoPoint[]): number[] {
  const n = points.length;
  if (n === 0) return [];

  const tiers = new Array<number>(n).fill(0);
  let remaining: number[] = points.map((_, i) => i);
  let currentTier = 1;

  while (remaining.length > 0) {
    const front: number[] = remaining.filter((i) => {
      return !remaining.some((j) => j !== i && dominates(points[j], points[i]));
    });

    const activeFront = front.length === 0 ? remaining.slice() : front;
    for (const idx of activeFront) {
      tiers[idx] = currentTier;
    }

    const frontSet = new Set(activeFront);
    remaining = remaining.filter((i) => !frontSet.has(i));
    currentTier++;
  }

  return tiers;
}

export interface StackScore extends ParetoPoint {
  id: string;
  name?: string;
  [key: string]: any;
}

export interface RankedStack<T extends ParetoPoint> {
  item: T;
  tier: number;
  isFrontier: boolean;
}

/**
 * Ranks an array of items across accuracy and cost, annotating each with its Pareto tier.
 */
export function rankStacks<T extends ParetoPoint>(items: T[]): Array<RankedStack<T>> {
  const tiers = nondominatedTiers(items);
  return items.map((item, idx) => ({
    item,
    tier: tiers[idx],
    isFrontier: tiers[idx] === 1,
  }));
}
