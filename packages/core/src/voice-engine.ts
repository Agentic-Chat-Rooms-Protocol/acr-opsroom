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
  readinessScore: number; // 0 to 100
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
  pitch: number; // 0.5 - 1.5
  rate: number;  // 0.7 - 1.4
  neuralVoiceId: string;
  timbreProfile: 'authoritative' | 'urgent' | 'vigilant' | 'methodical' | 'analytical' | 'empathetic';
  preferredGender: 'male' | 'female' | 'neutral';
  conversationalStyle: string;
  sampleQuote: string;
}

export interface ConversationalSpeechTurn {
  speakerName: string;
  role: AgentRole;
  text: string;
  pauseAfterMs: number;
  persona: VoicePersona;
  frequencies: number[];
}

export const VOICE_MODEL_SPECS: Record<VoiceTier, VoiceModelSpec> = {
  0: {
    tier: 0,
    name: 'Universal Native Voice Fabric',
    modelId: 'web-speech-native-fallback',
    downloadSizeMb: 0.0,
    ramOverheadMb: 0,
    latencyEstimateMs: 15,
    description: 'Zero-latency, 0MB download universal fallback powered by OS neural voices and dynamic persona pitch/rate acoustic modulation.',
    computeBackend: 'native_os',
    isUniversalZeroDownload: true,
    recommendedHardware: {
      minCpuCores: 1,
      minRamGb: 1,
      requiresWebGpu: false,
    },
  },
  1: {
    tier: 1,
    name: 'Piper / Kokoro-Tiny (Edge Neural)',
    modelId: 'onnx-community/Kokoro-82M-v1.0-ONNX-q4',
    downloadSizeMb: 38.4,
    ramOverheadMb: 160,
    latencyEstimateMs: 95,
    description: 'Quantized 4-bit edge neural speech synthesis running via WebAssembly SIMD or WebGPU. Balanced for mid-tier workstations and laptops.',
    computeBackend: 'wasm_simd',
    isUniversalZeroDownload: false,
    recommendedHardware: {
      minCpuCores: 4,
      minRamGb: 4,
      requiresWebGpu: false,
    },
  },
  2: {
    tier: 2,
    name: 'Kokoro-82M v1.0 (High-Fidelity Neural)',
    modelId: 'onnx-community/Kokoro-82M-v1.0-ONNX-q8',
    downloadSizeMb: 82.6,
    ramOverheadMb: 420,
    latencyEstimateMs: 45,
    description: 'Bleeding-edge 82M-parameter local neural speech model executing on WebGPU with human-parity prosody, cadence, and vocal realism.',
    computeBackend: 'webgpu',
    isUniversalZeroDownload: false,
    recommendedHardware: {
      minCpuCores: 8,
      minRamGb: 8,
      requiresWebGpu: true,
    },
  },
};

export const AGENT_VOCAL_PERSONAS: Record<AgentRole, VoicePersona> = {
  atlas_orchestrator: {
    role: 'atlas_orchestrator',
    name: 'Atlas Orchestrator',
    pitch: 0.88,
    rate: 1.0,
    neuralVoiceId: 'am_adam',
    timbreProfile: 'authoritative',
    preferredGender: 'male',
    conversationalStyle: 'Direct, commanding, and objective incident commander.',
    sampleQuote: 'Incident posture escalated. Aligning squad on critical path mitigation.',
  },
  sre_reliability: {
    role: 'sre_reliability',
    name: 'Lead SRE',
    pitch: 1.02,
    rate: 1.12,
    neuralVoiceId: 'am_michael',
    timbreProfile: 'urgent',
    preferredGender: 'male',
    conversationalStyle: 'Fast-paced, metric-focused, latency and buffer aware.',
    sampleQuote: 'Replication lag surging past 450ms. Recommending immediate traffic shedding.',
  },
  secops_guardian: {
    role: 'secops_guardian',
    name: 'SecOps Guardian',
    pitch: 1.18,
    rate: 0.98,
    neuralVoiceId: 'af_bella',
    timbreProfile: 'vigilant',
    preferredGender: 'female',
    conversationalStyle: 'Methodical, defensive, zero-trust verification focused.',
    sampleQuote: 'Zero-trust containment verified. Egress allowlists strictly enforced.',
  },
  dataops_engineer: {
    role: 'dataops_engineer',
    name: 'DataOps Engineer',
    pitch: 0.92,
    rate: 0.92,
    neuralVoiceId: 'bm_george',
    timbreProfile: 'methodical',
    preferredGender: 'male',
    conversationalStyle: 'Deliberate, schema-protective, transaction-safe cadence.',
    sampleQuote: 'WAL checkpoint queue holding. Primary failover verified transactionally clean.',
  },
  finops_overseer: {
    role: 'finops_overseer',
    name: 'FinOps Overseer',
    pitch: 1.05,
    rate: 1.05,
    neuralVoiceId: 'af_sarah',
    timbreProfile: 'analytical',
    preferredGender: 'female',
    conversationalStyle: 'Budget-aware, calculated, cost-per-minute conscious.',
    sampleQuote: 'Failover infrastructure within allocated monthly cloud reserve ceiling.',
  },
  compliance_auditor: {
    role: 'compliance_auditor',
    name: 'Compliance Auditor',
    pitch: 1.12,
    rate: 0.96,
    neuralVoiceId: 'bf_emma',
    timbreProfile: 'empathetic',
    preferredGender: 'female',
    conversationalStyle: 'Meticulous, audit-proof, regulatory governance guardian.',
    sampleQuote: 'Cryptographic ledger signed. SOC2 and Byzantine proof requirements met.',
  },
};

