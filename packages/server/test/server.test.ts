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

  test('POST /api/v1/opsroom/incidents/:id/execute blocks execution when quorum is not approved', async () => {
    // 1. Create fresh incident
    const triggerRes = await makeRequest('POST', '/api/v1/opsroom/incidents/trigger', {
      title: 'Premature Execution Test',
      description: 'Attempting execution before quorum approval',
      telemetry: [10, 12, 11, 13, 100]
    });
    const incidentId = triggerRes.data.incident.id;

    // 2. Attempt execute without evaluating quorum -> 400
    const prematureRes = await makeRequest('POST', `/api/v1/opsroom/incidents/${incidentId}/execute`);
    assert.equal(prematureRes.status, 400);
    assert.ok(prematureRes.data.error.includes('Quorum consensus has not been evaluated'));

    // 3. Cast a reject vote and evaluate quorum
    await makeRequest('POST', `/api/v1/opsroom/incidents/${incidentId}/vote`, {
      decision: 'reject',
      justification: 'Critical safety violation detected in plan',
      confidence: 0.95
    });
    const quorumRes = await makeRequest('POST', `/api/v1/opsroom/incidents/${incidentId}/evaluate-quorum`);
    assert.notEqual(quorumRes.data.quorum.status, 'approved');

    // 4. Attempt execute with non-approved quorum -> 403
    const blockedRes = await makeRequest('POST', `/api/v1/opsroom/incidents/${incidentId}/execute`);
    assert.equal(blockedRes.status, 403);
    assert.ok(blockedRes.data.error.includes('Byzantine consensus was not achieved'));
  });

  test('POST /api/v1/opsroom/incidents/:id/execute succeeds when 67% Byzantine quorum is approved', async () => {
    // 1. Trigger incident
    const triggerRes = await makeRequest('POST', '/api/v1/opsroom/incidents/trigger', {
      title: 'Authorized Remediation Execution Test',
      description: 'Validating zero-trust sandboxed plan execution after 67% consensus',
      telemetry: [50, 52, 51, 53, 500]
    });
    const incidentId = triggerRes.data.incident.id;
    const squadAgents = triggerRes.data.incident.squad.agents;

    // 2. Deliberate
    await makeRequest('POST', `/api/v1/opsroom/incidents/${incidentId}/deliberate`, {
      reasoning: 'Safe failover step compiled',
      confidence: 0.95,
      proposedActions: [
        {
          toolName: 'isolate_zone',
          serverName: 'acr-sre-mcp',
          parameters: { zone: 'us-east-1a' },
          riskLevel: 'medium'
        }
      ]
    });

    // 3. Submit 4 approve votes (supermajority out of 5)
    for (let i = 0; i < 4; i++) {
      await makeRequest('POST', `/api/v1/opsroom/incidents/${incidentId}/vote`, {
        agentId: squadAgents[i].id,
        decision: 'approve',
        justification: `Agent ${squadAgents[i].name} verifies plan safety`,
        confidence: 0.95
      });
    }

    // 4. Evaluate quorum -> approved
    const qRes = await makeRequest('POST', `/api/v1/opsroom/incidents/${incidentId}/evaluate-quorum`);
    assert.equal(qRes.status, 200);
    assert.equal(qRes.data.quorum.status, 'approved');

    // 5. Execute plan -> succeeds!
    const execRes = await makeRequest('POST', `/api/v1/opsroom/incidents/${incidentId}/execute`, {
      humanApproved: false
    });
    assert.equal(execRes.status, 200);
    assert.equal(execRes.data.execResult.allSucceeded, true);
    assert.equal(execRes.data.canvas.status, 'resolved');
  });
});
