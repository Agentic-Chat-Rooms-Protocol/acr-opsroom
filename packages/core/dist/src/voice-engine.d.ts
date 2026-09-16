/**
 * ACR OpsRoom - Autonomous Voice Model, Inference & Hardware-Aware Load Balancer Engine
 *
 * Implements a dynamic, browser- and hardware-aware voice orchestration fabric:
 * - Tier 0: Universal Native Web Speech API (0MB download, 0MB RAM, 100% universal fallback)
 * - Tier 1: Lightweight Piper/Kokoro-Tiny Neural Model (~38.4MB, ~160MB RAM, WASM SIMD/WebGPU)
 * - Tier 2: High-Fidelity Kokoro-82M Neural Model (~82.6MB, ~420MB RAM, WebGPU accelerated)
 *
 * Enforces explicit user confirmation before initiating local model downloads,
 * computes device readiness scores, dynamic memory/compute crash warnings,
 * and distinct agent vocal persona acoustic profiles (pitch, rate, timbre, voice IDs).
 */
import { AgentRole } from './types.js';
export type VoiceTier = 0 | 1 | 2;
export interface VoiceModelSpec {
    tier: VoiceTier;
    name: string;
    modelId: string;
    downloadSizeMb: number;
    ramOverheadMb: number;
    latencyEstimateMs: number;
    description: string;
    computeBackend: 'native_os' | 'wasm_simd' | 'webgpu';
    isUniversalZeroDownload: boolean;
    recommendedHardware: {
        minCpuCores: number;
        minRamGb: number;
        requiresWebGpu: boolean;
    };
}
export interface HardwareProfile {
    hasWebGPU: boolean;
    cpuCores: number;
    deviceMemoryGb: number;
    isMobile: boolean;
    hasAudioContext: boolean;
    hasSpeechSynthesis: boolean;
    readinessScore: number;
    recommendedTier: VoiceTier;
    detectedSpecsSummary: string;
}
export interface TierSafetyEvaluation {
    isSafe: boolean;
    riskLevel: 'none' | 'low' | 'medium' | 'high';
    warnings: string[];
    requiresExplicitConsent: boolean;
    recommendationNote: string;
}
export interface VoicePersona {
    role: AgentRole;
    name: string;
    pitch: number;
    rate: number;
    neuralVoiceId: string;
    timbreProfile: 'authoritative' | 'urgent' | 'vigilant' | 'methodical' | 'analytical' | 'empathetic';
    preferredGender: 'male' | 'female' | 'neutral';
    conversationalStyle: string;
    sampleQuote: string;
    stereoPan: number;
    formants: [number, number, number];
    systemVoiceHints: string[];
}
export interface ConversationalSpeechTurn {
    speakerName: string;
    role: AgentRole;
    text: string;
    pauseAfterMs: number;
    persona: VoicePersona;
    frequencies: number[];
}
export declare const VOICE_MODEL_SPECS: Record<VoiceTier, VoiceModelSpec>;
export declare const AGENT_VOCAL_PERSONAS: Record<AgentRole, VoicePersona>;
export declare class VoiceModelLoadBalancer {
    /**
     * Automatically detect hardware, browser, and WebGPU capabilities
     */
    static detectHardwareProfile(nav?: any, win?: any): HardwareProfile;
    /**
     * Evaluate whether a requested tier is safe on the current hardware profile,
     * returning dynamic warnings and requiring explicit user consent if downloading models.
     */
    static evaluateTierSafety(requestedTier: VoiceTier, profile: HardwareProfile): TierSafetyEvaluation;
    /**
     * Retrieve the distinct vocal persona for an agent role
     */
    static getAgentVoicePersona(role: AgentRole): VoicePersona;
    /**
     * Generates realistic multi-band frequency spectrum data for waveform visualizer,
     * modeling vowel formant resonance (F1, F2, F3) and syllable rhythm envelopes.
     */
    static generateSpeechFrequencies(sampleCount?: number, intensity?: number, options?: {
        timestampMs?: number;
        persona?: VoicePersona;
        active?: boolean;
    }): number[];
    /**
     * Creates an authentic human conversational turn sequence with realistic micro-pauses
     */
    static createConversationalScript(turns: Array<{
        speakerName: string;
        role: AgentRole;
        text: string;
    }>): ConversationalSpeechTurn[];
}
//# sourceMappingURL=voice-engine.d.ts.map