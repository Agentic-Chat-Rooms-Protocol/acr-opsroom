import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  AcrCoreClient,
  Atlas2Engine,
  ByzantineConsensusEngine,
  CANONICAL_WORKFLOWS,
  DEFAULT_ACR_CORE_URL,
  MLIncidentRouter,
  executeWorkflow,
  exportWorkflowContract,
  findCanonicalWorkflow,
  resolveAcrApiToken,
  validateCanonicalWorkflowConfig,
} from '../src/index.js';

describe('Canonical 18 Workflows & AcrCoreClient Parity', () => {
  it('exposes exactly 18 canonical workflows with unique IDs, preset IDs, and valid contract export', () => {
    assert.equal(CANONICAL_WORKFLOWS.length, 18);

    const ids = new Set(CANONICAL_WORKFLOWS.map((w) => w.id));
    const presetIds = new Set(CANONICAL_WORKFLOWS.map((w) => w.presetId));
    assert.equal(ids.size, 18);
    assert.equal(presetIds.size, 18);

    const contract = exportWorkflowContract('test-rev', { executionSupported: true });
    assert.equal(contract.schemaVersion, '1.0');
    assert.equal(contract.registryRevision, 'test-rev');
    assert.equal(contract.workflows.length, 18);
    for (const def of contract.workflows) {
      assert.equal(def.execution_supported, true);
      assert.equal(def.config_schema.additionalProperties, false);
    }
  });

  it('resolves canonical workflows by id, presetId, snake_case, case-insensitive alias, and returns null for unknown', () => {
    assert.equal(findCanonicalWorkflow('postgres-split-brain')?.id, 'postgres-split-brain');
    assert.equal(findCanonicalWorkflow('preset-postgres-split-brain')?.id, 'postgres-split-brain');
    assert.equal(findCanonicalWorkflow('POSTGRES_SPLIT_BRAIN')?.id, 'postgres-split-brain');
    assert.equal(findCanonicalWorkflow('db-failover-ops')?.id, 'postgres-split-brain');
    assert.equal(findCanonicalWorkflow('wal-recovery')?.id, 'durable-wal-recovery');
    assert.equal(findCanonicalWorkflow('web-of-trust')?.id, 'transitive-trust-federation');

    assert.equal(findCanonicalWorkflow(''), null);
    assert.equal(findCanonicalWorkflow('nonexistent-workflow'), null);
    assert.equal(findCanonicalWorkflow(null), null);
  });

  it('validates canonical workflow configs strictly against schema bounds and types', () => {
    const ok = validateCanonicalWorkflowConfig('postgres-split-brain', {
      drainGraceSec: 15,
      failoverTarget: 'read-replica-02',
    });
    assert.equal(ok.valid, true);
    assert.equal(ok.errors.length, 0);

    const badUnknown = validateCanonicalWorkflowConfig('postgres-split-brain', {
      drainGraceSec: 5,
      extraField: true,
    });
    assert.equal(badUnknown.valid, false);
    assert.match(badUnknown.errors[0], /Unknown configuration field/);

    const badRange = validateCanonicalWorkflowConfig('postgres-split-brain', {
      drainGraceSec: 999,
    });
    assert.equal(badRange.valid, false);
    assert.match(badRange.errors[0], /<=/);

    const badSelect = validateCanonicalWorkflowConfig('postgres-split-brain', {
      drainGraceSec: 5,
      failoverTarget: 'invalid-replica',
    });
    assert.equal(badSelect.valid, false);
    assert.match(badSelect.errors[0], /must be one of/);

    const badNonObject = validateCanonicalWorkflowConfig('postgres-split-brain', ['not-an-object']);
    assert.equal(badNonObject.valid, false);
  });

  it('initializes incident workflowState + executionPlan and executes compiled ADK 2.0 DAG', async () => {
    const squad = MLIncidentRouter.createDefaultSquad('squad-sre-core');
    const incident = Atlas2Engine.createIncident(
      'Failover Test',
      'Testing canonical workflow initialization',
      squad,
      {
        workflowType: 'postgres-split-brain',
        workflowConfig: { drainGraceSec: 12, failoverTarget: 'read-replica-02' },
      }
    );

    assert.equal(incident.workflowType, 'postgres-split-brain');
    assert.equal(incident.severity, 'P0');
    assert.equal(incident.workflowState?.canonicalId, 'postgres-split-brain');
    assert.equal(incident.workflowState?.totalSteps, 2);
    assert.equal(incident.executionPlan?.steps.length, 2);
    assert.equal(incident.executionPlan?.steps[0].parameters.drainGraceSec, 12);

    // Approve BFT quorum across squad and execute compiled ADK 2.0 graph
    incident.ballots = squad.agents.slice(0, 4).map((agent) =>
      ByzantineConsensusEngine.signBallot(incident.id, agent, 'approve', 0.95, 'Verified')
    );

    const graphWf = Atlas2Engine.compileExecutionGraph(incident, 'Execute failover DAG');
    const result = await executeWorkflow(graphWf, {});
    assert.equal(result.paused, false);
    assert.equal(incident.status, 'resolved');
  });

  it('AcrCoreClient defaults to http://127.0.0.1:20443 and resolves tokens in priority order', async () => {
    assert.equal(DEFAULT_ACR_CORE_URL, 'http://127.0.0.1:20443');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acr-opsroom-token-'));
    const tokenFile = path.join(tmpDir, 'api-token');
    fs.writeFileSync(tokenFile, '  file-token-abc  \n', 'utf8');

    const prevEnvToken = process.env.ACR_API_TOKEN;
    try {
      delete process.env.ACR_API_TOKEN;
      assert.equal(resolveAcrApiToken({ tokenFilePath: tokenFile }), 'file-token-abc');

      process.env.ACR_API_TOKEN = 'env-token-xyz';
      assert.equal(resolveAcrApiToken({ tokenFilePath: tokenFile }), 'env-token-xyz');
      assert.equal(
        resolveAcrApiToken({ apiToken: 'explicit-token-123', tokenFilePath: tokenFile }),
        'explicit-token-123'
      );

      // Verify fail-closed requireAuth when no token is present
      delete process.env.ACR_API_TOKEN;
      const missingClient = new AcrCoreClient({
        tokenFilePath: path.join(tmpDir, 'missing-token'),
        homeDir: tmpDir,
      });
      await assert.rejects(
        () => missingClient.request('/api/v1/rooms', { requireAuth: true }),
        /ACR_API_TOKEN or ~\/\.acr\/api-token is required/
      );

      // Verify live HTTP loopback request sends Bearer token loaded from ~/.acr/api-token
      let seenAuthHeader = '';
      let seenPath = '';
      const mockDaemon = http.createServer((req, res) => {
        seenAuthHeader = String(req.headers.authorization || '');
        seenPath = req.url || '';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, rooms: [] }));
      });
      await new Promise<void>((resolve) => mockDaemon.listen(0, '127.0.0.1', resolve));
      const address = mockDaemon.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      try {
        const fileClient = new AcrCoreClient({
          baseUrl: `http://127.0.0.1:${port}`,
          tokenFilePath: tokenFile,
        });
        const roomsRes = await fileClient.listRooms();
        assert.equal(roomsRes.ok, true);
        assert.equal(seenAuthHeader, 'Bearer file-token-abc');
        assert.equal(seenPath, '/api/v1/rooms');
      } finally {
        await new Promise<void>((resolve) => mockDaemon.close(() => resolve()));
      }
    } finally {
      if (prevEnvToken !== undefined) process.env.ACR_API_TOKEN = prevEnvToken;
      else delete process.env.ACR_API_TOKEN;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
