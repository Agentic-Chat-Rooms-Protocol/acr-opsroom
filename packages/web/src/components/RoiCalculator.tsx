import React, { useState } from 'react';
import { DollarSign, TrendingUp, Zap, Sparkles } from 'lucide-react';
import { formatCurrency, formatNumber } from '../lib/utils.js';
import gsap from 'gsap';

export const RoiCalculator: React.FC = () => {
  const [monthlyConversations, setMonthlyConversations] = useState(25000);
  const [activeAgents, setActiveAgents] = useState(50);

  const handleConversationsChange = (val: number) => {
    const clamped = gsap.utils.clamp(2000, 200000, val);
    setMonthlyConversations(clamped);
  };

  const handleAgentsChange = (val: number) => {
    const clamped = gsap.utils.clamp(5, 250, val);
    setActiveAgents(clamped);
  };

  // Salesforce Agentforce calculation
  // $2.00 per conversation + $500/month org fee + Data cloud flex credits (~$1,200/mo for 25k)
  const salesforceMonthlyCost = (monthlyConversations * 2.00) + 500 + (monthlyConversations * 0.05);
  const salesforceAnnualCost = salesforceMonthlyCost * 12;

  // ACR OpsRoom calculation
  // Open Source Protocol ($0) + self-hosted or mesh compute (~$0.015 per multi-agent deliberation round)
  const acrMonthlyCost = (monthlyConversations * 0.015) + (activeAgents * 5);
  const acrAnnualCost = acrMonthlyCost * 12;

  const annualSavings = Math.max(0, salesforceAnnualCost - acrAnnualCost);
  const percentSavings = Math.round((annualSavings / salesforceAnnualCost) * 100);

  return (
    <section 
      aria-labelledby="roi-heading"
      className="p-6 rounded-2xl bg-[#0D0D11]/90 border border-white/10 backdrop-blur-xl mb-8"
    >
      <div className="text-center max-w-2xl mx-auto mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-xs font-semibold text-emerald-400 mb-3">
          <DollarSign className="w-3.5 h-3.5" aria-hidden="true" />
          Enterprise ROI &amp; TCO Calculator
        </div>
        <h2 id="roi-heading" className="text-2xl font-extrabold text-white mb-2">
          Calculate Your Migration Savings
        </h2>
        <p className="text-xs sm:text-sm text-zinc-400">
          Salesforce charges $2.00 per conversation plus platform fees. See your annual savings with ACR OpsRoom.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
        {/* Sliders Input */}
        <div className="space-y-6 p-5 rounded-xl bg-[#050508] border border-white/10">
          <div>
            <div className="flex justify-between text-xs font-bold text-zinc-300 mb-2">
              <label htmlFor="conversations-slider">Monthly Operations Conversations / Actions:</label>
              <span className="text-[#FF8C42] font-mono text-sm">{formatNumber(monthlyConversations)}</span>
            </div>
            <input
              id="conversations-slider"
              type="range"
              min="2000"
              max="200000"
              step="1000"
              value={monthlyConversations}
              onChange={(e) => handleConversationsChange(Number(e.target.value))}
              className="w-full h-2 bg-[#262626] rounded-lg appearance-none cursor-pointer accent-[#FF5500]"
            />
            <div className="flex justify-between text-[10px] text-zinc-500 mt-1">
              <span>2,000</span>
              <span>100,000</span>
              <span>200,000</span>
            </div>
          </div>

          <div>
            <div className="flex justify-between text-xs font-bold text-zinc-300 mb-2">
              <label htmlFor="agents-slider">Autonomous Agents &amp; Squads Active:</label>
              <span className="text-[#FF8C42] font-mono text-sm">{activeAgents}</span>
            </div>
            <input
              id="agents-slider"
              type="range"
              min="5"
              max="250"
              step="5"
              value={activeAgents}
              onChange={(e) => handleAgentsChange(Number(e.target.value))}
              className="w-full h-2 bg-[#262626] rounded-lg appearance-none cursor-pointer accent-[#FF5500]"
            />
            <div className="flex justify-between text-[10px] text-zinc-500 mt-1">
              <span>5 Agents</span>
              <span>125 Agents</span>
              <span>250 Agents</span>
            </div>
          </div>
        </div>

        {/* Output Comparison Cards */}
        <div className="space-y-4">
          <div className="p-5 rounded-xl bg-red-950/20 border border-red-500/30 flex items-center justify-between">
            <div>
              <span className="text-xs text-red-400 font-bold uppercase tracking-wider">Salesforce Agentforce Annual Cost</span>
              <div className="text-2xl font-black text-white mt-0.5">
                {formatCurrency(salesforceAnnualCost)}
              </div>
              <p className="text-[11px] text-zinc-400 mt-1">
                Includes $2.00/conv + org base fee + Data Cloud consumption credits
              </p>
            </div>
          </div>

          <div className="p-5 rounded-xl bg-emerald-950/20 border border-emerald-500/40 flex items-center justify-between relative overflow-hidden">
            <div className="relative z-10">
              <span className="text-xs text-emerald-400 font-bold uppercase tracking-wider">ACR OpsRoom Annual Cost</span>
              <div className="text-3xl font-black text-[#FF8C42] mt-0.5">
                {formatCurrency(acrAnnualCost)}
              </div>
              <p className="text-[11px] text-zinc-300 mt-1 font-medium">
                100% Open Protocol ($0 fee) + pure token compute cost
              </p>
            </div>

            <div className="text-right relative z-10">
              <div className="text-xs font-bold text-emerald-400 uppercase">Net Annual Savings</div>
              <div className="text-3xl font-black text-white mt-0.5">
                {formatCurrency(annualSavings)}
              </div>
              <span className="inline-block mt-1 px-2.5 py-0.5 rounded-full text-xs font-black bg-emerald-500 text-black">
                {percentSavings}% Savings
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
