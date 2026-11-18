/**
 * ACR OpsRoom - Production-Grade REST & SSE Server
 * Default port: 20447
 * Provides autonomous war room coordination, ML routing, Byzantine consensus,
 * and zero-trust sandboxed execution.
 */

import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  OpsIncident,
  Atlas2Engine,
  MLIncidentRouter,
  MLStatisticalDetector,
  ByzantineConsensusEngine,
  OpsCanvasManager,
  HuddleManager,
  SandboxExecutor,
  CryptographicAuditLedger,
  ConsensusBallot,
  AgentSquad,
  AgentProfile,
  AcrCoreClient,
  CANONICAL_WORKFLOWS,
  findCanonicalWorkflow,
  toWorkflowContractDefinition,
  exportWorkflowContract,
} from '@acr-js/opsroom-core';

const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB

class PayloadTooLargeError extends Error {
  constructor() {
    super('Request body exceeds 1 MiB limit');
    this.name = 'PayloadTooLargeError';
  }
}

class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestError';
  }
}

export interface ServerConfig {
  port?: number;
  host?: string;
  apiToken?: string;
  requireAuth?: boolean;
  allowedHosts?: string[];
  allowedOrigins?: string[];
  metaMcpPort?: number;
  coreBaseUrl?: string;
  coreApiToken?: string;
  coreTokenFilePath?: string;
}

export class OpsRoomServer {
  private port: number;
  public readonly host: string;
  public readonly apiToken: string;
  private readonly extraAllowedHosts: string[];
  private readonly extraAllowedOrigins: string[];
  private server: http.Server | null = null;
  private incidents = new Map<string, OpsIncident>();
  private ledgers = new Map<string, CryptographicAuditLedger>();
  private sseClients = new Set<http.ServerResponse>();
  private defaultSquad: AgentSquad;
  private sandboxExecutor: SandboxExecutor;
  private coreClient: AcrCoreClient;

  constructor(config: ServerConfig = {}) {
    this.port = config.port || parseInt(process.env.ACR_OPSROOM_PORT || '20447', 10);
    this.host = config.host || process.env.ACR_OPSROOM_HOST || '127.0.0.1';
    const configuredToken = (config.apiToken ?? process.env.ACR_API_TOKEN ?? '').trim();
    this.apiToken = configuredToken || (config.requireAuth ? randomBytes(24).toString('hex') : '');
    this.extraAllowedHosts = [
      ...(config.allowedHosts ??
        (process.env.ACR_OPSROOM_ALLOWED_HOSTS || '').split(',').map((s) => s.trim()).filter(Boolean)),
    ];
    if (
      this.host &&
      !OpsRoomServer.isLoopbackHost(this.host) &&
      this.host !== '0.0.0.0' &&
      this.host !== '::'
    ) {
      this.extraAllowedHosts.push(this.host);
    }
    this.extraAllowedOrigins =
      config.allowedOrigins ??
      (process.env.ACR_OPSROOM_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    this.defaultSquad = MLIncidentRouter.createDefaultSquad('squad-sre-core');
    this.sandboxExecutor = new SandboxExecutor(config.metaMcpPort || 20445);
    this.coreClient = new AcrCoreClient({
      baseUrl: config.coreBaseUrl,
      apiToken: config.coreApiToken,
      tokenFilePath: config.coreTokenFilePath,
    });
  }

  public getCoreClient(): AcrCoreClient {
    return this.coreClient;
  }

  private static isLoopbackHost(host: string): boolean {
    const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
    return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1';
  }

  private static extractHostname(hostHeader: string): string {
    const trimmed = hostHeader.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('[')) {
      const endBracket = trimmed.indexOf(']');
      if (endBracket !== -1) {
        return trimmed.slice(1, endBracket).toLowerCase();
      }
    }
    const colonIdx = trimmed.lastIndexOf(':');
    if (colonIdx > 0 && trimmed.indexOf(':') === colonIdx) {
      return trimmed.slice(0, colonIdx).toLowerCase();
    }
    return trimmed.toLowerCase();
  }

