import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MLStatisticalDetector, MLIncidentRouter } from '../src/ml-router.js';

describe('MLStatisticalDetector & Anomaly Detection', () => {
  test('computes correct baseline statistics (mean, stdDev, IQR)', () => {
    const samples = [10, 12, 11, 13, 12, 11, 10, 14, 12, 11];
    const stats = MLStatisticalDetector.computeBaseline(samples);

    assert.equal(stats.count, 10);
    assert.ok(stats.mean > 11 && stats.mean < 12);
    assert.ok(stats.stdDev > 0);
    assert.ok(stats.iqr >= 0);
    assert.equal(stats.min, 10);
    assert.equal(stats.max, 14);
  });

  test('flags severe outlier when value spikes beyond 3.5 z-scores', () => {
    // Baseline mean ~10, stdDev ~1
    const baseline = [10, 10, 10, 11, 9, 10, 10, 11, 9, 10];
    const anomaly = MLStatisticalDetector.detectAnomaly('db_replication_lag_ms', 150, baseline);

    assert.ok(anomaly.isZScoreAnomaly);
    assert.ok(anomaly.isIqrAnomaly);
    assert.equal(anomaly.severity, 'P0');
    assert.ok(anomaly.zScore > 10);
    assert.ok(anomaly.confidence >= 0.95);
  });

  test('returns non-anomaly for normal telemetry within bounds', () => {
    const baseline = [100, 102, 98, 101, 99, 100, 103, 97];
    const normal = MLStatisticalDetector.detectAnomaly('http_latency_ms', 101, baseline);

    assert.equal(normal.isZScoreAnomaly, false);
    assert.equal(normal.isIqrAnomaly, false);
    assert.equal(normal.severity, 'P3');
  });
});

describe('MLIncidentRouter & Squad Dispatch', () => {
  test('routes database replication incident to SRE Reliability Squad', () => {
    const anomalies = [
      MLStatisticalDetector.detectAnomaly('db_replication_lag_ms', 450, [20, 22, 19, 21, 23])
    ];

    const routed = MLIncidentRouter.routeIncidentToSquad(
      'Postgres Read Replica Out of Sync',
      'High replication lag detected on follower db-2 with split-brain risk',
      anomalies
    );

    assert.equal(routed.squadId, 'squad-sre-core');
    assert.ok(routed.squadName.includes('Reliability'));
    assert.equal(routed.recommendedSeverity, 'P0');
  });

  test('routes unauthorized egress incident to SecOps Zero-Trust Squad', () => {
    const anomalies = [
      MLStatisticalDetector.detectAnomaly('egress_anomaly_mb', 9500, [10, 12, 15, 11, 14])
    ];

    const routed = MLIncidentRouter.routeIncidentToSquad(
      'Suspicious Token Exfiltration Detected',
      'Unauthorized egress traffic to unknown IP address with token invalidation',
      anomalies
    );

    assert.equal(routed.squadId, 'squad-secops-defense');
    assert.ok(routed.squadName.includes('SecOps'));
  });
});
