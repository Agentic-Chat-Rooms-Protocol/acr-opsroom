import React, { useState, useRef } from 'react';
import { Layers, ArrowRight, ShieldCheck, Check, AlertCircle } from 'lucide-react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

export const AtlasVisualizer: React.FC = () => {
  const [selectedArch, setSelectedArch] = useState<'atlas2' | 'atlas1'>('atlas2');
  const containerRef = useRef<HTMLDivElement | null>(null);

  useGSAP(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) return;

    gsap.from('.atlas-card', {
      opacity: 0,
      y: 18,
      stagger: 0.07,
      duration: 0.5,
      ease: 'power2.out',
    });
  }, { scope: containerRef, dependencies: [selectedArch] });

  return (
    <section 
      ref={containerRef}
      aria-labelledby="atlas-viz-heading"
      className="p-6 rounded-2xl bg-slate-900/80 border border-white/10 backdrop-blur-xl mb-8"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 mb-6 border-b border-white/10 gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Layers className="w-5 h-5 text-[#00f0ff]" aria-hidden="true" />
            <h2 id="atlas-viz-heading" className="text-base font-extrabold text-white">
              Atlas 2.0 Reasoning &amp; Deliberation Architecture
            </h2>
          </div>
          <p className="text-xs text-slate-400">
            Compare Salesforce Atlas 1.0 single-agent prompt-chaining vs ACR Atlas 2.0 Goal-Directed DAG.
          </p>
        </div>

        <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-white/10">
          <button
            onClick={() => setSelectedArch('atlas2')}
            className={`touch-target px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              selectedArch === 'atlas2'
                ? 'bg-[#00f0ff] text-black shadow-md shadow-[#00f0ff]/20'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            ACR Atlas 2.0 (Evolved)
          </button>
          <button
            onClick={() => setSelectedArch('atlas1')}
            className={`touch-target px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              selectedArch === 'atlas1'
                ? 'bg-amber-500 text-black shadow-md shadow-amber-500/20'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Salesforce Atlas 1.0 (Flawed)
          </button>
        </div>
      </div>

      {selectedArch === 'atlas2' ? (
        <div>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-2 mb-6">
            <div className="atlas-card p-3.5 rounded-xl bg-slate-950 border border-[#00f0ff]/30 text-center">
              <span className="text-[10px] font-mono text-[#00f0ff] uppercase font-bold">Phase 1</span>
              <h3 className="text-xs font-bold text-white mt-1">Telemetry Sensing</h3>
              <p className="text-[11px] text-slate-400 mt-1">Z-Score &amp; IQR Anomaly Evaluation</p>
            </div>

            <div className="atlas-card p-3.5 rounded-xl bg-slate-950 border border-[#00f0ff]/30 text-center">
              <span className="text-[10px] font-mono text-[#00f0ff] uppercase font-bold">Phase 2</span>
              <h3 className="text-xs font-bold text-white mt-1">Ambient Grounding</h3>
              <p className="text-[11px] text-slate-400 mt-1">System Logs, Git Diffs, MCP Catalog</p>
            </div>

            <div className="atlas-card p-3.5 rounded-xl bg-slate-950 border border-[#00f0ff]/30 text-center">
              <span className="text-[10px] font-mono text-[#00f0ff] uppercase font-bold">Phase 3</span>
              <h3 className="text-xs font-bold text-white mt-1">Squad Deliberation</h3>
              <p className="text-[11px] text-slate-400 mt-1">Parallel Cross-Agent Critique &amp; DAG</p>
            </div>

            <div className="atlas-card p-3.5 rounded-xl bg-slate-950 border border-emerald-500/40 text-center bg-emerald-950/20">
              <span className="text-[10px] font-mono text-emerald-400 uppercase font-bold">Phase 4</span>
              <h3 className="text-xs font-bold text-white mt-1">Byzantine Quorum</h3>
              <p className="text-[11px] text-slate-400 mt-1">67% Ed25519 Weighted Consensus</p>
            </div>

            <div className="atlas-card p-3.5 rounded-xl bg-slate-950 border border-[#00f0ff]/30 text-center">
              <span className="text-[10px] font-mono text-[#00f0ff] uppercase font-bold">Phase 5</span>
              <h3 className="text-xs font-bold text-white mt-1">Sandbox Execution</h3>
              <p className="text-[11px] text-slate-400 mt-1">ToolHive Micro-Container Containment</p>
            </div>

            <div className="atlas-card p-3.5 rounded-xl bg-slate-950 border border-[#00f0ff]/30 text-center">
              <span className="text-[10px] font-mono text-[#00f0ff] uppercase font-bold">Phase 6</span>
              <h3 className="text-xs font-bold text-white mt-1">Merkle Proof</h3>
              <p className="text-[11px] text-slate-400 mt-1">Tamper-Proof Audit &amp; Live Canvas</p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-500/30 text-xs text-slate-300">
            <div className="font-bold text-emerald-400 mb-1 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4" aria-hidden="true" />
              Atlas 2.0 Architectural Guarantee:
            </div>
            Zero unverified writes to production or CRM state. Every mutation requires explicit mathematical proof of agreement across independent agents, preflight dry-run simulation, and scoped network sandbox containment.
          </div>
        </div>
      ) : (
        <div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
            <div className="atlas-card p-4 rounded-xl bg-slate-950 border border-amber-500/30">
              <span className="text-[10px] font-mono text-amber-400 uppercase font-bold">Step 1</span>
              <h3 className="text-xs font-bold text-white mt-1">Static Topic Selection</h3>
              <p className="text-[11px] text-slate-400 mt-1">Matches user prompt to single pre-built Salesforce topic.</p>
            </div>

            <div className="atlas-card p-4 rounded-xl bg-slate-950 border border-amber-500/30">
              <span className="text-[10px] font-mono text-amber-400 uppercase font-bold">Step 2</span>
              <h3 className="text-xs font-bold text-white mt-1">Single LLM Prompt Chain</h3>
              <p className="text-[11px] text-slate-400 mt-1">One isolated model hallucinates steps without peer verification.</p>
            </div>

            <div className="atlas-card p-4 rounded-xl bg-slate-950 border border-red-500/40 bg-red-950/20">
              <span className="text-[10px] font-mono text-red-400 uppercase font-bold">Step 3 (Vulnerable)</span>
              <h3 className="text-xs font-bold text-white mt-1">Direct CRM Mutation</h3>
              <p className="text-[11px] text-slate-400 mt-1">Directly mutates records without container isolation or quorum.</p>
            </div>

            <div className="atlas-card p-4 rounded-xl bg-slate-950 border border-amber-500/30">
              <span className="text-[10px] font-mono text-amber-400 uppercase font-bold">Step 4</span>
              <h3 className="text-xs font-bold text-white mt-1">Passive Slack Text Post</h3>
              <p className="text-[11px] text-slate-400 mt-1">Dumps output to channel text thread ($2.00 billed per conversation).</p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-red-950/20 border border-red-500/30 text-xs text-slate-300">
            <div className="font-bold text-red-400 mb-1 flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4" aria-hidden="true" />
              Salesforce Atlas 1.0 Vulnerabilities:
            </div>
            Single point of cognitive failure. If the LLM misinterprets the context, bad writes cascade through your database. No cryptographic audit trail, high latency, and expensive per-turn billing.
          </div>
        </div>
      )}
    </section>
  );
};
