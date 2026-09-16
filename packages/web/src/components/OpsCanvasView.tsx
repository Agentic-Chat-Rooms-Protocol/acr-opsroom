import React from 'react';
import { Layout, CheckSquare, Clock, ShieldCheck, Download, Activity, Cpu } from 'lucide-react';
import { OpsCanvas, ExecutionPlan } from '@acr-js/opsroom-core';
import { truncateHash } from '../lib/utils.js';

interface OpsCanvasViewProps {
  canvas: OpsCanvas;
  executionPlan?: ExecutionPlan;
  onExportCertificate: () => void;
}

export const OpsCanvasView: React.FC<OpsCanvasViewProps> = ({
  canvas,
  executionPlan,
  onExportCertificate,
}) => {
  return (
    <section 
      aria-labelledby="canvas-heading"
      className="p-5 rounded-2xl bg-slate-900/80 border border-white/10 backdrop-blur-xl mb-8"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3.5 mb-4 border-b border-white/10 gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Layout className="w-4 h-4 text-[#00f0ff]" aria-hidden="true" />
            <h2 id="canvas-heading" className="text-sm font-extrabold text-white">
              Live Collaborative Ops Canvas
            </h2>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-slate-300 font-mono">
              v{canvas.version} · {canvas.status}
            </span>
          </div>
          <p className="text-xs text-slate-400">
            Reinventing Slack Canvas: Real-time telemetry binding, state machine progression &amp; Merkle integrity.
          </p>
        </div>

        <button
          onClick={onExportCertificate}
          className="touch-target px-3.5 py-1.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-semibold text-white flex items-center gap-1.5 transition-all self-start sm:self-auto"
        >
          <Download className="w-3.5 h-3.5 text-[#00f0ff]" aria-hidden="true" />
          Export SOC2 Audit Cert
        </button>
      </div>

      {/* Live Telemetry KPI Metrics Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <div className="p-3 rounded-xl bg-slate-950/60 border border-white/10">
          <span className="text-[11px] text-slate-400 font-medium">Traffic Impact</span>
          <div className="text-lg font-bold text-white mt-0.5">
            {canvas.liveFields.trafficImpactPercent.toFixed(1)}%
          </div>
          <span className="text-[10px] text-slate-500 font-mono">cluster: {canvas.liveFields.affectedCluster}</span>
        </div>

        <div className="p-3 rounded-xl bg-slate-950/60 border border-white/10">
          <span className="text-[11px] text-slate-400 font-medium">Error Rate Spike</span>
          <div className={`text-lg font-bold mt-0.5 ${canvas.liveFields.errorRateSpike > 1.0 ? 'text-red-400' : 'text-emerald-400'}`}>
            +{canvas.liveFields.errorRateSpike.toFixed(2)}%
          </div>
          <span className="text-[10px] text-slate-500 font-mono">service: {canvas.liveFields.serviceName}</span>
        </div>

        <div className="p-3 rounded-xl bg-slate-950/60 border border-white/10">
          <span className="text-[11px] text-slate-400 font-medium">Estimated Cost Drift</span>
          <div className="text-lg font-bold text-amber-400 mt-0.5">
            ${canvas.liveFields.estimatedCostDriftUsd.toFixed(0)}/hr
          </div>
          <span className="text-[10px] text-slate-500 font-mono">FinOps guardrails</span>
        </div>

        <div className="p-3 rounded-xl bg-slate-950/60 border border-white/10">
          <span className="text-[11px] text-slate-400 font-medium">MCP Sandbox Isolation</span>
          <div className="text-sm font-mono font-bold text-[#00f0ff] mt-1 truncate">
            {canvas.liveFields.mcpSandboxIsolation}
          </div>
          <span className="text-[10px] text-emerald-400">acr-meta-mcp :20445</span>
        </div>
      </div>

      {/* Main Two Columns: Action Items & Execution DAG */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Action Items List */}
        <div className="p-4 rounded-xl bg-slate-950/40 border border-white/10">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-3 flex items-center gap-1.5">
            <CheckSquare className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
            Active Action Items ({canvas.actionItems.length})
          </h3>

          <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
            {canvas.actionItems.map((item) => (
              <div 
                key={item.id}
                className="p-2.5 rounded-lg bg-white/[0.02] border border-white/5 flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${
                    item.status === 'verified' ? 'bg-emerald-400' :
                    item.status === 'in_progress' ? 'bg-amber-400 animate-pulse' : 'bg-slate-600'
                  }`} aria-hidden="true" />
                  <div>
                    <div className="text-slate-200 font-medium">{item.title}</div>
                    <div className="text-[10px] text-slate-500 font-mono">Assigned: {item.assignedToRole}</div>
                  </div>
                </div>

                <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                  item.status === 'verified' ? 'bg-emerald-950/50 text-emerald-400 border border-emerald-500/30' :
                  item.status === 'in_progress' ? 'bg-amber-950/50 text-amber-400 border border-amber-500/30' :
                  'bg-slate-800 text-slate-400'
                }`}>
                  {item.status.replace('_', ' ')}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Execution Plan DAG & Steps */}
        <div className="p-4 rounded-xl bg-slate-950/40 border border-white/10">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-3 flex items-center gap-1.5">
            <Cpu className="w-3.5 h-3.5 text-[#00f0ff]" aria-hidden="true" />
            Sandboxed Execution Steps
          </h3>

          {!executionPlan || executionPlan.steps.length === 0 ? (
            <div className="text-center py-10 text-xs text-slate-500">
              No compiled plan steps yet. Quorum must complete deliberation.
            </div>
          ) : (
            <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
              {executionPlan.steps.map((step) => (
                <div 
                  key={step.id}
                  className="p-2.5 rounded-lg bg-white/[0.02] border border-white/5 flex items-center justify-between text-xs"
                >
                  <div>
                    <div className="text-slate-200 font-medium">#{step.stepNumber}: {step.title}</div>
                    <div className="text-[10px] text-slate-500 font-mono">
                      Target: {step.serverTarget} · Profile: {step.sandboxProfile}
                    </div>
                  </div>

                  <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                    step.status === 'completed' ? 'bg-emerald-950/50 text-emerald-400 border border-emerald-500/30' :
                    step.status === 'dry_run_passed' ? 'bg-blue-950/50 text-blue-400 border border-blue-500/30' :
                    step.status === 'executing' ? 'bg-amber-950/50 text-amber-400 animate-pulse' :
                    'bg-slate-800 text-slate-400'
                  }`}>
                    {step.status.replace(/_/g, ' ')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Merkle Hash Bar */}
      <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between text-[11px] text-slate-500 font-mono">
        <span>Canvas Merkle Root: {truncateHash(canvas.auditMerkleRoot, 16, 12)}</span>
        <span>Last Updated: {new Date(canvas.lastUpdated).toLocaleTimeString()}</span>
      </div>
    </section>
  );
};
