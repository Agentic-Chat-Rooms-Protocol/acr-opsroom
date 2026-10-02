/**
 * Domain Agent Pods & Meta-LLM Darwin Loops
 *
 * Implements cheap-by-default model tier escalation (low -> mid -> high/frontier)
 * with AgentiCow behavioral assertion validation and Reserve-and-Commit spend guards.
 *
 * Invariant: Zero emoji.
 */

export type PodDomain = 'research' | 'coding' | 'security' | 'trading' | 'tasks' | 'business-ops';
export type ModelTier = 'low' | 'mid' | 'high';
export type PodStatus = 'spawned' | 'executing' | 'evaluating' | 'escalating' | 'completed' | 'failed';

export interface PodTemplate {
  templateRef: string; // e.g. "coding/refactor-agent@v1.2"
  domain: PodDomain;
  systemPrompt: string;
  tools: string[];
  benchAssertions: string; // Behavioral test assertion
  perAgentCapUsd: number;  // Programmatic spend cap
  cronSchedule?: string;
  maxTier: ModelTier;      // Tier ceiling
  registeredRoom: string;  // Room slug for signed reporting
}

export interface DarwinLoopAttempt {
  tier: ModelTier;
  output: string;
  assertionPassed: boolean;
  spendUsd: number;
  cumulativeSpendUsd: number;
  failureReason?: string;
  timestamp: string;
}

export interface DarwinLoopTelemetry {
  templateRef: string;
  domain: PodDomain;
  status: PodStatus;
  currentTier: ModelTier;
  maxTier: ModelTier;
  totalAttempts: number;
  cumulativeSpendUsd: number;
  perAgentCapUsd: number;
  budgetRemainingUsd: number;
  isBudgetExhausted: boolean;
  lastFailureReason?: string;
}

export const TIER_COST_ESTIMATES: Record<ModelTier, number> = {
  low: 0.002,   // $0.002 per call (e.g. cheap sub-model)
  mid: 0.015,   // $0.015 per call (e.g. balanced mid model)
  high: 0.080,  // $0.080 per call (e.g. frontier reasoning model)
};

export class DarwinPodController {
  public readonly template: PodTemplate;
  private _status: PodStatus = 'spawned';
  private _currentTier: ModelTier = 'low'; // Cheap-by-default
  private _cumulativeSpendUsd = 0;
  private readonly _history: DarwinLoopAttempt[] = [];
  private _lastFailureReason?: string;

  constructor(template: PodTemplate) {
    this.template = template;
  }

  public get status(): PodStatus {
    return this._status;
  }

  public get currentTier(): ModelTier {
    return this._currentTier;
  }

  public get cumulativeSpendUsd(): number {
    return this._cumulativeSpendUsd;
  }

  public get history(): ReadonlyArray<DarwinLoopAttempt> {
    return this._history;
  }

  public get lastFailureReason(): string | undefined {
    return this._lastFailureReason;
  }

