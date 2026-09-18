import React from 'react';
import { CheckCircle, XCircle, AlertOctagon, UserCheck, ShieldCheck, Lock, Play, Loader2 } from 'lucide-react';
import { ConsensusBallot, QuorumEvaluation, IncidentStatus } from '@acr-js/opsroom-core';
import { truncateHash } from '../lib/utils.js';

interface ConsensusBallotBoxProps {
  ballots: ConsensusBallot[];
  quorum?: QuorumEvaluation;
  humanApproved: boolean;
  onToggleHumanApproval: () => void;
  onExecutePlan: () => void;
  isExecuting: boolean;
  incidentStatus?: IncidentStatus;
}

export const ConsensusBallotBox: React.FC<ConsensusBallotBoxProps> = ({
  ballots,
  quorum,
  humanApproved,
  onToggleHumanApproval,
  onExecutePlan,
  isExecuting,
  incidentStatus,
}) => {
  const approvalPercent = quorum ? Math.round(quorum.weightedApprovalRatio * 100) : 0;
  const thresholdPercent = quorum ? Math.round(quorum.weightedQuorumTarget * 100) : 67;
  const isQuorumMet = quorum ? quorum.thresholdReached : false;

  return (
    <section 
      aria-labelledby="consensus-heading"
      className="p-5 rounded-2xl bg-slate-900/80 border border-white/10 backdrop-blur-xl flex flex-col h-full"
    >
      <div className="flex items-center justify-between pb-3.5 mb-4 border-b border-white/10">
        <div>
          <h2 id="consensus-heading" className="text-sm font-extrabold text-white flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" aria-hidden="true" />
            Byzantine Quorum Consensus Box
          </h2>
          <p className="text-xs text-slate-400">
            Guarantees 2/3 supermajority agreement before allowing write mutations.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-mono px-2 py-0.5 rounded border uppercase font-bold ${
            quorum?.status === 'approved' ? 'bg-emerald-950/50 text-emerald-400 border-emerald-500/40' :
            quorum?.status === 'escalated_human' ? 'bg-amber-950/50 text-amber-400 border-amber-500/40' :
            'bg-slate-800 text-slate-400 border-white/10'
          }`}>
            {quorum ? quorum.status.replace('_', ' ') : 'STANDBY'}
          </span>
        </div>
      </div>

      {/* Quorum Progress Meter */}
      <div className="mb-5 p-4 rounded-xl bg-slate-950/70 border border-white/10">
        <div className="flex items-center justify-between text-xs mb-2">
          <span className="font-semibold text-slate-300">Weighted Quorum Ratio</span>
          <span className="font-mono font-bold text-white">
            {approvalPercent}% <span className="text-slate-500 font-normal">/ {thresholdPercent}% Target</span>
          </span>
        </div>

        <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden relative" role="progressbar" aria-valuenow={approvalPercent} aria-valuemin={0} aria-valuemax={100}>
          <div 
            className={`h-full transition-all duration-500 rounded-full ${
              isQuorumMet ? 'bg-gradient-to-r from-emerald-500 to-[#00f0ff]' : 'bg-amber-500'
            }`}
            style={{ width: `${Math.min(100, approvalPercent)}%` }}
          />
          {/* Target marker */}
          <div 
            className="absolute top-0 bottom-0 w-0.5 bg-white shadow"
            style={{ left: `${thresholdPercent}%` }}
            title={`Threshold: ${thresholdPercent}%`}
          />
        </div>

        <div className="flex items-center justify-between text-[11px] text-slate-400 mt-2">
          <span>Total Ballots: {ballots.length}</span>
          <span className={isQuorumMet ? 'text-emerald-400 font-bold' : 'text-amber-400'}>
            {isQuorumMet ? '✓ 2/3 Byzantine Quorum Achieved' : 'Pending Supermajority'}
          </span>
        </div>
      </div>

      {/* Ballots Tally List */}
      <div className="flex-1 overflow-y-auto max-h-[220px] space-y-2 mb-4 pr-1">
        {ballots.length === 0 ? (
          <div className="text-center py-6 text-xs text-slate-500">
            No ballots submitted yet. Waiting for squad deliberation turn completion.
          </div>
        ) : (
          ballots.map((b) => (
            <div 
              key={b.ballotId}
              className="p-2.5 rounded-lg bg-white/[0.02] border border-white/10 flex items-center justify-between text-xs"
            >
              <div className="flex items-center gap-2">
                {b.decision === 'approve' ? (
                  <CheckCircle className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                ) : (
                  <XCircle className="w-4 h-4 text-red-400" aria-hidden="true" />
                )}
                <div>
                  <div className="font-semibold text-white">{b.role}</div>
                  <div className="text-[10px] text-slate-400 truncate max-w-[200px]">{b.justification}</div>
                </div>
              </div>

              <div className="text-right">
                <span className="font-mono text-[10px] text-slate-400">
                  Conf: {(b.confidence * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Human-in-the-Loop Dual Consent Control */}
      <div className="pt-3 border-t border-white/10 flex flex-col gap-3">
        <label className="flex items-center gap-2.5 cursor-pointer p-2.5 rounded-xl bg-white/[0.02] border border-white/10 hover:border-white/20 transition-all">
          <input
            type="checkbox"
            checked={humanApproved}
            onChange={onToggleHumanApproval}
            className="w-4 h-4 rounded text-[#00f0ff] focus:ring-[#00f0ff] focus:ring-offset-0 bg-slate-900 border-white/30"
          />
          <div className="text-xs">
            <span className="font-bold text-white flex items-center gap-1">
              <UserCheck className="w-3.5 h-3.5 text-[#00f0ff]" aria-hidden="true" />
              Human-in-the-Loop Dual Consent
            </span>
            <p className="text-[11px] text-slate-400">Required for critical-tier sandboxed modifications.</p>
          </div>
        </label>

        <button
          onClick={onExecutePlan}
          disabled={!isQuorumMet || isExecuting || incidentStatus === 'resolved'}
          className={`touch-target w-full py-3 px-4 rounded-xl font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer ${
            incidentStatus === 'resolved'
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 cursor-default'
              : isExecuting
              ? 'bg-cyan-500/30 text-cyan-200 border border-cyan-400 animate-pulse'
              : isQuorumMet 
              ? 'bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 hover:from-emerald-300 hover:to-cyan-300 text-slate-950 shadow-lg shadow-cyan-500/20 active:scale-98'
              : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-white/5'
          }`}
        >
          {incidentStatus === 'resolved' ? (
            <>
              <CheckCircle className="w-4 h-4 text-emerald-400" aria-hidden="true" />
              <span>Mitigation Plan Executed &amp; Verified</span>
            </>
          ) : incidentStatus === 'verifying' ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              <span>Verifying Telemetry &amp; Action Items...</span>
            </>
          ) : isExecuting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              <span>Executing Inside ToolHive Sandbox...</span>
            </>
          ) : (
            <>
              <Play className="w-4 h-4 fill-current" aria-hidden="true" />
              <span>Authorize &amp; Execute Sandboxed Mitigation Plan</span>
            </>
          )}
        </button>

        {quorum?.merkleRootHash && (
          <div className="text-[10px] text-slate-500 font-mono text-center truncate">
            Merkle Root: {truncateHash(quorum.merkleRootHash, 12, 8)}
          </div>
        )}
      </div>
    </section>
  );
};
