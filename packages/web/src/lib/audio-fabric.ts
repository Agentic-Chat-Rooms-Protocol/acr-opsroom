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
  private static activeOscNode: OscillatorNode | null = null;
  private static activeGainNode: GainNode | null = null;
  private static activeSafetyTimerId: any = null;

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

    // Web Audio spatial resonance & live acoustic carrier pipeline
    const tier = options?.tier ?? 0;
    const ctx = this.getAudioContext();
    let analyser: AnalyserNode | null = null;
    let freqData: Uint8Array | null = null;
    let oscNode: OscillatorNode | null = null;
    let gainNode: GainNode | null = null;

    if (ctx && targetVolume > 0) {
      try {
        analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.8;
        freqData = new Uint8Array(analyser.frequencyBinCount);

        // Acoustic carrier for spatial presence & formant reinforcement
        const baseFreq = (persona.preferredGender === 'female' ? 210 : 130) * persona.pitch;
        oscNode = ctx.createOscillator();
        oscNode.type = tier === 2 ? 'triangle' : 'sine';
        oscNode.frequency.setValueAtTime(baseFreq, ctx.currentTime);

        const formantFilter = ctx.createBiquadFilter();
        formantFilter.type = 'bandpass';
        formantFilter.frequency.setValueAtTime(persona.formants[0] || 500, ctx.currentTime);
        formantFilter.Q.setValueAtTime(2.5, ctx.currentTime);

        const formantFilter2 = ctx.createBiquadFilter();
        formantFilter2.type = 'peaking';
        formantFilter2.frequency.setValueAtTime(persona.formants[1] || 1500, ctx.currentTime);
        formantFilter2.Q.setValueAtTime(1.8, ctx.currentTime);
        formantFilter2.gain.setValueAtTime(3.5, ctx.currentTime);

        let spatialNode: AudioNode = formantFilter2;
        if (ctx.createStereoPanner) {
          const panner = ctx.createStereoPanner();
          panner.pan.setValueAtTime(persona.stereoPan, ctx.currentTime);
          formantFilter2.connect(panner);
          spatialNode = panner;
        }

        gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(0.0001, ctx.currentTime);

        oscNode.connect(formantFilter);
        formantFilter.connect(formantFilter2);
        spatialNode.connect(analyser);
        analyser.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscNode.start();
        this.activeOscNode = oscNode;
        this.activeGainNode = gainNode;
      } catch {
        // Fallback gracefully if Web Audio is restricted
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

    const cleanup = () => {
      isSpeaking = false;
      if (this.activeSafetyTimerId) {
        clearTimeout(this.activeSafetyTimerId);
        this.activeSafetyTimerId = null;
      }
      if (oscNode && ctx) {
        try {
          if (gainNode) {
            gainNode.gain.setValueAtTime(gainNode.gain.value, ctx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.04);
          }
          oscNode.stop(ctx.currentTime + 0.05);
        } catch {
          // Safe ignore on audio node stop
        }
        if (this.activeOscNode === oscNode) this.activeOscNode = null;
        if (this.activeGainNode === gainNode) this.activeGainNode = null;
        oscNode = null;
        gainNode = null;
      }
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

    const startFrequencyLoop = () => {
      isSpeaking = true;
      const startTime = Date.now();
      const loop = () => {
        if (!isSpeaking || this.currentSessionId !== sessionId) return;

        const formantFreqs = VoiceModelLoadBalancer.generateSpeechFrequencies(16, targetVolume > 0 ? 0.85 : 0.15, {
          persona,
          timestampMs: Date.now() - startTime,
          active: isSpeaking && targetVolume > 0,
        });

        let freqs: number[];
        if (analyser && freqData) {
          analyser.getByteFrequencyData(freqData as any);
          let sum = 0;
          for (let i = 0; i < freqData.length; i++) sum += freqData[i];
          const energyFactor = Math.min(1.4, Math.max(0.6, (sum / 64) * 0.8 + 0.5));
          freqs = formantFreqs.map((f) => parseFloat(Math.max(0.08, Math.min(1.0, f * energyFactor)).toFixed(2)));
        } else {
          freqs = formantFreqs;
        }

        options?.onFrequencies?.(freqs);
        this.animFrameId = window.requestAnimationFrame(loop);
      };
      this.animFrameId = window.requestAnimationFrame(loop);
    };

    // Calculate word-based safety duration so playback NEVER hangs if speech synthesis fails to fire onend
    const wordCount = text.trim().split(/\s+/).length;
    const estimatedDurationMs = Math.max(1500, (wordCount / (100 * baseRate)) * 60 * 1000) + 2500;
    this.activeSafetyTimerId = setTimeout(() => {
      if (this.currentSessionId === sessionId) {
        cleanup();
        options?.onEnd?.();
      }
    }, estimatedDurationMs);

    utterance.onstart = () => {
      if (this.currentSessionId !== sessionId) return;
      if (gainNode && ctx && targetVolume > 0) {
        const acousticVolume = tier > 0 ? 0.04 : 0.02;
        gainNode.gain.setValueAtTime(0.0001, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0001, acousticVolume), ctx.currentTime + 0.05);
      }
      startFrequencyLoop();
      options?.onStart?.();
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
    if (this.activeSafetyTimerId) {
      clearTimeout(this.activeSafetyTimerId);
      this.activeSafetyTimerId = null;
    }
    if (this.activeOscNode && this.audioCtx) {
      try {
        if (this.activeGainNode) {
          this.activeGainNode.gain.setValueAtTime(this.activeGainNode.gain.value, this.audioCtx.currentTime);
          this.activeGainNode.gain.exponentialRampToValueAtTime(0.0001, this.audioCtx.currentTime + 0.04);
        }
        this.activeOscNode.stop(this.audioCtx.currentTime + 0.05);
      } catch {
        // Safe catch
      }
      this.activeOscNode = null;
      this.activeGainNode = null;
    }
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
