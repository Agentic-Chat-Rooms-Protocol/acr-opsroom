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
export const VOICE_MODEL_SPECS = {
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
export const AGENT_VOCAL_PERSONAS = {
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
        stereoPan: 0.0,
        formants: [460, 1280, 2420],
        systemVoiceHints: ['david', 'alex', 'guy', 'google us english', 'en-us-x-sfg#male_1-local'],
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
        stereoPan: -0.4,
        formants: [540, 1420, 2580],
        systemVoiceHints: ['michael', 'mark', 'daniel', 'fred', 'google uk english male', 'en-gb-x-rjs#male_1-local'],
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
        stereoPan: 0.4,
        formants: [640, 1860, 2920],
        systemVoiceHints: ['bella', 'zira', 'samantha', 'victoria', 'google us english female', 'en-us-x-sfg#female_1-local'],
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
        stereoPan: -0.75,
        formants: [410, 1180, 2320],
        systemVoiceHints: ['george', 'richard', 'oliver', 'en-au-x-aub#male_1-local'],
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
        stereoPan: 0.75,
        formants: [590, 1720, 2820],
        systemVoiceHints: ['sarah', 'karen', 'jenny', 'fiona', 'google uk english female'],
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
        stereoPan: 0.15,
        formants: [510, 1640, 2680],
        systemVoiceHints: ['emma', 'susan', 'catherine', 'tessa', 'moira', 'en-in-x-cxx#female_1-local'],
    },
};
export class VoiceModelLoadBalancer {
    /**
     * Automatically detect hardware, browser, and WebGPU capabilities
     */
    static detectHardwareProfile(nav, win) {
        const globalObj = typeof globalThis !== 'undefined' ? globalThis : undefined;
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
        if (hasWebGPU)
            score += 35;
        if (cpuCores >= 8)
            score += 15;
        else if (cpuCores >= 4)
            score += 10;
        if (deviceMemoryGb >= 8)
            score += 20;
        else if (deviceMemoryGb >= 4)
            score += 10;
        else if (deviceMemoryGb < 4)
            score -= 15;
        if (isMobile)
            score -= 25;
        const readinessScore = Math.max(10, Math.min(100, Math.round(score)));
        // Model selection based on forecasted constraints:
        let recommendedTier = 0;
        if (readinessScore >= 75 && hasWebGPU && !isMobile && deviceMemoryGb >= 8) {
            recommendedTier = 2; // High-Fidelity Kokoro-82M WebGPU
        }
        else if (readinessScore >= 45 && !isMobile && deviceMemoryGb >= 4) {
            recommendedTier = 1; // Piper / Kokoro-Tiny Edge Neural
        }
        else {
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
    static evaluateTierSafety(requestedTier, profile) {
        const spec = VOICE_MODEL_SPECS[requestedTier];
        const warnings = [];
        let riskLevel = 'none';
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
                if (riskLevel !== 'high')
                    riskLevel = 'medium';
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
    static getAgentVoicePersona(role) {
        return AGENT_VOCAL_PERSONAS[role] || AGENT_VOCAL_PERSONAS.atlas_orchestrator;
    }
    /**
     * Generates realistic multi-band frequency spectrum data for waveform visualizer,
     * modeling vowel formant resonance (F1, F2, F3) and syllable rhythm envelopes.
     */
    static generateSpeechFrequencies(sampleCount = 16, intensity = 0.7, options) {
        if (options && options.active === false) {
            return Array(sampleCount).fill(0.08);
        }
        const t = (options?.timestampMs ?? Date.now()) / 1000;
        const persona = options?.persona;
        const rate = persona?.rate || 1.0;
        // Syllable rhythm envelope (~4.2 Hz natural conversational speech cadence)
        const syllableEnvelope = 0.55 + 0.45 * Math.sin(t * 4.2 * 2 * Math.PI * rate);
        const formants = persona?.formants || [500, 1500, 2500];
        // Formant frequency mapping across 16 logarithmic spectrum bands
        const f1Band = Math.min(sampleCount - 1, Math.max(1, Math.round(((formants[0] - 100) / 700) * 4)));
        const f2Band = Math.min(sampleCount - 1, Math.max(4, Math.round(4 + ((formants[1] - 800) / 1700) * 6)));
        const f3Band = Math.min(sampleCount - 1, Math.max(10, Math.round(10 + ((formants[2] - 2500) / 5500) * 5)));
        const freqs = [];
        for (let i = 0; i < sampleCount; i++) {
            let resonance = 0.15;
            const distF1 = Math.abs(i - f1Band);
            const distF2 = Math.abs(i - f2Band);
            const distF3 = Math.abs(i - f3Band);
            if (distF1 <= 1)
                resonance += (1 - distF1 * 0.4) * 0.45;
            if (distF2 <= 1)
                resonance += (1 - distF2 * 0.4) * 0.35;
            if (distF3 <= 1)
                resonance += (1 - distF3 * 0.4) * 0.25;
            const microJitter = 0.12 * Math.sin(t * 18.0 + i * 1.7) + (Math.random() * 0.08 - 0.04);
            const energy = (resonance * syllableEnvelope + microJitter) * intensity;
            const clamped = Math.max(0.08, Math.min(1.0, energy));
            freqs.push(parseFloat(clamped.toFixed(2)));
        }
        return freqs;
    }
    /**
     * Creates an authentic human conversational turn sequence with realistic micro-pauses
     */
    static createConversationalScript(turns) {
        return turns.map((turn, index) => {
            const persona = this.getAgentVoicePersona(turn.role);
            // Realistic human inter-turn pause: 350ms to 550ms
            const pauseAfterMs = index === turns.length - 1 ? 200 : 400 + Math.floor(Math.random() * 150);
            const frequencies = this.generateSpeechFrequencies(16, 0.85, { persona });
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
//# sourceMappingURL=voice-engine.js.map