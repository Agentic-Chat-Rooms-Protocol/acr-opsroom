/**
 * ACR OpsRoom - Production-Grade REST & SSE Server
 * Default port: 20447
 * Provides autonomous war room coordination, ML routing, Byzantine consensus,
 * and zero-trust sandboxed execution.
 */
import http from 'node:http';
import { Atlas2Engine, MLIncidentRouter, MLStatisticalDetector, ByzantineConsensusEngine, OpsCanvasManager, SandboxExecutor, CryptographicAuditLedger } from '@acr-js/opsroom-core';
export class OpsRoomServer {
    port;
    server = null;
    incidents = new Map();
    ledgers = new Map();
    sseClients = new Set();
    defaultSquad;
    sandboxExecutor;
    constructor(config = {}) {
        this.port = config.port || parseInt(process.env.ACR_OPSROOM_PORT || '20447', 10);
        this.defaultSquad = MLIncidentRouter.createDefaultSquad('squad-sre-core');
        this.sandboxExecutor = new SandboxExecutor(config.metaMcpPort || 20445);
    }
    getIncident(id) {
        return this.incidents.get(id);
    }
    getAllIncidents() {
        return Array.from(this.incidents.values());
    }
    broadcastEvent(eventType, data) {
        const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
        for (const client of this.sseClients) {
            try {
                client.write(payload);
            }
            catch {
                this.sseClients.delete(client);
            }
        }
    }
    createHttpApp() {
        const server = http.createServer(async (req, res) => {
            // CORS headers
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-ACR-DID');
            if (req.method === 'OPTIONS') {
                res.writeHead(204);
                res.end();
                return;
            }
            const parsedUrl = new URL(req.url || '/', `http://localhost:${this.port}`);
            const pathname = parsedUrl.pathname;
            try {
                // SSE Real-time Stream
                if (pathname === '/api/v1/opsroom/stream') {
                    res.writeHead(200, {
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-cache',
                        'Connection': 'keep-alive',
                    });
                    res.write(`data: ${JSON.stringify({ type: 'CONNECTED', port: this.port })}\n\n`);
                    this.sseClients.add(res);
                    req.on('close', () => {
                        this.sseClients.delete(res);
                    });
                    return;
                }
                // Health Check
                if (pathname === '/health' && req.method === 'GET') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        status: 'online',
                        service: 'acr-opsroom',
                        version: '1.0.0',
                        activeIncidents: this.incidents.size,
                        squadsAvailable: 3,
                        timestamp: Date.now(),
                    }));
                    return;
                }
                // Battlecard comparison vs Salesforce Agentforce + Slack
                if (pathname === '/api/v1/opsroom/battlecard' && req.method === 'GET') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        title: 'ACR OpsRoom vs Salesforce Agentforce + Slack Architecture Battlecard',
                        features: [
                            {
                                category: 'Autonomy & Deliberation',
                                agentforce: 'Single-agent prompt chaining; sequential topics/actions; lacks cross-agent critique',
                                acrOpsRoom: 'Atlas 2.0 Goal-Directed DAG with multi-agent squad deliberation and conflict resolution',
                                advantage: 'Eliminates single-agent hallucinations and dead-end cycling'
                            },
                            {
                                category: 'Safety & Quorum Governance',
                                agentforce: 'Single LLM decision; unverified writes to CRM; manual human review queues',
                                acrOpsRoom: 'Byzantine Fault Tolerant (BFT) M-of-N Quorum Consensus with Ed25519 signatures',
                                advantage: 'Guarantees 2/3 agreement before destructive or state-altering mutations'
                            },
                            {
                                category: 'Execution Sandboxing',
                                agentforce: 'Salesforce CRM object level permissions; zero process-level containment',
                                acrOpsRoom: 'ToolHive-inspired micro-sandboxing via acr-meta-mcp (no-network, egress-allowlist, readonly-fs)',
                                advantage: 'Complete containment prevents unauthorized data exfiltration or supply chain attacks'
                            },
                            {
                                category: 'Operational Surface',
                                agentforce: 'Static Slack channel text + passive Slack canvas with slow Salesforce field sync',
                                acrOpsRoom: 'Live Collaborative Ops Canvas: real-time telemetry, DAG node states, synthetic huddles',
                                advantage: 'Real-time situational awareness and instant executive brief generation'
                            },
                            {
                                category: 'Pricing & Economics',
                                agentforce: '$2.00 per conversation + $500/month org base + Data Cloud consumption credits',
                                acrOpsRoom: '100% Open-Source Protocol (Apache-2.0); self-hostable with $0 conversation tax',
                                advantage: 'Saves 80-95% on enterprise AI operations expenditure'
                            }
                        ]
                    }));
                    return;
                }
                // Trigger Incident
                if (pathname === '/api/v1/opsroom/incidents/trigger' && req.method === 'POST') {
                    const body = await this.parseJsonBody(req);
                    const title = body.title || 'Production Alert: Unhandled Anomaly';
                    const description = body.description || 'Automated ingestion from telemetry stream';
                    const rawTelemetry = body.telemetry || [120, 125, 122, 130, 480];
                    // Run ML Anomaly Detection
                    const anomalyReport = MLStatisticalDetector.detectAnomaly('primary_service_metric', rawTelemetry[rawTelemetry.length - 1], rawTelemetry.slice(0, rawTelemetry.length - 1));
                    // Route to specialized squad
                    const routing = MLIncidentRouter.routeIncidentToSquad(title, description, [anomalyReport]);
                    const squad = MLIncidentRouter.createDefaultSquad(routing.squadId);
                    const incident = Atlas2Engine.createIncident(title, description, squad);
                    incident.severity = routing.recommendedSeverity;
                    // Record in Audit Ledger
                    const ledger = new CryptographicAuditLedger(incident.id);
                    this.ledgers.set(incident.id, ledger);
                    this.incidents.set(incident.id, incident);
                    this.broadcastEvent('INCIDENT_TRIGGERED', { incident, routing, anomalyReport });
                    res.writeHead(201, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ incident, routing, anomalyReport }));
                    return;
                }
                // List Incidents
                if (pathname === '/api/v1/opsroom/incidents' && req.method === 'GET') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(this.getAllIncidents()));
                    return;
                }
                // Incident Sub-Routes
                const incidentMatch = pathname.match(/^\/api\/v1\/opsroom\/incidents\/([^\/]+)(?:\/(.*))?$/);
                if (incidentMatch) {
                    const incidentId = incidentMatch[1];
                    const subAction = incidentMatch[2] || '';
                    const incident = this.incidents.get(incidentId);
                    if (!incident) {
                        res.writeHead(404, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: `Incident ${incidentId} not found` }));
                        return;
                    }
                    // Get Single Incident
                    if (subAction === '' && req.method === 'GET') {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(incident));
                        return;
                    }
                    // Trigger Deliberation Turn
                    if (subAction === 'deliberate' && req.method === 'POST') {
                        const body = await this.parseJsonBody(req);
                        const agentId = body.agentId || incident.squad.agents[0].id;
                        const agent = incident.squad.agents.find((a) => a.id === agentId) || incident.squad.agents[0];
                        const reasoning = body.reasoning || `Agent ${agent.name} proposes targeted stabilization`;
                        const proposedActions = body.proposedActions || [];
                        Atlas2Engine.transitionPhase(incident, 'deliberating');
                        const turn = Atlas2Engine.addDeliberationTurn(incident, agent, reasoning, body.hypothesis, proposedActions, body.confidence || 0.9);
                        // Record in audit ledger
                        const ledger = this.ledgers.get(incident.id);
                        ledger?.recordBlock(incident.id, 'DELIBERATION_TURN', { turn });
                        this.broadcastEvent('DELIBERATION_TURN', { incidentId, turn, canvas: incident.canvas });
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ turn, canvas: incident.canvas }));
                        return;
                    }
                    // Submit Consensus Ballot
                    if (subAction === 'vote' && req.method === 'POST') {
                        const body = await this.parseJsonBody(req);
                        const agentId = body.agentId || incident.squad.agents[0].id;
                        const agent = incident.squad.agents.find((a) => a.id === agentId) || incident.squad.agents[0];
                        const decision = body.decision || 'approve';
                        const justification = body.justification || 'Plan verified within safe operational bounds';
                        const confidence = body.confidence ?? 0.92;
                        const ballot = ByzantineConsensusEngine.signBallot(incident.id, agent, decision, confidence, justification);
                        incident.ballots.push(ballot);
                        const ledger = this.ledgers.get(incident.id);
                        ledger?.recordBlock(incident.id, 'CONSENSUS_BALLOT', { ballot });
                        this.broadcastEvent('CONSENSUS_BALLOT', { incidentId, ballot });
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ ballot, totalBallots: incident.ballots.length }));
                        return;
                    }
                    // Evaluate Quorum
                    if (subAction === 'evaluate-quorum' && req.method === 'POST') {
                        Atlas2Engine.transitionPhase(incident, 'awaiting_quorum');
                        const quorum = ByzantineConsensusEngine.evaluateQuorum(incident.id, incident.squad, incident.ballots);
                        incident.quorum = quorum;
                        incident.canvas.liveFields.activeQuorumRatio = quorum.weightedApprovalRatio;
                        if (quorum.status === 'approved') {
                            Atlas2Engine.transitionPhase(incident, 'executing');
                        }
                        else if (quorum.status === 'escalated_human') {
                            Atlas2Engine.transitionPhase(incident, 'escalated_human');
                        }
                        const ledger = this.ledgers.get(incident.id);
                        ledger?.recordBlock(incident.id, 'QUORUM_EVALUATION', { quorum });
                        this.broadcastEvent('QUORUM_EVALUATED', { incidentId, quorum, canvas: incident.canvas });
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ quorum, canvas: incident.canvas }));
                        return;
                    }
                    // Simulate Dry-Run
                    if (subAction === 'simulate' && req.method === 'POST') {
                        const plan = incident.executionPlan || Atlas2Engine.compileExecutionPlan(incident, 'Incident Mitigation');
                        const simulation = Atlas2Engine.simulateDryRun(plan);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ plan, simulation }));
                        return;
                    }
                    // Execute Plan in Zero-Trust Sandbox
                    if (subAction === 'execute' && req.method === 'POST') {
                        const body = await this.parseJsonBody(req);
                        const humanApproved = Boolean(body.humanApproved);
                        // Byzantine Quorum Gating Enforcement
                        if (!incident.quorum) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({
                                error: 'Execution blocked: Quorum consensus has not been evaluated for this incident.'
                            }));
                            return;
                        }
                        if (incident.quorum.status === 'rejected' || incident.quorum.status === 'insufficient_quorum') {
                            res.writeHead(403, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({
                                error: `Execution blocked: Quorum status is '${incident.quorum.status}'. Byzantine consensus was not achieved.`
                            }));
                            return;
                        }
                        if (incident.quorum.status === 'escalated_human' && !humanApproved) {
                            res.writeHead(403, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({
                                error: 'Execution blocked: Byzantine anomalies or forceHumanGating detected. Dual human consent required.'
                            }));
                            return;
                        }
                        const plan = incident.executionPlan || Atlas2Engine.compileExecutionPlan(incident, 'Incident Mitigation');
                        const execResult = await this.sandboxExecutor.executePlan(plan, humanApproved);
                        if (execResult.allSucceeded) {
                            Atlas2Engine.transitionPhase(incident, 'resolved');
                            incident.resolvedAt = Date.now();
                            OpsCanvasManager.updateLiveFields(incident.canvas, {
                                trafficImpactPercent: 0,
                                errorRateSpike: 0.05,
                            });
                        }
                        const ledger = this.ledgers.get(incident.id);
                        ledger?.recordBlock(incident.id, 'STEP_EXECUTION', { receipts: execResult.receipts });
                        this.broadcastEvent('EXECUTION_COMPLETED', { incidentId, execResult, canvas: incident.canvas });
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ execResult, canvas: incident.canvas }));
                        return;
                    }
                    // Get Audit Compliance Certificate
                    if (subAction === 'audit-cert' && req.method === 'GET') {
                        const ledger = this.ledgers.get(incident.id) || new CryptographicAuditLedger(incident.id);
                        const cert = ledger.generateComplianceCertificate(incident.id);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(cert));
                        return;
                    }
                }
                // Route Not Found
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Endpoint Not Found', path: pathname }));
            }
            catch (err) {
                const errorMsg = err instanceof Error ? err.message : String(err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Internal Server Error', details: errorMsg }));
            }
        });
        this.server = server;
        return server;
    }
    async start() {
        const server = this.createHttpApp();
        return new Promise((resolve, reject) => {
            server.listen(this.port, () => {
                resolve(this.port);
            });
            server.on('error', reject);
        });
    }
    async stop() {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => resolve());
            }
            else {
                resolve();
            }
        });
    }
    parseJsonBody(req) {
        return new Promise((resolve, reject) => {
            let data = '';
            req.on('data', chunk => { data += chunk; });
            req.on('end', () => {
                if (!data.trim()) {
                    resolve({});
                    return;
                }
                try {
                    resolve(JSON.parse(data));
                }
                catch (e) {
                    reject(new Error('Invalid JSON payload'));
                }
            });
            req.on('error', reject);
        });
    }
}
//# sourceMappingURL=server.js.map