  private isHostAllowed(hostHeader: string | undefined): boolean {
    if (!hostHeader) return true;
    const hostname = OpsRoomServer.extractHostname(hostHeader);
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return true;
    }
    return this.extraAllowedHosts.some(
      (allowed) => OpsRoomServer.extractHostname(allowed) === hostname
    );
  }

  private isOriginAllowed(origin: string): boolean {
    if (!origin || origin === 'null') return false;
    if (this.extraAllowedOrigins.some((o) => o.toLowerCase() === origin.toLowerCase())) {
      return true;
    }
    try {
      const u = new URL(origin);
      const h = u.hostname.toLowerCase();
      if (u.protocol === 'https:' && (h === 'agentchatrooms.dev' || h === 'www.agentchatrooms.dev')) {
        return true;
      }
      if ((u.protocol === 'http:' || u.protocol === 'https:') && (h === 'localhost' || h === '127.0.0.1' || h === '[::1]')) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  private hasValidBearerToken(req: http.IncomingMessage): boolean {
    if (!this.apiToken) return true;
    const authHeader = req.headers.authorization;
    if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      return false;
    }
    const provided = authHeader.slice('Bearer '.length).trim();
    if (!provided) return false;
    const a = Buffer.from(provided, 'utf8');
    const b = Buffer.from(this.apiToken, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private sendJson(
    res: http.ServerResponse,
    statusCode: number,
    data: unknown,
    allowedOrigin?: string
  ): void {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Vary': 'Origin',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-ACR-DID, Access-Control-Request-Private-Network',
    };
    if (allowedOrigin) {
      headers['Access-Control-Allow-Origin'] = allowedOrigin;
    }
    res.writeHead(statusCode, headers);
    res.end(JSON.stringify(data));
  }

  public getIncident(id: string): OpsIncident | undefined {
    return this.incidents.get(id);
  }

  public getAllIncidents(): OpsIncident[] {
    return Array.from(this.incidents.values());
  }

  public broadcastEvent(eventType: string, data: Record<string, unknown>): void {
    const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.sseClients) {
      try {
        client.write(payload);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }

  public createHttpApp(): http.Server {
    const server = http.createServer(async (req, res) => {
      if (!this.isHostAllowed(req.headers.host)) {
        return this.sendJson(res, 403, { error: 'FORBIDDEN_HOST' });
      }

      const origin = req.headers.origin;
      let validatedOrigin: string | undefined;
      if (origin !== undefined) {
        if (!this.isOriginAllowed(origin)) {
          return this.sendJson(res, 403, { error: 'FORBIDDEN_ORIGIN' });
        }
        validatedOrigin = origin;
      }

      if (req.method === 'OPTIONS') {
        if (!validatedOrigin) {
          return this.sendJson(res, 403, { error: 'ORIGIN_REQUIRED' });
        }
        res.writeHead(204, {
          'Vary': 'Origin',
          'Access-Control-Allow-Origin': validatedOrigin,
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-ACR-DID, Access-Control-Request-Private-Network',
          'Access-Control-Allow-Private-Network': 'true',
        });
        res.end();
        return;
      }

      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
      const pathname = parsedUrl.pathname;

      try {
        // Public Health Check
        if (pathname === '/health' && req.method === 'GET') {
          return this.sendJson(res, 200, {
            status: 'online',
            service: 'acr-opsroom',
            version: '1.0.0',
            activeIncidents: this.incidents.size,
            squadsAvailable: 3,
            timestamp: Date.now(),
          }, validatedOrigin);
        }

        // Enforce Bearer auth on all non-public endpoints when apiToken / ACR_API_TOKEN is configured
        if (!this.hasValidBearerToken(req)) {
          return this.sendJson(res, 401, { error: 'UNAUTHORIZED: valid Bearer ACR_API_TOKEN required.' }, validatedOrigin);
        }

        // SSE Real-time Stream
        if (pathname === '/api/v1/opsroom/stream') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Vary': 'Origin',
            ...(validatedOrigin ? { 'Access-Control-Allow-Origin': validatedOrigin } : {}),
          });
          res.write(`data: ${JSON.stringify({ type: 'CONNECTED', port: this.port })}\n\n`);
          this.sseClients.add(res);

          req.on('close', () => {
            this.sseClients.delete(res);
          });
          return;
        }

        // Battlecard comparison vs Salesforce Agentforce + Slack
        if (pathname === '/api/v1/opsroom/battlecard' && req.method === 'GET') {
          return this.sendJson(res, 200, {
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
          }, validatedOrigin);
        }

        // Canonical 18 Workflows Catalog & Contract
        if (pathname === '/api/v1/opsroom/workflows' && req.method === 'GET') {
          const contract = exportWorkflowContract('opsroom-local', { executionSupported: true });
          return this.sendJson(res, 200, {
            schemaVersion: contract.schemaVersion,
            count: CANONICAL_WORKFLOWS.length,
            workflows: CANONICAL_WORKFLOWS,
            contract: contract.workflows.map((w) => ({ ...w, execution_supported: true })),
          }, validatedOrigin);
        }

        const workflowMatch = pathname.match(/^\/api\/v1\/opsroom\/workflows\/([^\/]+)$/);
        if (workflowMatch && req.method === 'GET') {
          const requestedId = decodeURIComponent(workflowMatch[1]);
          const wf = findCanonicalWorkflow(requestedId);
          if (!wf) {
            return this.sendJson(res, 404, { error: `Workflow '${requestedId}' not found` }, validatedOrigin);
          }
          return this.sendJson(res, 200, {
            workflow: wf,
            contract: toWorkflowContractDefinition(wf, { executionSupported: true }),
          }, validatedOrigin);
        }

        // Trigger Incident
        if (pathname === '/api/v1/opsroom/incidents/trigger' && req.method === 'POST') {
          const body = await this.parseJsonBody(req);
          const title = body.title || 'Production Alert: Unhandled Anomaly';
          const description = body.description || 'Automated ingestion from telemetry stream';
          const rawTelemetry = body.telemetry || [120, 125, 122, 130, 480];
          const workflowType = typeof body.workflowType === 'string' ? body.workflowType : undefined;
          const workflowConfig =
            body.workflowConfig !== undefined &&
            typeof body.workflowConfig === 'object' &&
            body.workflowConfig !== null &&
            !Array.isArray(body.workflowConfig)
              ? (body.workflowConfig as Record<string, unknown>)
              : undefined;

          if (body.workflowConfig !== undefined && workflowConfig === undefined) {
            return this.sendJson(res, 400, { error: 'workflowConfig must be a plain object' }, validatedOrigin);
          }

          // Run ML Anomaly Detection
          const anomalyReport = MLStatisticalDetector.detectAnomaly(
            'primary_service_metric',
            rawTelemetry[rawTelemetry.length - 1],
            rawTelemetry.slice(0, rawTelemetry.length - 1)
          );

          // Route to specialized squad
          const routing = MLIncidentRouter.routeIncidentToSquad(title, description, [anomalyReport]);
          const squad = MLIncidentRouter.createDefaultSquad(routing.squadId);

          let incident: OpsIncident;
          try {
            incident = Atlas2Engine.createIncident(title, description, squad, {
              workflowType,
              workflowConfig,
            });
          } catch (wfErr: unknown) {
            const msg = wfErr instanceof Error ? wfErr.message : String(wfErr);
            return this.sendJson(res, 400, { error: msg }, validatedOrigin);
          }
          if (!workflowType) {
            incident.severity = routing.recommendedSeverity;
          }

          // Record in Audit Ledger
          const ledger = new CryptographicAuditLedger(incident.id);
          this.ledgers.set(incident.id, ledger);
          this.incidents.set(incident.id, incident);

          this.broadcastEvent('INCIDENT_TRIGGERED', { incident, routing, anomalyReport });

          return this.sendJson(res, 201, { incident, routing, anomalyReport }, validatedOrigin);
        }

        // List Incidents
        if (pathname === '/api/v1/opsroom/incidents' && req.method === 'GET') {
          return this.sendJson(res, 200, this.getAllIncidents(), validatedOrigin);
        }

        // Incident Sub-Routes
        const incidentMatch = pathname.match(/^\/api\/v1\/opsroom\/incidents\/([^\/]+)(?:\/(.*))?$/);
        if (incidentMatch) {
          const incidentId = incidentMatch[1];
          const subAction = incidentMatch[2] || '';
          const incident = this.incidents.get(incidentId);

          if (!incident) {
            return this.sendJson(res, 404, { error: `Incident ${incidentId} not found` }, validatedOrigin);
          }

          // Get Single Incident
          if (subAction === '' && req.method === 'GET') {
            return this.sendJson(res, 200, incident, validatedOrigin);
          }

          // Trigger Deliberation Turn
          if (subAction === 'deliberate' && req.method === 'POST') {
            const body = await this.parseJsonBody(req);
            const agentId = body.agentId || incident.squad.agents[0].id;
            const agent = incident.squad.agents.find((a: AgentProfile) => a.id === agentId) || incident.squad.agents[0];
            const reasoning = body.reasoning || `Agent ${agent.name} proposes targeted stabilization`;
            const proposedActions = body.proposedActions || [];

            Atlas2Engine.transitionPhase(incident, 'deliberating');
            const turn = Atlas2Engine.addDeliberationTurn(
              incident,
              agent,
              reasoning,
              body.hypothesis,
              proposedActions,
              body.confidence || 0.9
            );

            // Record in audit ledger
            const ledger = this.ledgers.get(incident.id);
            ledger?.recordBlock(incident.id, 'DELIBERATION_TURN', { turn });

            this.broadcastEvent('DELIBERATION_TURN', { incidentId, turn, canvas: incident.canvas });

            return this.sendJson(res, 200, { turn, canvas: incident.canvas }, validatedOrigin);
          }

          // Submit Consensus Ballot
          if (subAction === 'vote' && req.method === 'POST') {
            const body = await this.parseJsonBody(req);
            const agentId = body.agentId || incident.squad.agents[0].id;
            const agent = incident.squad.agents.find((a: AgentProfile) => a.id === agentId) || incident.squad.agents[0];
            const decision = body.decision || 'approve';
            const justification = body.justification || 'Plan verified within safe operational bounds';
            const confidence = body.confidence ?? 0.92;

            const ballot = ByzantineConsensusEngine.signBallot(
              incident.id,
              agent,
              decision,
              confidence,
              justification
            );

            incident.ballots.push(ballot);
            const ledger = this.ledgers.get(incident.id);
            ledger?.recordBlock(incident.id, 'CONSENSUS_BALLOT', { ballot });

            this.broadcastEvent('CONSENSUS_BALLOT', { incidentId, ballot });

            return this.sendJson(res, 200, { ballot, totalBallots: incident.ballots.length }, validatedOrigin);
          }

          // Evaluate Quorum
          if (subAction === 'evaluate-quorum' && req.method === 'POST') {
            Atlas2Engine.transitionPhase(incident, 'awaiting_quorum');
            const quorum = ByzantineConsensusEngine.evaluateQuorum(
              incident.id,
              incident.squad,
              incident.ballots
            );

            incident.quorum = quorum;
            incident.canvas.liveFields.activeQuorumRatio = quorum.weightedApprovalRatio;

            if (quorum.status === 'approved') {
              Atlas2Engine.transitionPhase(incident, 'executing');
            } else if (quorum.status === 'escalated_human') {
              Atlas2Engine.transitionPhase(incident, 'escalated_human');
            }

            const ledger = this.ledgers.get(incident.id);
            ledger?.recordBlock(incident.id, 'QUORUM_EVALUATION', { quorum });

            this.broadcastEvent('QUORUM_EVALUATED', { incidentId, quorum, canvas: incident.canvas });

            return this.sendJson(res, 200, { quorum, canvas: incident.canvas }, validatedOrigin);
          }

          // Simulate Dry-Run
          if (subAction === 'simulate' && req.method === 'POST') {
            const plan = incident.executionPlan || Atlas2Engine.compileExecutionPlan(incident, 'Incident Mitigation');
            const simulation = Atlas2Engine.simulateDryRun(plan);

            return this.sendJson(res, 200, { plan, simulation }, validatedOrigin);
          }

          // Execute Plan in Zero-Trust Sandbox
          if (subAction === 'execute' && req.method === 'POST') {
            const body = await this.parseJsonBody(req);
            const humanApproved = Boolean(body.humanApproved);

            // Byzantine Quorum Gating Enforcement
            if (!incident.quorum) {
              return this.sendJson(res, 400, {
                error: 'Execution blocked: Quorum consensus has not been evaluated for this incident.',
              }, validatedOrigin);
            }

            if (incident.quorum.status === 'rejected' || incident.quorum.status === 'insufficient_quorum') {
              return this.sendJson(res, 403, {
                error: `Execution blocked: Quorum status is '${incident.quorum.status}'. Byzantine consensus was not achieved.`,
              }, validatedOrigin);
            }

            if (incident.quorum.status === 'escalated_human' && !humanApproved) {
              return this.sendJson(res, 403, {
                error: 'Execution blocked: Byzantine anomalies or forceHumanGating detected. Dual human consent required.',
              }, validatedOrigin);
            }

            const plan = incident.executionPlan || Atlas2Engine.compileExecutionPlan(incident, 'Incident Mitigation');
            Atlas2Engine.transitionPhase(incident, 'executing');
            this.broadcastEvent('EXECUTION_STARTED', { incidentId, status: incident.status });

            const execResult = await this.sandboxExecutor.executePlan(plan, humanApproved);

            if (execResult.allSucceeded) {
              Atlas2Engine.transitionPhase(incident, 'verifying');
              Atlas2Engine.transitionPhase(incident, 'resolved');
              incident.resolvedAt = Date.now();
              OpsCanvasManager.updateLiveFields(incident.canvas, {
                trafficImpactPercent: 0,
                errorRateSpike: 0.05,
              });
              for (const item of incident.canvas.actionItems) {
                item.status = 'verified';
              }
            } else {
              Atlas2Engine.transitionPhase(incident, 'escalated_human');
            }

            const ledger = this.ledgers.get(incident.id);
            ledger?.recordBlock(incident.id, 'STEP_EXECUTION', { receipts: execResult.receipts });

            this.broadcastEvent('EXECUTION_COMPLETED', { incidentId, execResult, canvas: incident.canvas, status: incident.status });

            return this.sendJson(res, 200, { execResult, canvas: incident.canvas, status: incident.status }, validatedOrigin);
          }

          // Get Audit Compliance Certificate
          if (subAction === 'audit-cert' && req.method === 'GET') {
            const ledger = this.ledgers.get(incident.id) || new CryptographicAuditLedger(incident.id);
            const cert = ledger.generateComplianceCertificate(incident.id);

            return this.sendJson(res, 200, cert, validatedOrigin);
          }
        }

        // Route Not Found
        return this.sendJson(res, 404, { error: 'Endpoint Not Found', path: pathname }, validatedOrigin);
      } catch (err: unknown) {
        if (err instanceof PayloadTooLargeError) {
          await this.drainAndRejectTooLarge(req);
          if (!res.writableEnded && !res.destroyed) {
            res.setHeader('Connection', 'close');
            this.sendJson(res, 413, { error: err.message }, validatedOrigin);
          }
          return;
        }
        if (err instanceof BadRequestError) {
          return this.sendJson(res, 400, { error: err.message }, validatedOrigin);
        }
        const errorMsg = err instanceof Error ? err.message : String(err);
        return this.sendJson(res, 500, { error: 'Internal Server Error', details: errorMsg }, validatedOrigin);
      }
    });

    this.server = server;
    return server;
  }

  public async start(): Promise<number> {
    if (!OpsRoomServer.isLoopbackHost(this.host) && !this.apiToken) {
      throw new Error(
        `Refusing non-loopback bind "${this.host}" without apiToken or ACR_API_TOKEN`
      );
    }
    const server = this.createHttpApp();
    return new Promise((resolve, reject) => {
      server.listen(this.port, this.host, () => {
        resolve(this.port);
      });
      server.on('error', reject);
    });
  }

  public async stop(): Promise<void> {
    this.sseClients.clear();
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
        this.server.closeAllConnections?.();
      } else {
        resolve();
      }
    });
  }

  private drainAndRejectTooLarge(req: http.IncomingMessage): Promise<void> {
    if (req.readableEnded || req.destroyed) {
      return Promise.resolve();
    }
    const existing = (req as { _drainTooLargePromise?: Promise<void> })._drainTooLargePromise;
    if (existing) {
      return existing;
    }
    const promise = new Promise<void>((resolve) => {
      let drained = 0;
      const maxDrain = MAX_BODY_BYTES * 8;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(stallTimer);
        req.removeListener('end', finish);
        req.removeListener('close', finish);
        req.removeListener('error', finish);
        resolve();
      };
      const stallTimer = setTimeout(() => {
        if (!req.destroyed) {
          req.destroy();
        }
        finish();
      }, 5000);
      stallTimer.unref?.();
      req.once('end', finish);
      req.once('close', finish);
      req.once('error', finish);
      req.on('data', (chunk: Buffer | string) => {
        drained += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
        if (drained > maxDrain && !req.destroyed) {
          req.destroy();
          finish();
        }
      });
      req.resume();
    });
    (req as { _drainTooLargePromise?: Promise<void> })._drainTooLargePromise = promise;
    return promise;
  }

  private async parseJsonBody(req: http.IncomingMessage): Promise<Record<string, any>> {
    const contentLength = Number(req.headers['content-length']);
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      await this.drainAndRejectTooLarge(req);
      throw new PayloadTooLargeError();
    }
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      let aborted = false;
      req.on('data', (chunk: Buffer | string) => {
        if (aborted) return;
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += buf.length;
        if (totalBytes > MAX_BODY_BYTES) {
          aborted = true;
          reject(new PayloadTooLargeError());
          return;
        }
        chunks.push(buf);
      });
      req.on('end', () => {
        if (aborted) return;
        if (chunks.length === 0) {
          resolve({});
          return;
        }
        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw.trim()) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new BadRequestError('Invalid JSON payload'));
        }
      });
      req.on('error', (err) => {
        if (!aborted) reject(err);
      });
    });
  }
}