  /**
   * Advances the Darwin Loop state machine by processing one execution result.
   */
  public evaluateStep(
    output: string,
    customAssertionEvaluator?: (output: string, assertion: string) => boolean
  ): { status: PodStatus; tier: ModelTier; passed: boolean; escalated: boolean } {
    if (this._status === 'completed' || this._status === 'failed') {
      return { status: this._status, tier: this._currentTier, passed: this._status === 'completed', escalated: false };
    }

    // Step 1: Charge tier cost
    const stepCost = TIER_COST_ESTIMATES[this._currentTier];
    if (this._cumulativeSpendUsd + stepCost > this.template.perAgentCapUsd) {
      this._status = 'failed';
      this._lastFailureReason = `Budget exhausted: current spend $${this._cumulativeSpendUsd.toFixed(4)} + cost $${stepCost.toFixed(4)} exceeds cap $${this.template.perAgentCapUsd.toFixed(2)}`;
      return { status: 'failed', tier: this._currentTier, passed: false, escalated: false };
    }

    this._cumulativeSpendUsd += stepCost;
    this._status = 'evaluating';

    // Step 2: Validate against bench_assertions
    const passed = customAssertionEvaluator
      ? customAssertionEvaluator(output, this.template.benchAssertions)
      : this.defaultAssertionCheck(output, this.template.benchAssertions);

    const attempt: DarwinLoopAttempt = {
      tier: this._currentTier,
      output,
      assertionPassed: passed,
      spendUsd: stepCost,
      cumulativeSpendUsd: this._cumulativeSpendUsd,
      timestamp: new Date().toISOString(),
    };

    if (passed) {
      this._status = 'completed';
      this._history.push(attempt);
      return { status: 'completed', tier: this._currentTier, passed: true, escalated: false };
    }

    // Step 3: Assertion failed - Evaluate Darwin escalation
    attempt.failureReason = `Behavioral assertion failed at tier ${this._currentTier}: ${this.template.benchAssertions}`;
    this._lastFailureReason = attempt.failureReason;
    this._history.push(attempt);

    const nextTier = this.getNextTier(this._currentTier);
    if (!nextTier || this.isTierHigherThanMax(nextTier, this.template.maxTier)) {
      // Reached tier ceiling
      this._status = 'failed';
      this._lastFailureReason = `Behavioral gate failed and reached tier ceiling: ${this.template.maxTier}`;
      return { status: 'failed', tier: this._currentTier, passed: false, escalated: false };
    }

    // Check if next tier is within budget
    const nextTierCost = TIER_COST_ESTIMATES[nextTier];
    if (this._cumulativeSpendUsd + nextTierCost > this.template.perAgentCapUsd) {
      this._status = 'failed';
      this._lastFailureReason = `Budget exhausted before escalating to ${nextTier}`;
      return { status: 'failed', tier: this._currentTier, passed: false, escalated: false };
    }

    // Escalate tier
    this._currentTier = nextTier;
    this._status = 'escalating';
    return { status: 'escalating', tier: this._currentTier, passed: false, escalated: true };
  }

  /**
   * Automatically executes the loop until completion or terminal failure.
   */
  public async runDarwinLoop(
    worker: (tier: ModelTier) => Promise<string>,
    customAssertionEvaluator?: (output: string, assertion: string) => boolean
  ): Promise<{ status: PodStatus; finalTier: ModelTier; totalAttempts: number; spendUsd: number }> {
    this._status = 'executing';

    while ((this._status as PodStatus) !== 'completed' && (this._status as PodStatus) !== 'failed') {
      const output = await worker(this._currentTier);
      const res = this.evaluateStep(output, customAssertionEvaluator);
      if (res.status === 'escalating') {
        this._status = 'executing'; // Loop continues at higher tier
      }
    }

    return {
      status: this._status,
      finalTier: this._currentTier,
      totalAttempts: this._history.length,
      spendUsd: Number(this._cumulativeSpendUsd.toFixed(4)),
    };
  }

  public getTelemetry(): DarwinLoopTelemetry {
    const remaining = Math.max(0, this.template.perAgentCapUsd - this._cumulativeSpendUsd);
    return {
      templateRef: this.template.templateRef,
      domain: this.template.domain,
      status: this._status,
      currentTier: this._currentTier,
      maxTier: this.template.maxTier,
      totalAttempts: this._history.length,
      cumulativeSpendUsd: Number(this._cumulativeSpendUsd.toFixed(4)),
      perAgentCapUsd: this.template.perAgentCapUsd,
      budgetRemainingUsd: Number(remaining.toFixed(4)),
      isBudgetExhausted: remaining <= 0,
      lastFailureReason: this._lastFailureReason,
    };
  }

  private getNextTier(tier: ModelTier): ModelTier | null {
    if (tier === 'low') return 'mid';
    if (tier === 'mid') return 'high';
    return null;
  }

  private isTierHigherThanMax(tier: ModelTier, maxTier: ModelTier): boolean {
    const order: Record<ModelTier, number> = { low: 1, mid: 2, high: 3 };
    return order[tier] > order[maxTier];
  }

  private defaultAssertionCheck(output: string, assertion: string): boolean {
    if (!assertion || assertion.trim().length === 0) return true;
    // Standard string contains or regex check
    try {
      const re = new RegExp(assertion, 'i');
      return re.test(output);
    } catch {
      return output.includes(assertion);
    }
  }
}
