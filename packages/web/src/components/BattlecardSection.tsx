import React, { useRef } from 'react';
import { Sparkles, Check, X } from 'lucide-react';
import { BATTLECARD_ITEMS } from '../lib/mock-data.js';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(useGSAP, ScrollTrigger);

export const BattlecardSection: React.FC = () => {
  const tableRef = useRef<HTMLDivElement | null>(null);

  useGSAP(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) return;

    gsap.from('.battlecard-row', {
      scrollTrigger: {
        trigger: tableRef.current,
        start: 'top 85%',
      },
      opacity: 0,
      x: -20,
      stagger: 0.08,
      duration: 0.6,
      ease: 'power2.out',
    });
  }, { scope: tableRef });

  return (
    <section 
      ref={tableRef}
      aria-labelledby="battlecard-heading"
      className="p-6 rounded-2xl bg-slate-900/80 border border-white/10 backdrop-blur-xl mb-8"
    >
      <div className="text-center max-w-2xl mx-auto mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#00f0ff]/10 border border-[#00f0ff]/30 text-xs font-semibold text-[#00f0ff] mb-3">
          <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
          Master Battlecard Matrix
        </div>
        <h2 id="battlecard-heading" className="text-2xl font-extrabold text-white mb-2">
          How OpsRoom Surpasses Salesforce Agentforce
        </h2>
        <p className="text-xs sm:text-sm text-slate-400">
          Comparing the closed-source $2/conversation incumbent with ACR's decentralized, cryptographic operations engine.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-white/10 text-slate-400 font-semibold uppercase tracking-wider">
              <th scope="col" className="py-3.5 px-4">Core Operational Vector</th>
              <th scope="col" className="py-3.5 px-4 text-slate-300">Salesforce Agentforce + Slack</th>
              <th scope="col" className="py-3.5 px-4 text-[#00f0ff] font-bold">ACR OpsRoom (The Evolution)</th>
              <th scope="col" className="py-3.5 px-4 text-emerald-400 font-bold">Verdict</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {BATTLECARD_ITEMS.map((item, idx) => (
              <tr key={idx} className="battlecard-row hover:bg-white/[0.02] transition-colors">
                <td className="py-4 px-4 font-bold text-white align-top whitespace-nowrap">
                  {item.feature}
                </td>
                <td className="py-4 px-4 text-slate-400 align-top max-w-xs leading-relaxed">
                  <span className="flex items-start gap-1.5 text-red-400/90 mb-1">
                    <X className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{item.agentforce}</span>
                  </span>
                </td>
                <td className="py-4 px-4 text-slate-200 align-top max-w-sm leading-relaxed">
                  <span className="flex items-start gap-1.5 text-emerald-400 mb-1 font-medium">
                    <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{item.opsroom}</span>
                  </span>
                </td>
                <td className="py-4 px-4 align-top whitespace-nowrap">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#00f0ff]/10 text-[#00f0ff] border border-[#00f0ff]/30">
                    {item.winner}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};
