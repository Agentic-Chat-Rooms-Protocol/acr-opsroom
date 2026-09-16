/**
 * ACR OpsRoom - Production-Grade REST & SSE Server
 * Default port: 20447
 * Provides autonomous war room coordination, ML routing, Byzantine consensus,
 * and zero-trust sandboxed execution.
 */
import http from 'node:http';
import { OpsIncident } from '@acr-js/opsroom-core';
export interface ServerConfig {
    port?: number;
    metaMcpPort?: number;
}
export declare class OpsRoomServer {
    private port;
    private server;
    private incidents;
    private ledgers;
    private sseClients;
    private defaultSquad;
    private sandboxExecutor;
    constructor(config?: ServerConfig);
    getIncident(id: string): OpsIncident | undefined;
    getAllIncidents(): OpsIncident[];
    broadcastEvent(eventType: string, data: Record<string, unknown>): void;
    createHttpApp(): http.Server;
    start(): Promise<number>;
    stop(): Promise<void>;
    private parseJsonBody;
}
//# sourceMappingURL=server.d.ts.map