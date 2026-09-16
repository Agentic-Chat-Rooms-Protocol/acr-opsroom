import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceModelLoadBalancer, VOICE_MODEL_SPECS, AGENT_VOCAL_PERSONAS, } from '../src/voice-engine.js';
describe('VoiceModelLoadBalancer & Dynamic Hardware Profiler', () => {
    test('profiles high-end WebGPU workstation and recommends Tier 2', () => {
        const mockNav = {
            gpu: {},
            hardwareConcurrency: 16,
            deviceMemory: 32,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            maxTouchPoints: 0,
        };
        const mockWin = {
            innerWidth: 1920,
            AudioContext: class {
            },
            speechSynthesis: {},
        };
        const profile = VoiceModelLoadBalancer.detectHardwareProfile(mockNav, mockWin);
        assert.equal(profile.hasWebGPU, true);
        assert.equal(profile.cpuCores, 16);
        assert.equal(profile.deviceMemoryGb, 32);
        assert.equal(profile.isMobile, false);
        assert.ok(profile.readinessScore >= 80);
        assert.equal(profile.recommendedTier, 2);
        const safety = VoiceModelLoadBalancer.evaluateTierSafety(2, profile);
        assert.equal(safety.isSafe, true);
        assert.equal(safety.riskLevel, 'none');
        assert.equal(safety.requiresExplicitConsent, true);
    });
    test('profiles mid-spec laptop without WebGPU and recommends Tier 1', () => {
        const mockNav = {
            gpu: undefined,
            hardwareConcurrency: 4,
            deviceMemory: 8,
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
            maxTouchPoints: 0,
        };
        const mockWin = {
            innerWidth: 1440,
            AudioContext: class {
            },
            speechSynthesis: {},
        };
        const profile = VoiceModelLoadBalancer.detectHardwareProfile(mockNav, mockWin);
        assert.equal(profile.hasWebGPU, false);
        assert.equal(profile.isMobile, false);
        assert.equal(profile.recommendedTier, 1);
        // If user tries to override to Tier 2 without WebGPU, must trigger High Risk warning
        const tier2Safety = VoiceModelLoadBalancer.evaluateTierSafety(2, profile);
        assert.equal(tier2Safety.riskLevel, 'high');
        assert.equal(tier2Safety.isSafe, false);
        assert.ok(tier2Safety.warnings.some(w => w.includes('WebGPU is NOT available')));
    });
    test('profiles mobile or memory-constrained device and recommends Tier 0 (Universal Native)', () => {
        const mockNav = {
            gpu: undefined,
            hardwareConcurrency: 2,
            deviceMemory: 2,
            userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
            maxTouchPoints: 5,
        };
        const mockWin = {
            innerWidth: 390,
            AudioContext: class {
            },
            speechSynthesis: {},
        };
        const profile = VoiceModelLoadBalancer.detectHardwareProfile(mockNav, mockWin);
        assert.equal(profile.isMobile, true);
        assert.equal(profile.recommendedTier, 0);
        // Tier 0 is always safe and requires zero download
        const tier0Safety = VoiceModelLoadBalancer.evaluateTierSafety(0, profile);
        assert.equal(tier0Safety.isSafe, true);
        assert.equal(tier0Safety.requiresExplicitConsent, false);
        assert.equal(VOICE_MODEL_SPECS[0].downloadSizeMb, 0);
        // Overriding to Tier 2 on mobile triggers high risk crash warning
        const overrideSafety = VoiceModelLoadBalancer.evaluateTierSafety(2, profile);
        assert.equal(overrideSafety.riskLevel, 'high');
        assert.ok(overrideSafety.warnings.some(w => w.includes('Mobile browser detected')));
    });
    test('verifies distinct vocal personas across all squad roles', () => {
        const roles = Object.keys(AGENT_VOCAL_PERSONAS);
        assert.equal(roles.length >= 5, true);
        const neuralVoices = new Set();
        const pitches = new Set();
        const pans = new Set();
        for (const role of roles) {
            const persona = VoiceModelLoadBalancer.getAgentVoicePersona(role);
            assert.ok(persona.name.length > 0);
            assert.ok(persona.pitch >= 0.8 && persona.pitch <= 1.3);
            assert.ok(persona.rate >= 0.85 && persona.rate <= 1.25);
            assert.ok(persona.neuralVoiceId.length > 0);
            assert.ok(persona.sampleQuote.length > 0);
            assert.ok(persona.stereoPan >= -1.0 && persona.stereoPan <= 1.0);
            assert.equal(persona.formants.length, 3);
            assert.ok(persona.formants[0] >= 350 && persona.formants[0] <= 800);
            assert.ok(persona.systemVoiceHints.length >= 2);
            neuralVoices.add(persona.neuralVoiceId);
            pitches.add(persona.pitch);
            pans.add(persona.stereoPan);
        }
        // Ensure variety in vocal profiles
        assert.ok(neuralVoices.size >= 5, 'Every agent should have distinct neural voice profile');
        assert.ok(pitches.size >= 4, 'Agents should have distinct vocal pitch characteristics');
        assert.ok(pans.size >= 5, 'Agents should be distributed spatially across stereo soundstage');
    });
    test('creates conversational turns with natural pauses and acoustic frequency data', () => {
        const rawTurns = [
            { speakerName: 'Atlas Orchestrator', role: 'atlas_orchestrator', text: 'Incident detected in replication cluster.' },
            { speakerName: 'Lead SRE', role: 'sre_reliability', text: 'Latency spike confirmed at 820ms. Traffic reroute ready.' },
            { speakerName: 'SecOps Guardian', role: 'secops_guardian', text: 'Zero-trust perimeter intact. Container sandbox verified.' },
        ];
        const script = VoiceModelLoadBalancer.createConversationalScript(rawTurns);
        assert.equal(script.length, 3);
        for (const turn of script) {
            assert.ok(turn.pauseAfterMs >= 200 && turn.pauseAfterMs <= 600);
            assert.equal(turn.frequencies.length, 16);
            assert.ok(turn.frequencies.every(f => f >= 0 && f <= 1.0));
            assert.ok(turn.persona.neuralVoiceId.length > 0);
        }
    });
});
//# sourceMappingURL=voice-engine.test.js.map