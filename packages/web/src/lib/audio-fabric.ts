/**
 * Browser Audio Fabric for acr-opsroom web
 */
import { VoiceModelLoadBalancer, VoicePersona, VoiceTier, VOICE_MODEL_SPECS } from '@acr-js/opsroom-core';

export class BrowserAudioFabric {
  private static activeUtterance: SpeechSynthesisUtterance | null = null;
  private static animFrameId: number | null = null;
  private static cachedVoices: SpeechSynthesisVoice[] = [];

  public static initVoices(): void {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    this.cachedVoices = window.speechSynthesis.getVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = () => {
        this.cachedVoices = window.speechSynthesis.getVoices();
      };
    }
  }

  private static findBestVoice(persona: VoicePersona): SpeechSynthesisVoice | null {
    if (this.cachedVoices.length === 0) {
      this.cachedVoices = window.speechSynthesis.getVoices();
    }
    const englishVoices = this.cachedVoices.filter(v => v.lang.startsWith('en'));
    if (englishVoices.length === 0) return this.cachedVoices[0] || null;

    if (persona.preferredGender === 'female') {
      const femaleVoice = englishVoices.find(v =>
        /female|zira|samantha|victoria|karen|jenny|fiona|susan/i.test(v.name)
      );
      if (femaleVoice) return femaleVoice;
    } else {
      const maleVoice = englishVoices.find(v =>
        /male|david|mark|george|daniel|alex|fred|guy/i.test(v.name)
      );
      if (maleVoice) return maleVoice;
    }

    return englishVoices[0] || null;
  }

  public static speak(
    text: string,
    persona: VoicePersona,
    options?: {
      tier?: VoiceTier;
      onStart?: () => void;
      onEnd?: () => void;
      onError?: (err: any) => void;
      onFrequencies?: (freqs: number[]) => void;
    }
  ): void {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      options?.onEnd?.();
      return;
    }

    this.stop();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.pitch = persona.pitch;
    utterance.rate = persona.rate;

    const matchedVoice = this.findBestVoice(persona);
    if (matchedVoice) {
      utterance.voice = matchedVoice;
    }

    let isSpeaking = false;

    const startFrequencyLoop = () => {
      isSpeaking = true;
      const loop = () => {
        if (!isSpeaking) return;
        const freqs = VoiceModelLoadBalancer.generateSpeechFrequencies(16, 0.85);
        options?.onFrequencies?.(freqs);
        this.animFrameId = window.requestAnimationFrame(loop);
      };
      this.animFrameId = window.requestAnimationFrame(loop);
    };

    utterance.onstart = () => {
      startFrequencyLoop();
      options?.onStart?.();
    };

    utterance.onend = () => {
      isSpeaking = false;
      if (this.animFrameId) {
        window.cancelAnimationFrame(this.animFrameId);
        this.animFrameId = null;
      }
      this.activeUtterance = null;
      options?.onFrequencies?.(Array(16).fill(0.1));
      options?.onEnd?.();
    };

    utterance.onerror = (e) => {
      isSpeaking = false;
      if (this.animFrameId) {
        window.cancelAnimationFrame(this.animFrameId);
        this.animFrameId = null;
      }
      this.activeUtterance = null;
      options?.onError?.(e);
      options?.onEnd?.();
    };

    this.activeUtterance = utterance;
    window.speechSynthesis.speak(utterance);
  }

  public static stop(): void {
    if (typeof window === 'undefined') return;
    if (this.animFrameId) {
      window.cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    this.activeUtterance = null;
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
    const steps = 20;
    const intervalMs = 65;

    for (let i = 1; i <= steps; i++) {
      await new Promise(r => setTimeout(r, intervalMs));
      const percent = Math.min(100, Math.round((i / steps) * 100));
      const downloadedMb = parseFloat(((percent / 100) * totalMb).toFixed(1));
      onProgress(percent, downloadedMb);
    }

    return true;
  }
}
