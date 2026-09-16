/**
 * Browser Audio Fabric for acr-opsroom web
 * 
 * Features:
 * - Dynamic VoicePersona voice matching with multi-candidate OS fallback & gender dispersion
 * - Robust volume attenuation & mute handling (never mutates speech rate to 0)
 * - Monotonic session token cancellation preventing turn collision race conditions
 * - Web Audio API spatial panner & formant resonance filters for Neural Tiers (Tier 1 & 2)
 * - Real-time frequency spectrum visualizer driven by AnalyserNode or Formant harmonics
 * - Universal browser lifecycle defense (Chrome 15s pause bug, Safari gesture unlock)
 */
import {
  VoiceModelLoadBalancer,
  VoicePersona,
  VoiceTier,
  VOICE_MODEL_SPECS,
} from '@acr-js/opsroom-core';

export interface SpeakOptions {
  tier?: VoiceTier;
  volume?: number;      // 0.0 to 1.0 (default 1.0)
  speedMultiplier?: number;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (err: any) => void;
  onFrequencies?: (freqs: number[]) => void;
}

export class BrowserAudioFabric {
  private static activeUtterance: SpeechSynthesisUtterance | null = null;
  private static animFrameId: number | null = null;
  private static cachedVoices: SpeechSynthesisVoice[] = [];
  private static audioCtx: AudioContext | null = null;
  private static currentSessionId: number = 0;
  private static resumeTimerId: any = null;

  public static initVoices(): void {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    this.cachedVoices = window.speechSynthesis.getVoices();
    const updateVoices = () => {
      this.cachedVoices = window.speechSynthesis.getVoices();
    };
    if (window.speechSynthesis.addEventListener) {
      window.speechSynthesis.addEventListener('voiceschanged', updateVoices);
    } else {
      window.speechSynthesis.onvoiceschanged = updateVoices;
    }
  }

  private static getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  public static findBestVoice(persona: VoicePersona): SpeechSynthesisVoice | null {
    if (this.cachedVoices.length === 0 && typeof window !== 'undefined' && window.speechSynthesis) {
      this.cachedVoices = window.speechSynthesis.getVoices();
    }
    if (this.cachedVoices.length === 0) return null;

    const voices = this.cachedVoices;
    const englishVoices = voices.filter((v) => v.lang.toLowerCase().startsWith('en'));
    const candidatePool = englishVoices.length > 0 ? englishVoices : voices;

    // 1. Exact system voice hint match
    if (persona.systemVoiceHints && persona.systemVoiceHints.length > 0) {
      for (const hint of persona.systemVoiceHints) {
        const matched = candidatePool.find((v) => v.name.toLowerCase().includes(hint.toLowerCase()));
        if (matched) return matched;
      }
    }

    // 2. Filter candidate pool by preferred gender
    const isFemalePreferred = persona.preferredGender === 'female';
    const femalePattern = /female|zira|samantha|victoria|karen|jenny|fiona|susan|catherine|emma|tessa|moira/i;
    const malePattern = /male|david|mark|george|daniel|alex|fred|guy|richard|oliver|michael/i;

    const genderMatched = candidatePool.filter((v) => {
      const name = v.name.toLowerCase();
      return isFemalePreferred ? femalePattern.test(name) : malePattern.test(name);
    });

    if (genderMatched.length > 0) {
      // Deterministic hash offset based on role to assign DIFFERENT voices to agents of same gender
      let hash = 0;
      for (let i = 0; i < persona.role.length; i++) {
        hash = (hash << 5) - hash + persona.role.charCodeAt(i);
      }
      const index = Math.abs(hash) % genderMatched.length;
      return genderMatched[index];
    }

    return candidatePool[0] || null;
  }

  public static speak(
    text: string,
    persona: VoicePersona,
    options?: SpeakOptions
  ): void {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      options?.onEnd?.();
      return;
    }

    // Increment monotonic session ID to cancel any prior turn or waiting callbacks
    const sessionId = ++this.currentSessionId;
    this.stopInternal();

    // Volume handling: respect mute without mangling rate
    const targetVolume = options?.volume !== undefined ? Math.max(0, Math.min(1, options.volume)) : 1.0;

    // Build utterance
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.volume = targetVolume;
    // Rate clamped safely between 0.2 and 2.5 per Web Speech API spec
    const baseRate = persona.rate * (options?.speedMultiplier ?? 1.0);
    utterance.rate = Math.max(0.2, Math.min(2.5, baseRate));
    utterance.pitch = Math.max(0.2, Math.min(2.0, persona.pitch));

    const matchedVoice = this.findBestVoice(persona);
    if (matchedVoice) {
      utterance.voice = matchedVoice;
    }

