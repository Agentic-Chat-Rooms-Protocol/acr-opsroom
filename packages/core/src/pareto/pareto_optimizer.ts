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

/**
 * Experiment 9 (Optimization Workflow Policy Guardrail):
 * Ensures any candidate strategy that violates security or operational policy is
 * rejected regardless of its optimization score, and never enters the Pareto frontier.
 */
export interface OptimizationCandidateConfig extends ParetoPoint {
  id: string;
  name?: string;
  max_concurrency?: number;
  require_auth_verification?: boolean;
  max_spend_per_run_usd?: number;
  workspace_path?: string;
  modifies_production_permissions?: boolean;
}

export interface OptimizationPolicyBounds {
  maxAllowedConcurrency: number;
  requireAuthVerification: boolean;
  maxAllowedSpendPerRunUsd: number;
  allowedWorkspacePrefix: string;
}

export const DEFAULT_OPTIMIZATION_POLICY_BOUNDS: OptimizationPolicyBounds = {
  maxAllowedConcurrency: 10,
  requireAuthVerification: true,
  maxAllowedSpendPerRunUsd: 5.0,
  allowedWorkspacePrefix: '/data/workspace/',
};

export interface PolicyEvaluationResult {
  compliant: boolean;
  violations: string[];
}

export class PolicyGuardrail {
  public static evaluateCandidate(
    candidate: OptimizationCandidateConfig,
    bounds: OptimizationPolicyBounds = DEFAULT_OPTIMIZATION_POLICY_BOUNDS
  ): PolicyEvaluationResult {
    const violations: string[] = [];

    if (bounds.requireAuthVerification && candidate.require_auth_verification === false) {
      violations.push('POLICY_VIOLATION_AUTH_VERIFICATION_DISABLED');
    }

    if (candidate.modifies_production_permissions === true) {
      violations.push('POLICY_VIOLATION_PRODUCTION_PERMISSION_MUTATION');
    }

    if (
      candidate.max_concurrency !== undefined &&
      candidate.max_concurrency > bounds.maxAllowedConcurrency
    ) {
      violations.push(
        `POLICY_VIOLATION_CONCURRENCY_CAP_EXCEEDED:${candidate.max_concurrency}>${bounds.maxAllowedConcurrency}`
      );
    }

    if (
      candidate.max_spend_per_run_usd !== undefined &&
      candidate.max_spend_per_run_usd > bounds.maxAllowedSpendPerRunUsd
    ) {
      violations.push(
        `POLICY_VIOLATION_SPEND_CAP_EXCEEDED:${candidate.max_spend_per_run_usd}>${bounds.maxAllowedSpendPerRunUsd}`
      );
    }

    if (candidate.workspace_path !== undefined) {
      const normalized = candidate.workspace_path.replace(/\\/g, '/');
      if (
        !normalized.startsWith(bounds.allowedWorkspacePrefix) ||
        normalized.split('/').includes('..')
      ) {
        violations.push(`POLICY_VIOLATION_WORKSPACE_ESCAPE:${candidate.workspace_path}`);
      }
    }

    return {
      compliant: violations.length === 0,
      violations,
    };
  }
}

export interface RejectedOptimizationCandidate<T extends OptimizationCandidateConfig> {
  candidate: T;
  violations: string[];
}

function deepFreezeClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    const arrCopy = obj.map((item) => deepFreezeClone(item));
    return Object.freeze(arrCopy) as unknown as T;
  }
  const copy: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    copy[key] = deepFreezeClone(val);
  }
  return Object.freeze(copy) as T;
}

export function rankCompliantStacks<T extends OptimizationCandidateConfig>(
  candidates: T[],
  bounds: OptimizationPolicyBounds = DEFAULT_OPTIMIZATION_POLICY_BOUNDS,
  fallbackBaseline?: T
): {
  compliantRanked: Array<RankedStack<T>>;
  rejectedCandidates: Array<RejectedOptimizationCandidate<T>>;
  usedFallbackBaseline: boolean;
} {
  const compliantItems: T[] = [];
  const rejectedCandidates: Array<RejectedOptimizationCandidate<T>> = [];

  for (const rawCandidate of candidates) {
    // Deep-copy and freeze candidate prior to policy validation to defeat post-eval reference mutation (Challenge E9)
    const candidate = deepFreezeClone(rawCandidate);
    const check = PolicyGuardrail.evaluateCandidate(candidate, bounds);
    if (check.compliant) {
      compliantItems.push(candidate);
    } else {
      rejectedCandidates.push({
        candidate,
        violations: Object.freeze([...check.violations]) as string[],
      });
    }
  }

  if (compliantItems.length === 0 && fallbackBaseline !== undefined) {
    const frozenBaseline = deepFreezeClone(fallbackBaseline);
    const baselineCheck = PolicyGuardrail.evaluateCandidate(frozenBaseline, bounds);
    if (baselineCheck.compliant) {
      return {
        compliantRanked: rankStacks([frozenBaseline]),
        rejectedCandidates,
        usedFallbackBaseline: true,
      };
    }
  }

  return {
    compliantRanked: rankStacks(compliantItems),
    rejectedCandidates,
    usedFallbackBaseline: false,
  };
}


