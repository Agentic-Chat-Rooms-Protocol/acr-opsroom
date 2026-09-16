/**
 * ACR OpsRoom - Synthetic Multi-Agent Huddle Manager
 * Evolved beyond Slack AI Huddle notes:
 * While Slack AI merely records human audio meetings,
 * OpsRoom runs autonomous, synthetic multi-agent deliberation huddles,
 * resolves cross-specialization conflict, and compiles executive briefs with live canvas sync.
 */
import { HuddleSession, HuddleLine, AgentProfile, OpsCanvas } from './types.js';
export declare class HuddleManager {
    /**
     * Create an active huddle session with participating agents.
     */
    static startHuddle(incidentId: string, participants: AgentProfile[]): HuddleSession;
    /**
     * Post a spoken line into the synthetic huddle with simulated frequency visualization data.
     */
    static addSpokenLine(huddle: HuddleSession, agent: AgentProfile, text: string): HuddleLine;
    /**
     * Conclude the huddle, extract executive brief and action items, and sync to Ops Canvas.
     */
    static synthesizeAndSyncToCanvas(huddle: HuddleSession, canvas: OpsCanvas): {
        brief: string;
        newActionItems: string[];
    };
}
//# sourceMappingURL=huddle-manager.d.ts.map