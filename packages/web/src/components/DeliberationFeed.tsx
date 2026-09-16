import React from 'react';
import { Bot, CheckCircle, ShieldAlert, Cpu, Terminal, Key } from 'lucide-react';
import { DeliberationTurn } from '@acr-js/opsroom-core';
import { truncateHash } from '../lib/utils.js';

interface DeliberationFeedProps {
  turns: DeliberationTurn[];
  activePhase: string;
}

export const DeliberationFeed: React.FC<DeliberationFeedProps> = ({
  turns,
  activePhase,
}) => {
  return (
    <section 
      aria-labelledby="deliberation-heading"
      className="p-5 rounded-2xl bg-slate-900/80 border border-white/10 backdrop-blur-xl flex flex-col h-full"
    >
      <div className="flex items-center justify-between pb-3.5 mb-4 border-b border-white/10">
        <div>
          <h2 id="deliberation-heading" className="text-sm font-extrabold text-white flex items-center gap-2">
            <Bot className="w-4 h-4 text-[#00f0ff]" aria-hidden="true" />
            Atlas 2.0 Squad Deliberation Feed
          </h2>
          <p className="text-xs text-slate-400">
            Multi-agent reasoning with cryptographic Ed25519 payload signatures.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-white/5 text-slate-300 border border-white/10">
            Phase: <span className="text-[#00f0ff] uppercase font-bold">{activePhase}</span>
          </span>
          <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-950/40 text-emerald-400 border border-emerald-500/30">
            {turns.length} Turns
          </span>
        </div>
      </div>

      {/* Live Region for Deliberation Turns */}
      <div 
        role="feed" 
        aria-label="Agent Deliberation Turns"
        aria-live="polite"
        className="space-y-3.5 overflow-y-auto max-h-[480px] pr-1"
      >
        {turns.length === 0 ? (
          <div className="text-center py-16 text-slate-500 text-xs">
            <Cpu className="w-8 h-8 mx-auto mb-2 text-slate-600 animate-pulse" aria-hidden="true" />
            Awaiting incident trigger. Autonomous squad in standby mode.
          </div>
        ) : (
          turns.map((turn) => {
            const isAtlas = turn.role === 'atlas_orchestrator';
            const isSecOps = turn.role === 'secops_guardian';
            const isSRE = turn.role === 'sre_reliability';

            const borderClass = isAtlas 
              ? 'border-[#00f0ff]/30 bg-[#00f0ff]/[0.02]' 
              : isSecOps 
              ? 'border-emerald-500/30 bg-emerald-500/[0.02]'
              : isSRE
              ? 'border-indigo-500/30 bg-indigo-500/[0.02]'
              : 'border-white/10 bg-white/[0.02]';

            return (
              <article 
                key={turn.id}
                aria-label={`Turn ${turn.turnIndex} by ${turn.agentName}`}
                className={`p-4 rounded-xl border ${borderClass} transition-all`}
              >
                {/* Header */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-lg bg-white/10 flex items-center justify-center text-xs font-bold text-white">
                      #{turn.turnIndex}
                    </span>
                    <div>
                      <div className="text-xs font-bold text-white flex items-center gap-1.5">
                        {turn.agentName}
                        <span className="text-[10px] font-normal text-slate-400">({turn.role})</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-slate-300 font-mono">
                      Conf: {(turn.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>

                {/* Reasoning text */}
                <p className="text-xs text-slate-200 leading-relaxed mb-3">
                  {turn.reasoning}
                </p>

                {/* Proposed Tool Actions */}
                {turn.proposedActions && turn.proposedActions.length > 0 && (
                  <div className="p-2.5 rounded-lg bg-slate-950/80 border border-white/10 mb-2">
                    <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400 mb-1.5">
                      <span className="flex items-center gap-1">
                        <Terminal className="w-3 h-3 text-[#00f0ff]" aria-hidden="true" />
                        Proposed Tool Call ({turn.proposedActions[0].serverName})
                      </span>
                      <span className={`px-1.5 py-0.2 text-[10px] uppercase font-bold rounded ${
                        turn.proposedActions[0].riskLevel === 'critical' ? 'text-red-400 bg-red-950/50' :
                        turn.proposedActions[0].riskLevel === 'high' ? 'text-amber-400 bg-amber-950/50' :
                        'text-emerald-400 bg-emerald-950/50'
                      }`}>
                        Risk: {turn.proposedActions[0].riskLevel}
                      </span>
                    </div>

                    <div className="font-mono text-xs text-[#00f0ff]">
                      {turn.proposedActions[0].toolName}(
                      <span className="text-slate-300">
                        {JSON.stringify(turn.proposedActions[0].parameters)}
                      </span>
                      )
                    </div>
                  </div>
                )}

                {/* Signature Hash Footer */}
                <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono pt-2 border-t border-white/5">
                  <span className="flex items-center gap-1">
                    <Key className="w-3 h-3 text-slate-400" aria-hidden="true" />
                    Ed25519 Sig: {truncateHash(turn.signature, 10, 6)}
                  </span>
                  <span>{new Date(turn.timestamp).toLocaleTimeString()}</span>
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
};
