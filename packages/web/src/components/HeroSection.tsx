import React, { useRef } from 'react';
import { ShieldCheck, Cpu, Terminal, ArrowRight, Zap, CheckCircle2 } from 'lucide-react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(useGSAP, ScrollTrigger);

interface HeroSectionProps {
  onStartSimulation: () => void;
  onViewBattlecard: () => void;
}

export const HeroSection: React.FC<HeroSectionProps> = ({
  onStartSimulation,
  onViewBattlecard,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useGSAP(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) return;

    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

    tl.from('.hero-tag', {
      opacity: 0,
      y: -16,
      duration: 0.6,
    })
      .from(
        '.hero-title',
        {
          opacity: 0,
          y: 28,
          duration: 0.8,
        },
        '-=0.3'
      )
      .from(
        '.hero-desc',
        {
          opacity: 0,
          y: 20,
          duration: 0.7,
        },
        '-=0.4'
      )
      .from(
        '.hero-cta',
        {
          opacity: 0,
          scale: 0.95,
          y: 12,
          duration: 0.5,
          stagger: 0.1,
        },
        '-=0.3'
      )
      .from(
        '.hero-metric-card',
        {
          opacity: 0,
          y: 30,
          stagger: 0.12,
          duration: 0.7,
          ease: 'back.out(1.2)',
        },
        '-=0.2'
      );
  }, { scope: containerRef });

  return (
    <section 
      ref={containerRef}
      aria-labelledby="hero-heading"
      className="relative pt-10 pb-12 px-4 lg:px-8 max-w-7xl mx-auto overflow-hidden"
    >
      <div className="text-center max-w-4xl mx-auto">
        {/* Top Tagline */}
        <div className="hero-tag inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/[0.04] border border-white/10 text-xs font-semibold text-zinc-300 mb-6 backdrop-blur-md">
          <span className="w-2 h-2 rounded-full bg-[#FF5500] animate-ping motion-reduce:animate-none" aria-hidden="true" />
          <span>Stop Single-Agent Outage Drift</span>
          <span className="text-[#FF8C42] font-bold">· WCAG 2.2 AAA COMPLIANT</span>
        </div>

        {/* Main Title */}
        <h1 
          id="hero-heading"
          className="hero-title text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-[1.15] mb-6"
        >
          The Cryptographic War Room for <br className="hidden sm:block" />
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#FF5500] via-[#FF8C42] to-[#FFB07A]">
            Governed Enterprise AI
          </span>
        </h1>

        <p className="hero-desc text-base sm:text-lg text-zinc-300 mb-8 max-w-2xl mx-auto leading-relaxed">
          Single-agent prompt chains hallucinate during incidents and charge $2 per conversation.
          <strong> ACR OpsRoom</strong> coordinates multi-agent SRE and SecOps squads behind a
          <strong> 67% Consensus Gate</strong>, <strong>Atlas 2.0 Dynamic DAG</strong> rollbacks, <strong>ToolHive Micro-Sandboxing</strong>, and a <strong>$0 Runtime Protocol Tax</strong>.
        </p>

        {/* CTAs */}
        <div className="flex flex-wrap items-center justify-center gap-4 mb-12">
          <button
            onClick={onStartSimulation}
            className="hero-cta touch-target px-6 py-3 rounded-xl bg-[#FF5500] text-black font-bold text-sm hover:bg-[#FF8C42] shadow-lg shadow-[#FF5500]/25 flex items-center gap-2 transition-all hover:scale-[1.02]"
          >
            <Zap className="w-4 h-4 fill-black" aria-hidden="true" />
            Launch Live Incident Simulation
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </button>

          <button
            onClick={onViewBattlecard}
            className="hero-cta touch-target px-6 py-3 rounded-xl border border-white/15 bg-white/[0.04] text-white font-semibold text-sm hover:bg-white/[0.08] transition-all"
          >
            View vs Agentforce Battlecard
          </button>
        </div>

        {/* Key Architectural Metric Highlights */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto">
          <div className="hero-metric-card p-4 rounded-2xl bg-[#0D0D11]/90 border border-white/10 backdrop-blur-md text-left">
            <div className="flex items-center gap-2 text-[#FF8C42] mb-1">
              <ShieldCheck className="w-4 h-4" aria-hidden="true" />
              <span className="text-xs font-bold uppercase tracking-wider">Safety</span>
            </div>
            <div className="text-2xl font-black text-white">67% Consensus Gate</div>
            <p className="text-xs text-zinc-400 mt-0.5">Signed by W3C Ed25519 DIDs</p>
          </div>

          <div className="hero-metric-card p-4 rounded-2xl bg-[#0D0D11]/90 border border-white/10 backdrop-blur-md text-left">
            <div className="flex items-center gap-2 text-[#38BDF8] mb-1">
              <Cpu className="w-4 h-4" aria-hidden="true" />
              <span className="text-xs font-bold uppercase tracking-wider">Engine</span>
            </div>
            <div className="text-2xl font-black text-white">Atlas 2.0 Dynamic DAG</div>
            <p className="text-xs text-zinc-400 mt-0.5">Deterministic rollbacks</p>
          </div>

          <div className="hero-metric-card p-4 rounded-2xl bg-[#0D0D11]/90 border border-white/10 backdrop-blur-md text-left">
            <div className="flex items-center gap-2 text-[#10B981] mb-1">
              <Terminal className="w-4 h-4" aria-hidden="true" />
              <span className="text-xs font-bold uppercase tracking-wider">Isolation</span>
            </div>
            <div className="text-2xl font-black text-white">ToolHive Micro-Sandboxing</div>
            <p className="text-xs text-zinc-400 mt-0.5">Process isolation</p>
          </div>

          <div className="hero-metric-card p-4 rounded-2xl bg-[#0D0D11]/90 border border-white/10 backdrop-blur-md text-left">
            <div className="flex items-center gap-2 text-[#FF6600] mb-1">
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
              <span className="text-xs font-bold uppercase tracking-wider">Economics</span>
            </div>
            <div className="text-2xl font-black text-white">$0 Runtime Protocol Tax</div>
            <p className="text-xs text-zinc-400 mt-0.5">Open-source Apache-2</p>
          </div>
        </div>
      </div>
    </section>
  );
};
