import React, { useState } from 'react';
import { AlertTriangle, Play, RefreshCw, Flame } from 'lucide-react';
import { INCIDENT_PRESETS, IncidentPreset } from '../lib/mock-data.js';

interface IncidentCommanderProps {
  selectedPreset: IncidentPreset;
  onSelectPreset: (preset: IncidentPreset) => void;
  onTriggerIncident: (customTitle?: string, customDesc?: string) => void;
  isRunning: boolean;
  onReset: () => void;
}

export const IncidentCommander: React.FC<IncidentCommanderProps> = ({
  selectedPreset,
  onSelectPreset,
  onTriggerIncident,
  isRunning,
  onReset,
}) => {
  const [customPrompt, setCustomPrompt] = useState('');
  const [isCustomMode, setIsCustomMode] = useState(false);

  const handleTrigger = () => {
    if (isCustomMode && customPrompt.trim()) {
      onTriggerIncident(customPrompt.trim(), 'Custom user-triggered operational emergency');
    } else {
      onTriggerIncident();
    }
  };

  return (
    <section 
      aria-labelledby="commander-heading"
      className="p-5 rounded-2xl bg-slate-900/80 border border-white/10 backdrop-blur-xl mb-8"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
        <div>
          <h2 id="commander-heading" className="text-lg font-bold text-white flex items-center gap-2">
            <Flame className="w-5 h-5 text-amber-400" aria-hidden="true" />
            Operational Incident Commander
          </h2>
          <p className="text-xs text-slate-400">
            Select a mission-critical failure scenario or simulate custom telemetry spikes.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsCustomMode(!isCustomMode)}
            className="touch-target px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-300 transition-all"
          >
            {isCustomMode ? 'Use Presets' : 'Custom Prompt'}
          </button>

          <button
            onClick={onReset}
            disabled={isRunning}
            aria-label="Reset war room state"
            className="touch-target px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-300 transition-all disabled:opacity-50 flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            Reset
          </button>
        </div>
      </div>

      {/* Preset Buttons or Custom Input */}
      {!isCustomMode ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5" role="radiogroup" aria-label="Incident Presets">
          {INCIDENT_PRESETS.map((preset) => {
            const isSelected = selectedPreset.id === preset.id;
            return (
              <button
                key={preset.id}
                role="radio"
                aria-checked={isSelected}
                onClick={() => onSelectPreset(preset)}
                className={`text-left p-3.5 rounded-xl border transition-all ${
                  isSelected
                    ? 'border-[#00f0ff] bg-[#00f0ff]/10 shadow-md shadow-[#00f0ff]/10'
                    : 'border-white/10 bg-slate-950/50 hover:border-white/20'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-black tracking-wider ${
                    preset.severity === 'P0' ? 'bg-red-500/20 text-red-400 border border-red-500/40' :
                    preset.severity === 'P1' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40' :
                    'bg-blue-500/20 text-blue-400 border border-blue-500/40'
                  }`}>
                    {preset.severity} INCIDENT
                  </span>
                  <span className="text-[11px] text-slate-400 font-medium">{preset.category}</span>
                </div>
                <h3 className="text-sm font-bold text-white line-clamp-1 mb-1">{preset.title}</h3>
                <p className="text-xs text-slate-400 line-clamp-2">{preset.description}</p>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="mb-5">
          <label htmlFor="custom-incident-prompt" className="block text-xs font-semibold text-slate-300 mb-1.5">
            Describe Production Outage or Telemetry Spike:
          </label>
          <input
            id="custom-incident-prompt"
            type="text"
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            placeholder="e.g., Stripe webhook timeouts in EU region causing invoice queue backlog"
            className="w-full px-4 py-2.5 rounded-xl bg-slate-950 border border-white/15 text-sm text-white placeholder-slate-500 focus:border-[#00f0ff] focus:outline-none focus:ring-1 focus:ring-[#00f0ff]"
          />
        </div>
      )}

      {/* Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pt-3 border-t border-white/10 gap-3">
        <div className="flex items-center gap-3 text-xs text-slate-300">
          <span className="font-semibold text-slate-400">Target Squad:</span>
          <span className="px-2.5 py-1 rounded-md bg-white/5 border border-white/10 text-white font-mono">
            {selectedPreset.category === 'SecOps & Zero-Trust' ? 'SecOps Sentinel Squad (5 Agents)' : 'SRE Reliability Squad (5 Agents)'}
          </span>
          <span className="hidden sm:inline text-slate-500">|</span>
          <span className="hidden sm:inline text-emerald-400 font-medium">BFT Quorum Required: 67%</span>
        </div>

        <button
          onClick={handleTrigger}
          disabled={isRunning}
          className="touch-target px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#00f0ff] to-[#0284c7] text-black font-extrabold text-xs uppercase tracking-wider hover:opacity-95 shadow-md shadow-[#00f0ff]/20 disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
        >
          {isRunning ? (
            <>
              <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              Deliberating Quorum...
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 fill-black" aria-hidden="true" />
              Trigger Autonomous Deliberation
            </>
          )}
        </button>
      </div>
    </section>
  );
};
