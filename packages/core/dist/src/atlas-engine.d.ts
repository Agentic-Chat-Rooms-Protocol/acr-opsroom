/**
 * ACR OpsRoom - Atlas 2.0 Deliberation & State Machine Engine
 * Next-generation goal-directed cognitive orchestrator.
 *
 * Evolved beyond Salesforce's Atlas 1.0:
 * - Multi-agent graph orchestration instead of single-agent prompt chaining
 * - Persistent execution register with loop-cycling prevention
 * - Formal dry-run preflight validation and automated rollback dag
 * - Dynamic Byzantine consensus gating before any mutation
 */
import { OpsIncident, DeliberationPhase, DeliberationTurn, ExecutionPlan, AgentSquad, AgentProfile, IncidentStatus, ToolCallProposal } from './types.js';
export interface StateTransitionEvent {
    fromPhase: DeliberationPhase;
    toPhase: DeliberationPhase;
    reason: string;
    timestamp: number;
}
export declare class Atlas2Engine {
    private static MAX_DELIBERATION_TURNS;
    /**
     * Initialize a new OpsIncident with grounded state machine.
     */
    static createIncident(title: string, description: string, squad: AgentSquad): OpsIncident;
    /**
     * Execute an atomic state transition with validation.
     */
    static transitionPhase(incident: OpsIncident, targetStatus: IncidentStatus): StateTransitionEvent;
    private static mapStatusToPhase;
    /**
     * Record a structured deliberation turn from a specialized agent with Ed25519 payload signing.
     */
    static addDeliberationTurn(incident: OpsIncident, agent: AgentProfile, reasoning: string, proposedHypothesis?: string, proposedActions?: ToolCallProposal[], confidence?: number): DeliberationTurn;
    /**
     * Synthesize proposals into a verified ExecutionPlan with rollback hooks.
     */
    static compileExecutionPlan(incident: OpsIncident, targetGoal: string): ExecutionPlan;
    /**
     * Run Dry-Run Preflight Simulation across all steps before permitting write mutations.
     */
    static simulateDryRun(plan: ExecutionPlan): {
        passed: boolean;
        simulationLog: string[];
    };
}
//# sourceMappingURL=atlas-engine.d.ts.map