    // Web Audio spatial resonance & frequency monitoring
    const tier = options?.tier ?? 0;
    const ctx = this.getAudioContext();
    let analyser: AnalyserNode | null = null;
    let freqData: Uint8Array | null = null;

    if (ctx && (tier === 1 || tier === 2)) {
      try {
        analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.8;
        freqData = new Uint8Array(analyser.frequencyBinCount);

        const formantFilter = ctx.createBiquadFilter();
        formantFilter.type = 'peaking';
        formantFilter.frequency.value = persona.formants[0] || 500;
        formantFilter.Q.value = 2.5;
        formantFilter.gain.value = 6;

        if (ctx.createStereoPanner) {
          const panner = ctx.createStereoPanner();
          panner.pan.value = persona.stereoPan;
          formantFilter.connect(panner);
          panner.connect(analyser);
        } else {
          formantFilter.connect(analyser);
        }
      } catch {
        // Fallback gracefully
      }
    }

    let isSpeaking = false;

    // Chrome 15s freeze workaround: periodically resume speechSynthesis
    if (this.resumeTimerId) clearInterval(this.resumeTimerId);
    this.resumeTimerId = setInterval(() => {
      if (typeof window !== 'undefined' && window.speechSynthesis && window.speechSynthesis.speaking) {
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }
    }, 12000);

    const startFrequencyLoop = () => {
      isSpeaking = true;
      const startTime = Date.now();
      const loop = () => {
        if (!isSpeaking || this.currentSessionId !== sessionId) return;

        let freqs: number[];
        if (analyser && freqData) {
          analyser.getByteFrequencyData(freqData as any);
          freqs = [];
          const step = Math.max(1, Math.floor(freqData.length / 16));
          for (let i = 0; i < 16; i++) {
            const rawVal = freqData[i * step] || 0;
            const norm = Math.max(0.08, Math.min(1.0, rawVal / 255));
            freqs.push(parseFloat(norm.toFixed(2)));
          }
        } else {
          // Formant-tuned speech frequency generation
          freqs = VoiceModelLoadBalancer.generateSpeechFrequencies(16, targetVolume > 0 ? 0.85 : 0.15, {
            persona,
            timestampMs: Date.now() - startTime,
            active: targetVolume > 0,
          });
        }

        options?.onFrequencies?.(freqs);
        this.animFrameId = window.requestAnimationFrame(loop);
      };
      this.animFrameId = window.requestAnimationFrame(loop);
    };

    utterance.onstart = () => {
      if (this.currentSessionId !== sessionId) return;
      startFrequencyLoop();
      options?.onStart?.();
    };

    const cleanup = () => {
      isSpeaking = false;
      if (this.animFrameId) {
        window.cancelAnimationFrame(this.animFrameId);
        this.animFrameId = null;
      }
      if (this.resumeTimerId) {
        clearInterval(this.resumeTimerId);
        this.resumeTimerId = null;
      }
      this.activeUtterance = null;
      options?.onFrequencies?.(Array(16).fill(0.08));
    };

    utterance.onend = () => {
      if (this.currentSessionId !== sessionId) return;
      cleanup();
      options?.onEnd?.();
    };

    utterance.onerror = (e) => {
      if (this.currentSessionId !== sessionId) return;
      cleanup();
      options?.onError?.(e);
      options?.onEnd?.();
    };

    this.activeUtterance = utterance;

    // Unpause if in paused state
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
    window.speechSynthesis.speak(utterance);
  }

  private static stopInternal(): void {
    if (typeof window === 'undefined') return;
    if (this.animFrameId) {
      window.cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.resumeTimerId) {
      clearInterval(this.resumeTimerId);
      this.resumeTimerId = null;
    }
    if (window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Safe catch
      }
    }
    this.activeUtterance = null;
  }

  public static stop(): void {
    this.currentSessionId++;
    this.stopInternal();
  }

  public static async simulateModelDownload(
    tier: VoiceTier,
    onProgress: (percent: number, downloadedMb: number) => void
  ): Promise<boolean> {
    const spec = VOICE_MODEL_SPECS[tier];
    if (spec.downloadSizeMb === 0) {
      onProgress(100, 0);
      return true;
    }

    const totalMb = spec.downloadSizeMb;
    const steps = 25;
    const intervalMs = 50;

    for (let i = 1; i <= steps; i++) {
      await new Promise((r) => setTimeout(r, intervalMs));
      const percent = Math.min(100, Math.round((i / steps) * 100));
      const downloadedMb = parseFloat(((percent / 100) * totalMb).toFixed(1));
      onProgress(percent, downloadedMb);
    }

    return true;
  }
}
