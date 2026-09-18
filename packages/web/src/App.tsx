import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ShaderBackground } from './components/ShaderBackground.js';
import { Header } from './components/Header.js';
import { HeroSection } from './components/HeroSection.js';
import { IncidentCommander } from './components/IncidentCommander.js';
import { DeliberationFeed } from './components/DeliberationFeed.js';
import { ConsensusBallotBox } from './components/ConsensusBallotBox.js';
import { OpsCanvasView } from './components/OpsCanvasView.js';
import { SyntheticHuddle } from './components/SyntheticHuddle.js';
import { AtlasVisualizer } from './components/AtlasVisualizer.js';
import { BattlecardSection } from './components/BattlecardSection.js';
import { RoiCalculator } from './components/RoiCalculator.js';
import { WcagInspector } from './components/WcagInspector.js';
import { KeyboardShortcutsModal } from './components/KeyboardShortcutsModal.js';

import { 
  INCIDENT_PRESETS, 
  DEFAULT_SQUAD_AGENTS, 
  IncidentPreset 
} from './lib/mock-data.js';

import { 
  OpsIncident, 
  Atlas2Engine, 
  MLIncidentRouter, 
  ByzantineConsensusEngine, 
  OpsCanvasManager, 
  HuddleManager, 
  SandboxExecutor, 
  CryptographicAuditLedger,
  DeliberationTurn,
  ConsensusBallot,
  QuorumEvaluation
} from '@acr-js/opsroom-core';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'simulator' | 'atlas' | 'battlecard' | 'roi' | 'wcag'>('simulator');
  const [selectedPreset, setSelectedPreset] = useState<IncidentPreset>(INCIDENT_PRESETS[0]);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);

  const isExecutingRef = useRef(false);

  // Active Incident State
  const [currentIncident, setCurrentIncident] = useState<OpsIncident>(() => {
    const squad = MLIncidentRouter.createDefaultSquad('squad-sre-core');
    const inc = Atlas2Engine.createIncident(
      INCIDENT_PRESETS[0].title,
      INCIDENT_PRESETS[0].description,
      squad
    );
    inc.severity = INCIDENT_PRESETS[0].severity;
    const huddle = HuddleManager.startHuddle(inc.id, squad.agents);
    const agentSre = squad.agents[1];
    const agentSec = squad.agents[2];
    const agentAtlas = squad.agents[0];
    HuddleManager.addSpokenLine(huddle, agentSre, 'Anomaly matches known replication stall signature. Node isolation recommended before WAL wrap.');
    HuddleManager.addSpokenLine(huddle, agentSec, 'SecOps confirmed egress allowlist locked. Ready for consensus ballot.');
    HuddleManager.addSpokenLine(huddle, agentAtlas, 'Goal decomposition complete. Requesting 67% Byzantine Quorum vote.');
    inc.huddle = huddle;
    HuddleManager.synthesizeAndSyncToCanvas(huddle, inc.canvas);
    return inc;
  });

  const [isRunning, setIsRunning] = useState(false);
  const [humanApproved, setHumanApproved] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);

  // Keyboard navigation shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      if (e.key === '?') {
        setIsShortcutsOpen(prev => !prev);
      } else if (e.key === '1') {
        setActiveTab('simulator');
      } else if (e.key === '2') {
        setActiveTab('atlas');
      } else if (e.key === '3') {
        setActiveTab('battlecard');
      } else if (e.key === '4') {
        setActiveTab('roi');
      } else if (e.key === '5') {
        setActiveTab('wcag');
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // Reset war room state
  const handleReset = useCallback((overridePreset?: IncidentPreset) => {
    const targetPreset = overridePreset || selectedPreset;
    const squad = MLIncidentRouter.createDefaultSquad(
      targetPreset.category === 'SecOps & Zero-Trust' ? 'squad-secops-defense' : 'squad-sre-core'
    );
    const inc = Atlas2Engine.createIncident(targetPreset.title, targetPreset.description, squad);
    inc.severity = targetPreset.severity;
    const huddle = HuddleManager.startHuddle(inc.id, squad.agents);
    const agentSre = squad.agents[1];
    const agentSec = squad.agents[2];
    const agentAtlas = squad.agents[0];
    HuddleManager.addSpokenLine(huddle, agentSre, 'Anomaly matches known replication stall signature. Node isolation recommended before WAL wrap.');
    HuddleManager.addSpokenLine(huddle, agentSec, 'SecOps confirmed egress allowlist locked. Ready for consensus ballot.');
    HuddleManager.addSpokenLine(huddle, agentAtlas, 'Goal decomposition complete. Requesting 67% Byzantine Quorum vote.');
    inc.huddle = huddle;
    HuddleManager.synthesizeAndSyncToCanvas(huddle, inc.canvas);
    setCurrentIncident(inc);
    setIsRunning(false);
    setHumanApproved(false);
    isExecutingRef.current = false;
    setIsExecuting(false);
  }, [selectedPreset]);

  // Trigger Autonomous Incident Simulation
  const handleTriggerIncident = useCallback(async (customTitle?: string, customDesc?: string) => {
    setIsRunning(true);
    const title = customTitle || selectedPreset.title;
    const desc = customDesc || selectedPreset.description;

    const squadId = selectedPreset.category === 'SecOps & Zero-Trust' ? 'squad-secops-defense' : 'squad-sre-core';
    const squad = MLIncidentRouter.createDefaultSquad(squadId);
    const inc = Atlas2Engine.createIncident(title, desc, squad);
    inc.severity = selectedPreset.severity;

    // Start synthetic huddle
    const huddle = HuddleManager.startHuddle(inc.id, squad.agents);
    inc.huddle = huddle;
    setCurrentIncident({ ...inc });

    // Step 1: Deliberating phase
    Atlas2Engine.transitionPhase(inc, 'deliberating');
    setCurrentIncident({ ...inc });
    await new Promise(r => setTimeout(r, 600));

    // Turn 1: SRE or SecOps Agent
    const agent1 = squad.agents[1];
    Atlas2Engine.addDeliberationTurn(
      inc,
      agent1,
      `Telemetry divergence verified. Primary replication buffer or egress threshold breached by ${selectedPreset.telemetry[0].zScore.toFixed(1)} standard deviations. Recommending isolated failover plan.`,
      'Primary Buffer Degradation',
      [
        {
          toolName: 'isolate_failing_node',
          serverName: 'acr-sre-mcp',
          parameters: { targetNode: 'db-replica-03', drainGraceSec: 5 },
          isDryRun: true,
          riskLevel: 'medium',
        }
      ],
      0.94
    );
    HuddleManager.addSpokenLine(
      huddle,
      agent1,
      'Anomaly matches known replication stall signature. Node isolation recommended before WAL wrap.'
    );
    setCurrentIncident({ ...inc });
    await new Promise(r => setTimeout(r, 600));

    // Turn 2: SecOps Guardian Agent
    const agent2 = squad.agents[2];
    Atlas2Engine.addDeliberationTurn(
      inc,
      agent2,
      'Zero-Trust inspection complete. Verified no credential exposure. Authorizing ToolHive workspace-scoped container for failover command.',
      'Safe Sandbox Execution',
      [],
      0.96
    );
    HuddleManager.addSpokenLine(
      huddle,
      agent2,
      'SecOps confirmed egress allowlist locked. Ready for consensus ballot.'
    );
    setCurrentIncident({ ...inc });
    await new Promise(r => setTimeout(r, 600));

    // Turn 3: Atlas Orchestrator
    const agent0 = squad.agents[0];
    Atlas2Engine.addDeliberationTurn(
      inc,
      agent0,
      'Goal decomposition completed. Generated 2-step mitigation DAG. Summoning Byzantine Quorum vote.',
      'DAG Plan Compiled',
      [
        {
          toolName: 'activate_secondary_route',
          serverName: 'acr-mesh-mcp',
          parameters: { targetRoute: 'read-replica-01' },
          isDryRun: true,
          riskLevel: 'low',
        }
      ],
      0.98
    );
    HuddleManager.addSpokenLine(
      huddle,
      agent0,
      'Goal decomposition completed. Synthesized 2-step mitigation DAG. Summoning Byzantine Quorum vote.'
    );
    setCurrentIncident({ ...inc });
    await new Promise(r => setTimeout(r, 600));

    // Step 2: Quorum Voting
    Atlas2Engine.transitionPhase(inc, 'awaiting_quorum');
    const plan = Atlas2Engine.compileExecutionPlan(inc, 'Isolate and restore traffic balance');
    Atlas2Engine.simulateDryRun(plan);

    const ballots: ConsensusBallot[] = [
      ByzantineConsensusEngine.signBallot(inc.id, squad.agents[0], 'approve', 0.98, 'DAG execution plan validated'),
      ByzantineConsensusEngine.signBallot(inc.id, squad.agents[1], 'approve', 0.94, 'Telemetry thresholds satisfied'),
      ByzantineConsensusEngine.signBallot(inc.id, squad.agents[2], 'approve', 0.96, 'Zero-trust containment verified'),
      ByzantineConsensusEngine.signBallot(inc.id, squad.agents[3], 'approve', 0.91, 'Schema integrity preserved'),
      ByzantineConsensusEngine.signBallot(inc.id, squad.agents[4], 'approve', 0.89, 'FinOps cost ceiling honored'),
    ];
    inc.ballots = ballots;

    const quorum = ByzantineConsensusEngine.evaluateQuorum(inc.id, squad, ballots);
    inc.quorum = quorum;
    OpsCanvasManager.updateLiveFields(inc.canvas, {
      activeQuorumRatio: quorum.weightedApprovalRatio,
    });
    HuddleManager.synthesizeAndSyncToCanvas(huddle, inc.canvas);

    setCurrentIncident({ ...inc });
    setIsRunning(false);
  }, [selectedPreset]);

  // Authorize Sandboxed Execution
  const handleExecutePlan = useCallback(async () => {
    if (!currentIncident.executionPlan || isExecutingRef.current) return;

    isExecutingRef.current = true;
    setIsExecuting(true);
    setHumanApproved(true);
    try {
      Atlas2Engine.transitionPhase(currentIncident, 'executing');
      setCurrentIncident({ ...currentIncident });

      const executor = new SandboxExecutor();
      const result = await executor.executePlan(currentIncident.executionPlan, true);

      if (result.allSucceeded) {
        Atlas2Engine.transitionPhase(currentIncident, 'verifying');
        setCurrentIncident({ ...currentIncident });
        await new Promise((r) => setTimeout(r, 400));

        Atlas2Engine.transitionPhase(currentIncident, 'resolved');
        currentIncident.resolvedAt = Date.now();
        OpsCanvasManager.updateLiveFields(currentIncident.canvas, {
          trafficImpactPercent: 0,
          errorRateSpike: 0.02,
        });
        // Mark action items verified
        for (const item of currentIncident.canvas.actionItems) {
          item.status = 'verified';
        }
      } else {
        Atlas2Engine.transitionPhase(currentIncident, 'escalated_human');
      }
    } catch (err) {
      console.error('Failed executing sandboxed mitigation plan:', err);
      try {
        Atlas2Engine.transitionPhase(currentIncident, 'escalated_human');
      } catch {}
    } finally {
      isExecutingRef.current = false;
      setIsExecuting(false);
      setCurrentIncident({ ...currentIncident });
    }
  }, [currentIncident]);

  // Export SOC2 Audit Certificate
  const handleExportCertificate = () => {
    const ledger = new CryptographicAuditLedger(currentIncident.id);
    ledger.recordBlock(currentIncident.id, 'DELIBERATION_TURN', { turnsCount: currentIncident.deliberationTurns.length });
    ledger.recordBlock(currentIncident.id, 'QUORUM_EVALUATION', { quorum: currentIncident.quorum });
    const cert = ledger.generateComplianceCertificate(currentIncident.id);

    const blob = new Blob([JSON.stringify(cert, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-certificate-${currentIncident.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen relative flex flex-col font-sans">
      {/* Dynamic Canvas Neural Mesh Background */}
      <ShaderBackground />

      {/* Header Landmark */}
      <Header
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onOpenShortcuts={() => setIsShortcutsOpen(true)}
      />

      {/* Main Landmark */}
      <main id="main" tabIndex={-1} role="main" className="flex-1 max-w-7xl w-full mx-auto px-4 lg:px-8 py-6 relative z-10 focus:outline-none">
        {/* Back Link on Secondary Tabs */}
        {activeTab !== 'simulator' && (
          <div className="mb-6 flex items-center justify-between">
            <button
              onClick={() => setActiveTab('simulator')}
              className="touch-target inline-flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-[#00f0ff] transition-colors"
            >
              <span>←</span>
              <span>Back to War Room Simulator</span>
            </button>
            <span className="text-[11px] font-mono text-slate-500 uppercase">
              Section: {activeTab}
            </span>
          </div>
        )}

        {/* Hero Section (Command Center Showcase) */}
        {activeTab === 'simulator' && (
          <HeroSection
            onStartSimulation={() => {
              setActiveTab('simulator');
              handleTriggerIncident();
            }}
            onViewBattlecard={() => setActiveTab('battlecard')}
          />
        )}

        {/* Tab Switcher Content */}
        {activeTab === 'simulator' && (
          <>
            {/* Incident Commander Controls */}
            <IncidentCommander
              selectedPreset={selectedPreset}
              onSelectPreset={(preset) => {
                setSelectedPreset(preset);
                handleReset(preset);
              }}
              onTriggerIncident={handleTriggerIncident}
              isRunning={isRunning}
              onReset={() => handleReset()}
            />

            {/* Deliberation Feed & Consensus Ballot Box (Side-by-side) */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              <DeliberationFeed
                turns={currentIncident.deliberationTurns}
                activePhase={currentIncident.status}
              />

              <ConsensusBallotBox
                ballots={currentIncident.ballots}
                quorum={currentIncident.quorum}
                humanApproved={humanApproved}
                onToggleHumanApproval={() => setHumanApproved(!humanApproved)}
                onExecutePlan={handleExecutePlan}
                isExecuting={isExecuting}
                incidentStatus={currentIncident.status}
              />
            </div>

            {/* Live Ops Canvas View */}
            <OpsCanvasView
              canvas={currentIncident.canvas}
              executionPlan={currentIncident.executionPlan}
              onExportCertificate={handleExportCertificate}
            />

            {/* Synthetic Multi-Agent Huddle Room */}
            <SyntheticHuddle
              huddle={currentIncident.huddle}
              onSynthesizeBrief={() => {
                if (currentIncident.huddle) {
                  HuddleManager.synthesizeAndSyncToCanvas(currentIncident.huddle, currentIncident.canvas);
                  setCurrentIncident({ ...currentIncident });
                }
              }}
            />
          </>
        )}

        {activeTab === 'atlas' && <AtlasVisualizer />}

        {activeTab === 'battlecard' && <BattlecardSection />}

        {activeTab === 'roi' && <RoiCalculator />}

        {activeTab === 'wcag' && <WcagInspector />}
      </main>

      {/* Keyboard Shortcuts Modal */}
      <KeyboardShortcutsModal
        isOpen={isShortcutsOpen}
        onClose={() => setIsShortcutsOpen(false)}
      />

      {/* Footer Landmark */}
      <footer role="contentinfo" className="w-full border-t border-white/10 py-6 px-4 lg:px-8 text-center text-xs text-slate-500 relative z-10 bg-[#060913]/90">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div>
            <span className="font-bold text-slate-300">ACR OpsRoom</span> · Apache-2.0 License · Agentic Chat Rooms Ecosystem (Repo #21)
          </div>
          <div className="flex items-center gap-4 text-[11px]">
            <a href="http://localhost:3300/ACR/acr-opsroom" className="hover:text-[#00f0ff] transition-colors">Local Gitea</a>
            <span>·</span>
            <button onClick={() => setActiveTab('wcag')} className="hover:text-[#00f0ff] transition-colors">WCAG 2.2 AAA Audit</button>
            <span>·</span>
            <button onClick={() => setIsShortcutsOpen(true)} className="hover:text-[#00f0ff] transition-colors">Keyboard Shortcuts (?)</button>
          </div>
        </div>
      </footer>
    </div>
  );
};