export class VoiceModelLoadBalancer {
  /**
   * Automatically detect hardware, browser, and WebGPU capabilities
   */
  public static detectHardwareProfile(nav?: any, win?: any): HardwareProfile {
    const globalObj = typeof globalThis !== 'undefined' ? (globalThis as any) : undefined;
    const n = nav || (typeof navigator !== 'undefined' ? navigator : globalObj?.navigator);
    const w = win || (globalObj?.window ? globalObj.window : undefined);

    const hasWebGPU = Boolean(n && n.gpu);
    const cpuCores = Number(n?.hardwareConcurrency || 4);
    const deviceMemoryGb = Number(n?.deviceMemory || (hasWebGPU ? 8 : 4));

    let isMobile = false;
    if (n?.userAgent) {
      const ua = String(n.userAgent).toLowerCase();
      isMobile = /android|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua);
    }
    if (n?.maxTouchPoints && n.maxTouchPoints > 1 && w?.innerWidth && w.innerWidth < 768) {
      isMobile = true;
    }

    const hasAudioContext = Boolean(w && (w.AudioContext || w.webkitAudioContext));
    const hasSpeechSynthesis = Boolean(w && w.speechSynthesis);

    // Algorithmic Hardware Readiness Score calculation (0 - 100)
    let score = 30; // base score
    if (hasWebGPU) score += 35;
    if (cpuCores >= 8) score += 15;
    else if (cpuCores >= 4) score += 10;

    if (deviceMemoryGb >= 8) score += 20;
    else if (deviceMemoryGb >= 4) score += 10;
    else if (deviceMemoryGb < 4) score -= 15;

    if (isMobile) score -= 25;

    const readinessScore = Math.max(10, Math.min(100, Math.round(score)));

    // Model selection based on forecasted constraints:
    let recommendedTier: VoiceTier = 0;
    if (readinessScore >= 75 && hasWebGPU && !isMobile && deviceMemoryGb >= 8) {
      recommendedTier = 2; // High-Fidelity Kokoro-82M WebGPU
    } else if (readinessScore >= 45 && !isMobile && deviceMemoryGb >= 4) {
      recommendedTier = 1; // Piper / Kokoro-Tiny Edge Neural
    } else {
      recommendedTier = 0; // Universal Native Fallback (0MB, safe for mobile & low spec)
    }

    const detectedSpecsSummary = `${cpuCores} CPU Cores • ${deviceMemoryGb}GB RAM • ${hasWebGPU ? 'WebGPU Active' : 'No WebGPU'} • ${isMobile ? 'Mobile Form Factor' : 'Desktop/Workstation'}`;

