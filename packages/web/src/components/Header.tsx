import React from 'react';
import { Shield, Activity, Sparkles, HelpCircle, FileCheck, Layers } from 'lucide-react';

interface HeaderProps {
  activeTab: 'simulator' | 'atlas' | 'battlecard' | 'roi' | 'wcag';
  onSelectTab: (tab: 'simulator' | 'atlas' | 'battlecard' | 'roi' | 'wcag') => void;
  onOpenShortcuts: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onSelectTab,
  onOpenShortcuts,
}) => {
  return (
    <header 
      role="banner" 
      className="sticky top-0 z-50 w-full border-b border-white/10 bg-[#060913]/90 backdrop-blur-md px-4 lg:px-8 py-3.5 transition-all"
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#00f0ff]/20 to-[#8b5cf6]/20 border border-[#00f0ff]/40 flex items-center justify-center shadow-lg shadow-[#00f0ff]/10">
            <Shield className="w-5 h-5 text-[#00f0ff]" aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-black tracking-tight text-lg text-white">ACR <span className="text-[#00f0ff]">OpsRoom</span></span>
              <span className="px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider bg-[#00f0ff]/10 text-[#00f0ff] border border-[#00f0ff]/30 rounded-full">
                Atlas 2.0
              </span>
            </div>
            <p className="text-xs text-slate-400 hidden sm:block">
              Autonomous Byzantine War Room & Deliberation Engine
            </p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav aria-label="Main Navigation" className="hidden md:flex items-center gap-1.5 bg-slate-900/80 p-1 rounded-xl border border-white/10">
          <button
            onClick={() => onSelectTab('simulator')}
            className={`touch-target px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'simulator'
                ? 'bg-[#00f0ff] text-black shadow-md shadow-[#00f0ff]/20'
                : 'text-slate-300 hover:text-white hover:bg-white/5'
            }`}
            aria-current={activeTab === 'simulator' ? 'page' : undefined}
          >
            <Activity className="w-3.5 h-3.5 mr-1.5 inline" aria-hidden="true" />
            War Room Simulator
          </button>

          <button
            onClick={() => onSelectTab('atlas')}
            className={`touch-target px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'atlas'
                ? 'bg-[#00f0ff] text-black shadow-md shadow-[#00f0ff]/20'
                : 'text-slate-300 hover:text-white hover:bg-white/5'
            }`}
            aria-current={activeTab === 'atlas' ? 'page' : undefined}
          >
            <Layers className="w-3.5 h-3.5 mr-1.5 inline" aria-hidden="true" />
            Atlas 2.0 Engine
          </button>

          <button
            onClick={() => onSelectTab('battlecard')}
            className={`touch-target px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'battlecard'
                ? 'bg-[#00f0ff] text-black shadow-md shadow-[#00f0ff]/20'
                : 'text-slate-300 hover:text-white hover:bg-white/5'
            }`}
            aria-current={activeTab === 'battlecard' ? 'page' : undefined}
          >
            <Sparkles className="w-3.5 h-3.5 mr-1.5 inline" aria-hidden="true" />
            vs Agentforce
          </button>

          <button
            onClick={() => onSelectTab('roi')}
            className={`touch-target px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'roi'
                ? 'bg-[#00f0ff] text-black shadow-md shadow-[#00f0ff]/20'
                : 'text-slate-300 hover:text-white hover:bg-white/5'
            }`}
            aria-current={activeTab === 'roi' ? 'page' : undefined}
          >
            ROI Calculator
          </button>

          <button
            onClick={() => onSelectTab('wcag')}
            className={`touch-target px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'wcag'
                ? 'bg-[#00f0ff] text-black shadow-md shadow-[#00f0ff]/20'
                : 'text-slate-300 hover:text-white hover:bg-white/5'
            }`}
            aria-current={activeTab === 'wcag' ? 'page' : undefined}
          >
            <FileCheck className="w-3.5 h-3.5 mr-1.5 inline" aria-hidden="true" />
            WCAG 2.2 Auditor
          </button>
        </nav>

        {/* Right Actions */}
        <div className="flex items-center gap-3">
          <div className="hidden lg:flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-950/40 border border-emerald-500/30 text-emerald-400 text-xs font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true"></span>
            Quorum Active (67% BFT)
          </div>

          <button
            onClick={onOpenShortcuts}
            aria-label="View keyboard shortcuts"
            className="touch-target p-2 rounded-xl border border-white/10 hover:border-[#00f0ff]/40 bg-slate-900/60 text-slate-300 hover:text-white transition-all"
            title="Keyboard Shortcuts (?)"
          >
            <HelpCircle className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  );
};
