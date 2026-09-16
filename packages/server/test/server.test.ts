import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { OpsRoomServer } from '../src/server.js';

describe('OpsRoomServer Endpoints', () => {
  let server: OpsRoomServer;
  const testPort = 20999;

  before(async () => {
    server = new OpsRoomServer({ port: testPort });
    await server.start();
  });

  after(async () => {
    await server.stop();
  });

  function makeRequest(
    method: string, 
    path: string, 
    body?: Record<string, unknown>
  ): Promise<{ status: number; data: any }> {
    return new Promise((resolve, reject) => {
      const payload = body ? JSON.stringify(body) : undefined;
      const req = http.request({
        hostname: '127.0.0.1',
        port: testPort,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
        }
      }, (res) => {
        let raw = '';
        res.on('data', chunk => { raw += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode || 500, data: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode || 500, data: raw });
          }
        });
      });

      req.on('error', reject);
      if (payload) {
        req.write(payload);
      }
      req.end();
    });
  }

  test('GET /health returns online status and active metrics', async () => {
    const res = await makeRequest('GET', '/health');
    assert.equal(res.status, 200);
    assert.equal(res.data.status, 'online');
    assert.equal(res.data.service, 'acr-opsroom');
  });

  test('GET /api/v1/opsroom/battlecard returns competitive feature matrix', async () => {
    const res = await makeRequest('GET', '/api/v1/opsroom/battlecard');
    assert.equal(res.status, 200);
    assert.ok(res.data.features.length >= 4);
    assert.ok(res.data.features[0].category.includes('Autonomy'));
  });

  test('POST /api/v1/opsroom/incidents/trigger creates and routes incident', async () => {
    const res = await makeRequest('POST', '/api/v1/opsroom/incidents/trigger', {
      title: 'Database Split-Brain Warning',
      description: 'Follower db-read-3 lagged by 9400ms exceeding threshold',
      telemetry: [15, 14, 18, 16, 850]
    });

    assert.equal(res.status, 201);
    assert.ok(res.data.incident.id.startsWith('inc-'));
    assert.equal(res.data.incident.severity, 'P0');
    assert.ok(res.data.routing.squadId.includes('sre'));

    const incidentId = res.data.incident.id;

    // Test GET incident
    const getRes = await makeRequest('GET', `/api/v1/opsroom/incidents/${incidentId}`);
    assert.equal(getRes.status, 200);
    assert.equal(getRes.data.id, incidentId);

    // Test POST deliberation turn
    const turnRes = await makeRequest('POST', `/api/v1/opsroom/incidents/${incidentId}/deliberate`, {
      reasoning: 'Re-routing read queries to db-read-1 while syncing follower',
      confidence: 0.94,
      proposedActions: [
        {
          toolName: 'reroute_traffic',
          serverName: 'acr-sre-mcp',
          parameters: { target: 'db-read-1' },
          riskLevel: 'medium'
        }
      ]
    });
    assert.equal(turnRes.status, 200);
    assert.equal(turnRes.data.turn.turnIndex, 1);

    // Test POST consensus vote
    const voteRes = await makeRequest('POST', `/api/v1/opsroom/incidents/${incidentId}/vote`, {
      decision: 'approve',
      justification: 'Traffic reroute isolated in sandbox',
      confidence: 0.95
    });
    assert.equal(voteRes.status, 200);
    assert.equal(voteRes.data.totalBallots, 1);

    // Test POST evaluate quorum
    const quorumRes = await makeRequest('POST', `/api/v1/opsroom/incidents/${incidentId}/evaluate-quorum`);
    assert.equal(quorumRes.status, 200);
    assert.ok(quorumRes.data.quorum.merkleRootHash.length === 64);

    // Test GET audit certificate
    const certRes = await makeRequest('GET', `/api/v1/opsroom/incidents/${incidentId}/audit-cert`);
    assert.equal(certRes.status, 200);
    assert.equal(certRes.data.complianceValid, true);
    assert.equal(certRes.data.signatureStandard, 'Ed25519-ACR-V1');
  });
});
