import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Mic,
  Volume2,
  VolumeX,
  Sparkles,
  Play,
  Pause,
  Square,
  Cpu,
  ShieldCheck,
  AlertTriangle,
  Download,
  CheckCircle2,
  Settings2,
  X,
  Activity,
  Zap,
} from 'lucide-react';
import {
  HuddleSession,
  VoiceTier,
  HardwareProfile,
  VOICE_MODEL_SPECS,
  VoiceModelLoadBalancer,
} from '@acr-js/opsroom-core';
import { BrowserAudioFabric } from '../lib/audio-fabric.js';

interface SyntheticHuddleProps {
  huddle?: HuddleSession;
  onSynthesizeBrief: () => void;
}

export const SyntheticHuddle: React.FC<SyntheticHuddleProps> = ({
  huddle,
  onSynthesizeBrief,
}) => {
  // Hardware Profile and Voice Engine State
  const [hardwareProfile, setHardwareProfile] = useState<HardwareProfile>(() =>
    VoiceModelLoadBalancer.detectHardwareProfile()
  );
  const [activeTier, setActiveTier] = useState<VoiceTier>(() => hardwareProfile.recommendedTier);
  const [downloadedTiers, setDownloadedTiers] = useState<Set<VoiceTier>>(() => new Set([0]));

  // Modals
  const [isEngineModalOpen, setIsEngineModalOpen] = useState(false);
  const [pendingDownloadTier, setPendingDownloadTier] = useState<VoiceTier | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{
    isDownloading: boolean;
    percent: number;
    downloadedMb: number;
    totalMb: number;
  }>({ isDownloading: false, percent: 0, downloadedMb: 0, totalMb: 0 });

  // Playback State
  const [isPlayingAll, setIsPlayingAll] = useState(false);
  const [activeTurnIndex, setActiveTurnIndex] = useState<number | null>(null);
  const [isPlayingBrief, setIsPlayingBrief] = useState(false);
  const [speechSpeed, setSpeechSpeed] = useState<number>(1.0);
  const [isMuted, setIsMuted] = useState(false);
  const [liveFrequencies, setLiveFrequencies] = useState<number[]>(() => Array(16).fill(0.12));

  // Audio session ref for monotonic cancellation & race-free sequencing
  const playbackSessionRef = useRef(0);

  // Accessible Modal Management Refs
  const triggerButtonRef = useRef<HTMLButtonElement>(null);
  const engineModalRef = useRef<HTMLDivElement>(null);
  const downloadModalRef = useRef<HTMLDivElement>(null);
  const lastFocusedElementRef = useRef<HTMLElement | null>(null);
  const lastFocusedTierButtonRef = useRef<HTMLElement | null>(null);

  // Dedicated Body Scroll Lock: clean single entry & exit
  const isAnyModalOpen = isEngineModalOpen || pendingDownloadTier !== null;
  useEffect(() => {
    if (!isAnyModalOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isAnyModalOpen]);

  // Accessible Keyboard Dismissal (Escape in capture phase to prevent bubbling to parent modals)
  useEffect(() => {
    if (!isAnyModalOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        if (pendingDownloadTier !== null) {
          if (!downloadProgress.isDownloading) {
            setPendingDownloadTier(null);
          }
        } else if (isEngineModalOpen) {
          setIsEngineModalOpen(false);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isAnyModalOpen, pendingDownloadTier, isEngineModalOpen, downloadProgress.isDownloading]);

  // Focus management: focus modal on open & restore focus to trigger button on close
  useEffect(() => {
    if (isEngineModalOpen) {
      lastFocusedElementRef.current = document.activeElement as HTMLElement | null;
      const timer = setTimeout(() => {
        const firstFocusable = engineModalRef.current?.querySelector<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        firstFocusable?.focus();
      }, 50);
      return () => {
        clearTimeout(timer);
        lastFocusedElementRef.current?.focus();
      };
    }
  }, [isEngineModalOpen]);

  // Focus management for secondary download modal: restore focus to the tier button that opened it
  useEffect(() => {
    if (pendingDownloadTier !== null) {
      lastFocusedTierButtonRef.current = document.activeElement as HTMLElement | null;
      const timer = setTimeout(() => {
        const firstFocusable = downloadModalRef.current?.querySelector<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        firstFocusable?.focus();
      }, 50);
      return () => {
        clearTimeout(timer);
        lastFocusedTierButtonRef.current?.focus();
      };
    }
  }, [pendingDownloadTier]);

  // Tab key trap inside active modal dialog
  const handleModalTabTrap = (
    e: React.KeyboardEvent<HTMLDivElement>,
    modalRef: React.RefObject<HTMLDivElement | null>
  ) => {
    if (e.key !== 'Tab' || !modalRef.current) return;
    const focusable = modalRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    const firstElement = focusable[0];
    const lastElement = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === firstElement || !modalRef.current.contains(document.activeElement)) {
        lastElement.focus();
        e.preventDefault();
      }
    } else {
      if (document.activeElement === lastElement || !modalRef.current.contains(document.activeElement)) {
        firstElement.focus();
        e.preventDefault();
      }
    }
  };

  // Initialize voices on mount
  useEffect(() => {
    BrowserAudioFabric.initVoices();
    const profile = VoiceModelLoadBalancer.detectHardwareProfile();
    setHardwareProfile(profile);
  }, []);

  // Stop playback when huddle changes or unmounts
  useEffect(() => {
    return () => {
      playbackSessionRef.current++;
      BrowserAudioFabric.stop();
    };
  }, [huddle?.id]);

  // Stop current speech
  const handleStop = useCallback(() => {
    playbackSessionRef.current++;
    BrowserAudioFabric.stop();
    setIsPlayingAll(false);
    setActiveTurnIndex(null);
    setIsPlayingBrief(false);
    setLiveFrequencies(Array(16).fill(0.08));
  }, []);

  // Play a single transcript turn
  const handlePlayTurn = useCallback((index: number) => {
    if (!huddle?.lines[index]) return;
    handleStop();
    const sessionId = ++playbackSessionRef.current;
    setActiveTurnIndex(index);

    const line = huddle.lines[index];
    const persona = VoiceModelLoadBalancer.getAgentVoicePersona(line.role);

    BrowserAudioFabric.speak(line.text, persona, {
      tier: activeTier,
      volume: isMuted ? 0 : 1,
      speedMultiplier: speechSpeed,
      onStart: () => {
        if (playbackSessionRef.current === sessionId) {
          setActiveTurnIndex(index);
        }
      },
      onEnd: () => {
        if (playbackSessionRef.current === sessionId) {
          setActiveTurnIndex(null);
          setLiveFrequencies(Array(16).fill(0.08));
        }
      },
      onError: () => {
        if (playbackSessionRef.current === sessionId) {
          setActiveTurnIndex(null);
          setLiveFrequencies(Array(16).fill(0.08));
        }
      },
      onFrequencies: (freqs) => {
        if (playbackSessionRef.current === sessionId) {
          setLiveFrequencies(freqs);
        }
      },
    });
  }, [huddle, activeTier, speechSpeed, isMuted, handleStop]);

  // Play all turns sequentially with conversational pauses
  const handlePlayAll = useCallback(async () => {
    if (!huddle || huddle.lines.length === 0) return;
    if (isPlayingAll) {
      handleStop();
      return;
    }

    handleStop();
    const sessionId = ++playbackSessionRef.current;
    setIsPlayingAll(true);

    for (let i = 0; i < huddle.lines.length; i++) {
      if (playbackSessionRef.current !== sessionId) break;

      setActiveTurnIndex(i);
      const line = huddle.lines[i];
      const persona = VoiceModelLoadBalancer.getAgentVoicePersona(line.role);

      await new Promise<void>((resolve) => {
        let isResolved = false;
        const complete = () => {
          if (!isResolved) {
            isResolved = true;
            resolve();
          }
        };

        const wordCount = line.text.trim().split(/\s+/).length;
        const maxTurnMs = Math.max(2000, (wordCount / (90 * speechSpeed)) * 60 * 1000) + 2500;
        const turnTimeout = setTimeout(complete, maxTurnMs);

        BrowserAudioFabric.speak(line.text, persona, {
          tier: activeTier,
          volume: isMuted ? 0 : 1,
          speedMultiplier: speechSpeed,
          onStart: () => {
            if (playbackSessionRef.current === sessionId) {
              setActiveTurnIndex(i);
            }
          },
          onEnd: () => {
            clearTimeout(turnTimeout);
            complete();
          },
          onError: () => {
            clearTimeout(turnTimeout);
            complete();
          },
          onFrequencies: (freqs) => {
            if (playbackSessionRef.current === sessionId) {
              setLiveFrequencies(freqs);
            }
          },
        });
      });

      if (playbackSessionRef.current !== sessionId) break;

      // Realistic human inter-turn conversational pause: 380ms - 520ms
      const pauseDuration = i === huddle.lines.length - 1 ? 200 : 420;
      setLiveFrequencies(Array(16).fill(0.08));
      await new Promise((r) => setTimeout(r, pauseDuration));
    }

    if (playbackSessionRef.current === sessionId) {
      setIsPlayingAll(false);
      setActiveTurnIndex(null);
      setLiveFrequencies(Array(16).fill(0.08));
    }
  }, [huddle, isPlayingAll, activeTier, speechSpeed, isMuted, handleStop]);

  // Play Executive Brief with Commander persona
  const handlePlayBrief = useCallback(() => {
    if (!huddle?.executiveBrief) return;
    if (isPlayingBrief) {
      handleStop();
      return;
    }

    handleStop();
    const sessionId = ++playbackSessionRef.current;
    setIsPlayingBrief(true);

    const commanderPersona = VoiceModelLoadBalancer.getAgentVoicePersona('atlas_orchestrator');

    BrowserAudioFabric.speak(huddle.executiveBrief, commanderPersona, {
      tier: activeTier,
      volume: isMuted ? 0 : 1,
      speedMultiplier: speechSpeed,
      onStart: () => {
        if (playbackSessionRef.current === sessionId) {
          setIsPlayingBrief(true);
        }
      },
      onEnd: () => {
        if (playbackSessionRef.current === sessionId) {
          setIsPlayingBrief(false);
          setLiveFrequencies(Array(16).fill(0.08));
        }
      },
      onError: () => {
        if (playbackSessionRef.current === sessionId) {
          setIsPlayingBrief(false);
          setLiveFrequencies(Array(16).fill(0.08));
        }
      },
      onFrequencies: (freqs) => {
        if (playbackSessionRef.current === sessionId) {
          setLiveFrequencies(freqs);
        }
      },
    });
  }, [huddle?.executiveBrief, isPlayingBrief, activeTier, speechSpeed, isMuted, handleStop]);

  // Model download request initiated by user
  const requestTierSelection = (tier: VoiceTier) => {
    if (tier === 0) {
      setActiveTier(0);
      return;
    }
    if (downloadedTiers.has(tier)) {
      setActiveTier(tier);
      return;
    }
    // Require explicit confirmation before downloading
    setPendingDownloadTier(tier);
  };

  // User explicitly confirms local model download
  const handleConfirmDownload = async () => {
    if (pendingDownloadTier === null) return;
    const tier = pendingDownloadTier;
    const spec = VOICE_MODEL_SPECS[tier];

    setDownloadProgress({
      isDownloading: true,
      percent: 0,
      downloadedMb: 0,
      totalMb: spec.downloadSizeMb,
    });

    await BrowserAudioFabric.simulateModelDownload(tier, (percent, downloadedMb) => {
      setDownloadProgress({
        isDownloading: true,
        percent,
        downloadedMb,
        totalMb: spec.downloadSizeMb,
      });
    });

    setDownloadedTiers((prev) => new Set([...prev, tier]));
    setActiveTier(tier);
    setDownloadProgress({ isDownloading: false, percent: 100, downloadedMb: spec.downloadSizeMb, totalMb: spec.downloadSizeMb });
    setPendingDownloadTier(null);
  };

  const activeSpec = VOICE_MODEL_SPECS[activeTier];
  const activeLine = activeTurnIndex !== null && huddle?.lines ? huddle.lines[activeTurnIndex] : null;
  const activeSpeakerPersona = activeLine ? VoiceModelLoadBalancer.getAgentVoicePersona(lineRole(activeLine.role)) : null;

  function lineRole(role: any): any {
    return role || 'atlas_orchestrator';
  }

  return (
    <section
      aria-labelledby="huddle-heading"
      className="p-5 sm:p-6 rounded-3xl bg-slate-900/85 border border-white/[0.08] backdrop-blur-2xl shadow-2xl mb-8 relative overflow-hidden ring-1 ring-white/[0.05]"
    >
      {/* Ambient background glow */}
      <div className="absolute top-0 left-1/4 w-96 h-32 bg-purple-600/10 blur-[90px] pointer-events-none" />
      <div className="absolute -bottom-10 right-10 w-72 h-32 bg-cyan-600/10 blur-[80px] pointer-events-none" />

      {/* Top Header Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between pb-4 mb-5 border-b border-white/[0.08] gap-3 relative z-10">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-purple-500/20 to-indigo-500/20 border border-purple-500/30 flex items-center justify-center text-purple-300 shadow-[0_0_15px_rgba(168,85,247,0.2)]">
              <Mic className="w-4 h-4" aria-hidden="true" />
            </div>
            <h2 id="huddle-heading" className="text-base sm:text-lg font-bold text-white tracking-tight">
              Synthetic Multi-Agent Huddle Room
            </h2>
            <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-purple-950/60 border border-purple-500/30 text-purple-300 font-mono flex items-center gap-1.5 shadow-[0_0_12px_rgba(168,85,247,0.2)]">
              <Activity className="w-2.5 h-2.5 text-purple-400 animate-pulse" />
              Live Audio Fabric
            </span>

            {/* Hardware-Aware Voice Tier Chip */}
            <button
              ref={triggerButtonRef}
              onClick={() => setIsEngineModalOpen(true)}
              title="Click to configure Dynamic Hardware Load-Balancer & Local Models"
              aria-haspopup="dialog"
              aria-expanded={isEngineModalOpen}
              className="group text-[11px] px-2.5 py-1 rounded-full bg-slate-950/80 border border-cyan-500/30 text-cyan-300 hover:border-cyan-400 font-mono flex items-center gap-1.5 transition-all cursor-pointer hover:shadow-[0_0_12px_rgba(6,182,212,0.25)] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              <Cpu className="w-3 h-3 text-cyan-400 group-hover:rotate-45 transition-transform" />
              <span>Tier {activeTier}: {activeSpec.name.split(' ')[0]}</span>
              <span className="text-slate-500">|</span>
              <span className="text-emerald-400">{hardwareProfile.readinessScore} Score</span>
              <Settings2 className="w-3 h-3 text-cyan-400 opacity-70 group-hover:opacity-100" />
            </button>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Beyond Slack AI Huddle notes: Autonomous agents debate hypotheses in real time with distinct vocal personas and live acoustic synthesis.
          </p>
        </div>

        {/* Global Controls & Synthesize Button */}
        <div className="flex flex-wrap items-center gap-2 self-start lg:self-auto">
          {/* Deliberation Audio Playback Button */}
          <button
            onClick={handlePlayAll}
            disabled={!huddle || huddle.lines.length === 0}
            className={`px-3.5 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-40 active:scale-95 shadow-sm ${
              isPlayingAll
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.25)]'
                : 'bg-purple-600/20 text-purple-200 border-purple-500/30 hover:bg-purple-600/30 hover:border-purple-400'
            }`}
          >
            {isPlayingAll ? (
              <>
                <Pause className="w-3.5 h-3.5" />
                <span>Pause Deliberation</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Listen to Deliberation</span>
              </>
            )}
          </button>

          {/* Stop / Reset Audio */}
          {(isPlayingAll || activeTurnIndex !== null || isPlayingBrief) && (
            <button
              onClick={handleStop}
              className="p-1.5 rounded-xl bg-slate-950 border border-white/10 text-slate-400 hover:text-rose-400 hover:border-rose-500/30 transition-all cursor-pointer"
              title="Stop audio playback"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Speed Selector */}
          <div className="flex items-center rounded-xl bg-slate-950/80 border border-white/10 p-0.5 text-[10px] font-mono">
            {[1.0, 1.25, 1.5].map((speed) => (
              <button
                key={speed}
                onClick={() => setSpeechSpeed(speed)}
                className={`px-2 py-1 rounded-lg transition-all ${
                  speechSpeed === speed
                    ? 'bg-purple-500/30 text-purple-200 font-bold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {speed}x
              </button>
            ))}
          </div>

          {/* Mute Button */}
          <button
            onClick={() => setIsMuted(!isMuted)}
            className={`p-1.5 rounded-xl border transition-all cursor-pointer ${
              isMuted
                ? 'bg-rose-500/20 border-rose-500/40 text-rose-400'
                : 'bg-slate-950 border-white/10 text-slate-400 hover:text-white'
            }`}
            title={isMuted ? 'Unmute voice' : 'Mute voice'}
          >
            {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>

          {/* Synthesize Executive Brief */}
          <button
            onClick={onSynthesizeBrief}
            disabled={!huddle || huddle.lines.length === 0}
            className="px-3.5 py-1.5 rounded-xl border border-purple-500/30 bg-purple-950/40 hover:bg-purple-900/50 text-xs font-semibold text-purple-200 flex items-center gap-1.5 transition-all disabled:opacity-50 cursor-pointer active:scale-98 shadow-sm"
          >
            <Sparkles className="w-3.5 h-3.5 text-purple-400" aria-hidden="true" />
            Synthesize Brief
          </button>
        </div>
      </div>

      {/* Live Speaking Indicator Banner */}
      {activeLine && activeSpeakerPersona && (
        <div className="mb-4 px-4 py-2.5 rounded-2xl bg-purple-950/30 border border-purple-500/30 flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-purple-500"></span>
            </span>
            <span className="text-white font-bold">{activeLine.speakerName}</span>
            <span className="text-[11px] text-purple-300 font-mono">
              ({activeSpeakerPersona.timbreProfile} • {activeSpeakerPersona.pitch} pitch • {activeSpeakerPersona.rate}x rate • {
                activeSpeakerPersona.stereoPan === 0 ? 'Center Stage' : activeSpeakerPersona.stereoPan < 0 ? `${Math.abs(Math.round(activeSpeakerPersona.stereoPan * 100))}% Left` : `${Math.round(activeSpeakerPersona.stereoPan * 100)}% Right`
              })
            </span>
          </div>

          {/* Real-Time Equalizer Waveform */}
          <div className="flex items-end gap-0.5 h-4 px-2" aria-label="Audio waveform visualizer">
            {liveFrequencies.map((val, idx) => (
              <span
                key={idx}
                className="w-1 bg-gradient-to-t from-purple-500 to-cyan-400 rounded-t transition-all duration-75"
                style={{ height: `${Math.max(15, val * 100)}%` }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Main Grid: Deliberation Transcript vs Executive Brief */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        
        {/* Transcript Conversation (2 Cols) */}
        <div className="lg:col-span-2 space-y-3 max-h-[260px] overflow-y-auto pr-1">
          {!huddle || huddle.lines.length === 0 ? (
            <div className="text-center py-12 rounded-2xl border border-dashed border-white/10 bg-white/[0.01] text-xs text-slate-500 flex flex-col items-center justify-center gap-2">
              <Mic className="w-6 h-6 text-slate-600 animate-pulse" />
              <span>Huddle room in standby. Begins automatically upon incident detection.</span>
            </div>
          ) : (
            huddle.lines.map((line, idx) => {
              const isCurrentlySpeaking = activeTurnIndex === idx;
              const persona = VoiceModelLoadBalancer.getAgentVoicePersona(lineRole(line.role));

              return (
                <div
                  key={idx}
                  className={`p-3.5 rounded-2xl border transition-all text-xs relative ${
                    isCurrentlySpeaking
                      ? 'bg-purple-950/40 border-purple-500/60 shadow-[0_0_20px_rgba(168,85,247,0.2)] ring-1 ring-purple-400/40'
                      : 'bg-slate-950/60 border-white/[0.06] hover:border-white/15'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      {/* Avatar initial */}
                      <div
                        className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 text-xs font-bold transition-all ${
                          isCurrentlySpeaking
                            ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/30'
                            : 'bg-purple-950/60 border border-purple-500/30 text-purple-300'
                        }`}
                      >
                        {line.speakerName.charAt(0)}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white">{line.speakerName}</span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-white/5 border border-white/10 text-slate-400 font-mono">
                              {persona.timbreProfile}
                            </span>
                          </div>

                          {/* Quick individual line voice play button */}
                          <button
                            onClick={() => handlePlayTurn(idx)}
                            className={`px-2 py-0.5 rounded-lg border text-[10px] font-mono flex items-center gap-1 transition-all cursor-pointer ${
                              isCurrentlySpeaking
                                ? 'bg-purple-500/30 text-purple-200 border-purple-400'
                                : 'bg-white/5 text-slate-400 border-white/10 hover:text-white hover:border-white/20'
                            }`}
                            title={`Listen to ${line.speakerName}`}
                          >
                            <Play className="w-2.5 h-2.5 fill-current" />
                            <span>{isCurrentlySpeaking ? 'Speaking' : 'Play Voice'}</span>
                          </button>
                        </div>

                        <p className="text-slate-300 leading-relaxed">{line.text}</p>
                      </div>
                    </div>

                    {/* Equalizer Bars on Card */}
                    <div className="flex items-end gap-0.5 h-3 shrink-0 self-center" aria-hidden="true">
                      {isCurrentlySpeaking
                        ? liveFrequencies.slice(0, 8).map((val, bIdx) => (
                            <span
                              key={bIdx}
                              className="w-1 bg-purple-400 rounded-t"
                              style={{ height: `${Math.max(20, val * 100)}%` }}
                            />
                          ))
                        : line.audioFrequencyData?.slice(0, 8).map((val, bIdx) => (
                            <span
                              key={bIdx}
                              className="w-1 bg-purple-400/40 rounded-t"
                              style={{ height: `${Math.max(20, val * 100)}%` }}
                            />
                          ))}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Executive Brief Box (1 Col) */}
        <div className="p-4 sm:p-5 rounded-2xl bg-purple-950/20 border border-purple-500/20 flex flex-col justify-between relative overflow-hidden">
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-purple-300 flex items-center gap-1.5">
                <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
                Board-Level Executive Brief
              </h3>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed mb-4">
              {huddle?.executiveBrief ||
                'Awaiting huddle synthesis. Spoken audio notes and action items will sync directly into the Ops Canvas.'}
            </p>

            {/* Listen to Executive Brief Audio Button */}
            {huddle?.executiveBrief && (
              <button
                onClick={handlePlayBrief}
                className={`w-full py-2 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-98 ${
                  isPlayingBrief
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    : 'bg-purple-600/20 hover:bg-purple-600/30 text-purple-200 border-purple-500/40 shadow-sm'
                }`}
              >
                {isPlayingBrief ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                <span>{isPlayingBrief ? 'Pause Executive Audio' : 'Listen to Executive Brief'}</span>
              </button>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-purple-500/20 text-[10px] text-purple-400 flex items-center justify-between font-mono">
            <span className="flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              Automated Canvas Sync
            </span>
            <span className="flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-cyan-400" />
              Ed25519 Verified
            </span>
          </div>
        </div>
      </div>

      {/* MODAL 1: Dynamic Hardware Profiler & Voice Model Load Balancer */}
      {isEngineModalOpen && typeof document !== 'undefined' && createPortal(
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setIsEngineModalOpen(false);
            }
          }}
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-md overflow-hidden animate-fadeIn"
          aria-hidden={pendingDownloadTier !== null ? 'true' : undefined}
        >
          <div
            ref={engineModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="engine-modal-title"
            aria-describedby="engine-modal-description"
            tabIndex={-1}
            onKeyDown={(e) => handleModalTabTrap(e, engineModalRef)}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl max-h-[85vh] sm:max-h-[90vh] flex flex-col bg-slate-950/95 border border-white/10 rounded-3xl shadow-[0_0_50px_rgba(0,0,0,0.8),0_0_30px_rgba(6,182,212,0.15)] relative text-slate-200 ring-1 ring-white/10 overflow-hidden my-auto"
          >
            {/* Pinned Header */}
            <div className="flex items-center justify-between p-6 pb-4 border-b border-white/10 shrink-0 bg-slate-950/95">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.2)]">
                  <Cpu className="w-4 h-4" aria-hidden="true" />
                </div>
                <div>
                  <h2 id="engine-modal-title" className="text-base sm:text-lg font-bold text-white tracking-tight">
                    Hardware-Aware Voice Model & Load Balancer Engine
                  </h2>
                  <p id="engine-modal-description" className="text-xs text-slate-400">
                    Dynamic client-side hardware forecasting & on-device neural voice selection.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsEngineModalOpen(false)}
                className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white border border-white/10 transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                aria-label="Close settings"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            {/* Scrollable Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              {/* Hardware Diagnostic Banner */}
              <div className="p-4 rounded-2xl bg-slate-900/90 border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white">Detected Hardware Profile:</span>
                    <span className="px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 font-mono text-[10px]">
                      {hardwareProfile.detectedSpecsSummary}
                    </span>
                  </div>
                  <p className="text-slate-400 text-[11px]">
                    WebGPU: {hardwareProfile.hasWebGPU ? '✅ Supported' : '❌ Unavailable'} • AudioContext: {hardwareProfile.hasAudioContext ? '✅' : '❌'} • SpeechSynthesis: {hardwareProfile.hasSpeechSynthesis ? '✅' : '❌'}
                  </p>
                </div>

                <div className="text-right shrink-0">
                  <div className="text-[10px] uppercase font-mono text-slate-400">Readiness Score</div>
                  <div className="text-lg font-extrabold text-emerald-400 font-mono">
                    {hardwareProfile.readinessScore}/100
                  </div>
                </div>
              </div>

              {/* Tier Selection Cards */}
              <div className="space-y-3">
                {[0, 1, 2].map((tierNum) => {
                  const t = tierNum as VoiceTier;
                  const spec = VOICE_MODEL_SPECS[t];
                  const isSelected = activeTier === t;
                  const isRecommended = hardwareProfile.recommendedTier === t;
                  const isDownloaded = downloadedTiers.has(t);
                  const safety = VoiceModelLoadBalancer.evaluateTierSafety(t, hardwareProfile);

                  return (
                    <div
                      key={t}
                      onClick={() => requestTierSelection(t)}
                      className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-cyan-950/30 border-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.15)] ring-1 ring-cyan-500/30'
                          : 'bg-slate-900/60 border-white/10 hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-white">Tier {t}: {spec.name}</span>
                            {isRecommended && (
                              <span className="px-2 py-0.5 text-[9px] font-mono uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full flex items-center gap-1">
                                <Zap className="w-2.5 h-2.5" /> Recommended by Balancer
                              </span>
                            )}
                            {isSelected && (
                              <span className="px-2 py-0.5 text-[9px] font-mono uppercase bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 rounded-full">
                                Active
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400">{spec.description}</p>
                        </div>

                        <div className="text-right shrink-0 text-xs font-mono">
                          <div className="text-white font-bold">
                            {spec.downloadSizeMb === 0 ? '0 MB Download' : `${spec.downloadSizeMb} MB`}
                          </div>
                          <div className="text-[10px] text-slate-400">~{spec.latencyEstimateMs}ms latency</div>
                        </div>
                      </div>

                      {/* Safety warnings if user overrides */}
                      {!safety.isSafe && (
                        <div className="mt-3 p-2.5 rounded-xl bg-amber-950/30 border border-amber-500/30 text-amber-300 text-[11px] flex items-start gap-2">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
                          <div>
                            {safety.warnings.map((w, wIdx) => (
                              <div key={wIdx}>{w}</div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Action button inside card */}
                      <div className="mt-3 pt-2.5 border-t border-white/[0.06] flex items-center justify-between text-xs">
                        <span className="text-[11px] text-slate-400 font-mono">
                          Backend: {spec.computeBackend}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            requestTierSelection(t);
                          }}
                          className={`px-3 py-1.5 rounded-xl font-semibold text-xs transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 active:scale-98 ${
                            isSelected
                              ? 'bg-cyan-500 text-slate-950 font-bold shadow-md shadow-cyan-500/25'
                              : isDownloaded
                              ? 'bg-white/10 hover:bg-white/20 text-white'
                              : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-md shadow-purple-500/20'
                          }`}
                        >
                          {isSelected ? 'Active' : isDownloaded ? 'Select' : `Confirm & Download (${spec.downloadSizeMb}MB)`}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Pinned Footer */}
            <div className="flex items-center justify-between p-6 pt-3 border-t border-white/10 shrink-0 bg-slate-950/95">
              <span className="text-[11px] text-slate-500 font-mono hidden sm:inline">
                WebGPU / SIMD Neural Voice Fabric
              </span>
              <button
                onClick={() => setIsEngineModalOpen(false)}
                className="px-5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white transition-all cursor-pointer border border-white/10 hover:border-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 active:scale-98 ml-auto sm:ml-0"
              >
                Close Settings
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL 2: Explicit User Confirmation & Model Download Modal */}
      {pendingDownloadTier !== null && typeof document !== 'undefined' && createPortal(
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget && !downloadProgress.isDownloading) {
              setPendingDownloadTier(null);
            }
          }}
          className="fixed inset-0 z-[80] flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-md overflow-hidden animate-fadeIn"
        >
          <div
            ref={downloadModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-download-title"
            aria-describedby="confirm-download-description"
            tabIndex={-1}
            onKeyDown={(e) => handleModalTabTrap(e, downloadModalRef)}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg max-h-[85vh] sm:max-h-[90vh] flex flex-col bg-slate-950/95 border border-white/15 rounded-3xl shadow-[0_0_60px_rgba(0,0,0,0.85),0_0_30px_rgba(6,182,212,0.2)] relative text-slate-200 ring-1 ring-cyan-500/30 overflow-hidden my-auto"
          >
            {/* Pinned Header */}
            <div className="flex items-center justify-between p-6 pb-4 border-b border-white/10 shrink-0 bg-slate-950/95">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.2)]">
                  <Download className="w-5 h-5 animate-bounce" aria-hidden="true" />
                </div>
                <div>
                  <h2 id="confirm-download-title" className="text-base sm:text-lg font-bold text-white tracking-tight">
                    Explicit Local Model Download Confirmation
                  </h2>
                  <p id="confirm-download-description" className="text-xs text-slate-400">
                    User consent required before transferring weights.
                  </p>
                </div>
              </div>
              <button
                disabled={downloadProgress.isDownloading}
                onClick={() => setPendingDownloadTier(null)}
                className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white border border-white/10 transition-all disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                aria-label="Close dialog"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            {/* Scrollable Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4 text-xs">
              <p className="text-slate-300 leading-relaxed">
                You are requesting to download and initialize the on-device neural voice model:
              </p>

              {/* Model Spec Table */}
              <div className="p-3.5 rounded-2xl bg-slate-900 border border-white/10 font-mono text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-slate-400">Model:</span>
                  <span className="text-cyan-300 font-bold">{VOICE_MODEL_SPECS[pendingDownloadTier].name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Download Payload:</span>
                  <span className="text-white font-bold">{VOICE_MODEL_SPECS[pendingDownloadTier].downloadSizeMb} MB</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">RAM / VRAM Overhead:</span>
                  <span className="text-amber-300">~{VOICE_MODEL_SPECS[pendingDownloadTier].ramOverheadMb} MB</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Compute Target:</span>
                  <span className="text-white">{VOICE_MODEL_SPECS[pendingDownloadTier].computeBackend}</span>
                </div>
              </div>

              {/* Dynamic Warning if hardware constraints are exceeded */}
              {pendingDownloadTier === 2 && !hardwareProfile.hasWebGPU && (
                <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/40 text-rose-300 text-[11px] flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                  <div>
                    <strong>Critical Performance Warning:</strong> WebGPU is not supported by your browser or GPU. Running 82M parameters via CPU WASM may freeze the interface or cause heavy audio stuttering.
                  </div>
                </div>
              )}

              {downloadProgress.isDownloading && (
                <div className="space-y-2 pt-2">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-cyan-300">Downloading ONNX Tensors...</span>
                    <span className="text-white">{downloadProgress.percent}% ({downloadProgress.downloadedMb}MB / {downloadProgress.totalMb}MB)</span>
                  </div>
                  <div className="w-full h-2.5 bg-slate-900 rounded-full overflow-hidden border border-white/10">
                    <div
                      className="h-full bg-gradient-to-r from-cyan-500 to-purple-600 transition-all duration-150"
                      style={{ width: `${downloadProgress.percent}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Pinned Footer */}
            <div className="flex items-center justify-end gap-3 p-6 pt-3 border-t border-white/10 shrink-0 bg-slate-950/95">
              <button
                disabled={downloadProgress.isDownloading}
                onClick={() => setPendingDownloadTier(null)}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-white transition-colors disabled:opacity-50 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              >
                Cancel / Keep Universal Native
              </button>

              <button
                disabled={downloadProgress.isDownloading}
                onClick={handleConfirmDownload}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 text-xs font-bold text-white shadow-lg shadow-purple-500/20 transition-all flex items-center gap-2 disabled:opacity-50 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 active:scale-98"
              >
                {downloadProgress.isDownloading ? (
                  <>
                    <Activity className="w-3.5 h-3.5 animate-spin" />
                    <span>Downloading Model...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Confirm & Download Locally</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </section>
  );
};
