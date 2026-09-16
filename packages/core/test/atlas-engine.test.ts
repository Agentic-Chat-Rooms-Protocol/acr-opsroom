import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Atlas2Engine } from '../src/atlas-engine.js';
import { MLIncidentRouter } from '../src/ml-router.js';

describe('Atlas2Engine Deliberation & State Machine', () => {
  const squad = MLIncidentRouter.createDefaultSquad('squad-sre-core');

  test('initializes an incident in detecting phase with live canvas', () => {
    const incident = Atlas2Engine.createIncident(
      'Redis Cluster Memory Fragmentation',
      'Memory usage exceeded 94% with evictions on cache tier',
      squad
    );

    assert.ok(incident.id.startsWith('inc-'));
    assert.equal(incident.status, 'detecting');
    assert.ok(incident.canvas.title.includes('Redis Cluster'));
    assert.equal(incident.canvas.actionItems.length, 2);
  });

  test('transitions phases cleanly (detecting -> deliberating -> awaiting_quorum)', () => {
    const incident = Atlas2Engine.createIncident('Test Incident', 'Testing transitions', squad);

    const trans1 = Atlas2Engine.transitionPhase(incident, 'deliberating');
    assert.equal(trans1.toPhase, 'deliberate');
    assert.equal(incident.status, 'deliberating');
    assert.equal(incident.canvas.version, 2);

    const trans2 = Atlas2Engine.transitionPhase(incident, 'awaiting_quorum');
    assert.equal(trans2.toPhase, 'quorum');
    assert.equal(incident.status, 'awaiting_quorum');
  });

  test('records deliberation turn with cryptographic signature', () => {
    const incident = Atlas2Engine.createIncident('API Latency Spike', 'Testing turn logging', squad);
    Atlas2Engine.transitionPhase(incident, 'deliberating');

    const turn = Atlas2Engine.addDeliberationTurn(
      incident,
      squad.agents[1],
      'Hypothesize connection pool exhaustion in database driver',
      'Exhausted connection pool',
      [
        {
          toolName: 'scale_replica_pool',
          serverName: 'acr-sre-mcp',
          parameters: { poolSize: 50 },
          isDryRun: true,
          riskLevel: 'medium',
        }
      ],
      0.92
    );

    assert.equal(turn.turnIndex, 1);
    assert.equal(turn.role, 'sre_reliability');
    assert.ok(turn.signature.length > 20);
    assert.equal(incident.deliberationTurns.length, 1);
    assert.ok(incident.canvas.summaryMarkdown.includes('Hypothesize connection pool'));
  });

  test('compiles execution plan and runs dry-run simulation', () => {
    const incident = Atlas2Engine.createIncident('API Latency Spike', 'Plan testing', squad);
    Atlas2Engine.addDeliberationTurn(
      incident,
      squad.agents[1],
      'Restart idle connections',
      undefined,
      [
        {
          toolName: 'drain_idle_pool',
          serverName: 'acr-db-mcp',
          parameters: { target: 'db-read-1' },
          isDryRun: true,
          riskLevel: 'low',
        }
      ]
    );

    const plan = Atlas2Engine.compileExecutionPlan(incident, 'Stabilize read latency');
    assert.equal(plan.steps.length, 1);
    assert.equal(plan.steps[0].toolName, 'drain_idle_pool');

    const sim = Atlas2Engine.simulateDryRun(plan);
    assert.equal(sim.passed, true);
    assert.equal(plan.steps[0].status, 'dry_run_passed');
  });

  test('dry-run simulation blocks dangerous irreversible commands', () => {
    const incident = Atlas2Engine.createIncident('Hazardous Tool Call', 'Test danger block', squad);
    Atlas2Engine.addDeliberationTurn(
      incident,
      squad.agents[0],
      'Dangerous proposal',
      undefined,
      [
        {
          toolName: 'drop_table_users',
          serverName: 'acr-db-mcp',
          parameters: {},
          isDryRun: true,
          riskLevel: 'critical',
        }
      ]
    );

    const plan = Atlas2Engine.compileExecutionPlan(incident, 'Test hazard block');
    const sim = Atlas2Engine.simulateDryRun(plan);

    assert.equal(sim.passed, false);
    assert.equal(plan.steps[0].status, 'failed');
  });
});