    return {
      hasWebGPU,
      cpuCores,
      deviceMemoryGb,
      isMobile,
      hasAudioContext,
      hasSpeechSynthesis,
      readinessScore,
      recommendedTier,
      detectedSpecsSummary,
    };
  }

  /**
   * Evaluate whether a requested tier is safe on the current hardware profile,
   * returning dynamic warnings and requiring explicit user consent if downloading models.
   */
  public static evaluateTierSafety(
    requestedTier: VoiceTier,
    profile: HardwareProfile
  ): TierSafetyEvaluation {
    const spec = VOICE_MODEL_SPECS[requestedTier];
    const warnings: string[] = [];
    let riskLevel: 'none' | 'low' | 'medium' | 'high' = 'none';

    // Tier 0 is always 100% safe
    if (requestedTier === 0) {
      return {
        isSafe: true,
        riskLevel: 'none',
        warnings: [],
        requiresExplicitConsent: false,
        recommendationNote: 'Universal Native Voice Fabric requires 0MB download and runs safely on all devices and browsers with zero memory overhead.',
      };
    }

    // Tier 1 evaluations
    if (requestedTier === 1) {
      if (profile.isMobile) {
        warnings.push('Mobile device detected: running 38.4MB neural model in background may drain battery and stutter during touch gestures.');
        riskLevel = 'medium';
      }
      if (profile.deviceMemoryGb < 4) {
        warnings.push('System RAM is under 4GB: allocating ~160MB model tensor buffer may cause GC pressure.');
        riskLevel = 'medium';
      }
      if (profile.cpuCores < 4) {
        warnings.push('CPU has fewer than 4 cores: neural audio synthesis might lag behind real-time speech playback.');
        riskLevel = 'low';
      }
    }

    // Tier 2 evaluations
    if (requestedTier === 2) {
      if (!profile.hasWebGPU) {
        warnings.push('WebGPU is NOT available on this browser/device. Kokoro-82M will be forced to fall back to WASM CPU inference, resulting in severe latency (>1500ms per turn).');
        riskLevel = 'high';
      }
      if (profile.isMobile) {
        warnings.push('Mobile browser detected: 82.6MB neural model tensor weights can trigger mobile OS low-memory termination (tab crash).');
        riskLevel = 'high';
      }
      if (profile.deviceMemoryGb < 8) {
        warnings.push(`Device RAM (${profile.deviceMemoryGb}GB) is below the recommended 8GB threshold for local Kokoro-82M neural execution.`);
        if (riskLevel !== 'high') riskLevel = 'medium';
      }
      if (profile.cpuCores < 8 && !profile.hasWebGPU) {
        warnings.push('Insufficient compute hardware for high-fidelity neural model without GPU acceleration.');
        riskLevel = 'high';
      }
    }

    const isSafe = riskLevel !== 'high';
    const recommendationNote = warnings.length === 0
      ? `Hardware fully capable for ${spec.name}. Proceed with download.`
      : `Hardware constraints detected. Explicit user confirmation is required before attempting to download ${spec.downloadSizeMb}MB.`;

    return {
      isSafe,
      riskLevel,
      warnings,
      requiresExplicitConsent: true,
      recommendationNote,
    };
  }

  /**
   * Retrieve the distinct vocal persona for an agent role
   */
  public static getAgentVoicePersona(role: AgentRole): VoicePersona {
    return AGENT_VOCAL_PERSONAS[role] || AGENT_VOCAL_PERSONAS.atlas_orchestrator;
  }

  /**
   * Generates realistic multi-band frequency spectrum data for waveform visualizer
   */
  public static generateSpeechFrequencies(sampleCount: number = 16, intensity: number = 0.7): number[] {
    const freqs: number[] = [];
    for (let i = 0; i < sampleCount; i++) {
      // Bell-shaped curve with acoustic fluctuations
      const centerFactor = 1 - Math.abs(i - sampleCount / 2) / (sampleCount / 2);
      const val = Math.max(0.1, Math.min(1.0, (centerFactor * 0.6 + Math.random() * 0.4) * intensity));
      freqs.push(parseFloat(val.toFixed(2)));
    }
    return freqs;
  }

  /**
   * Creates an authentic human conversational turn sequence with realistic micro-pauses
   */
  public static createConversationalScript(
    turns: Array<{ speakerName: string; role: AgentRole; text: string }>
  ): ConversationalSpeechTurn[] {
    return turns.map((turn, index) => {
      const persona = this.getAgentVoicePersona(turn.role);
      // Realistic human inter-turn pause: 350ms to 550ms
      const pauseAfterMs = index === turns.length - 1 ? 200 : 400 + Math.floor(Math.random() * 150);
      const frequencies = this.generateSpeechFrequencies(16, 0.85);

      return {
        speakerName: turn.speakerName,
        role: turn.role,
        text: turn.text,
        pauseAfterMs,
        persona,
        frequencies,
      };
    });
  }
}
