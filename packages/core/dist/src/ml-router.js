/**
 * ACR OpsRoom - ML Router & Statistical Anomaly Detector
 * Grounded in /ml-best-practices:
 * - Feature standardization & statistical testing (Z-Score, IQR)
 * - Time-series anomaly detection on telemetry metrics
 * - Semantic vector scoring & Cosine Similarity for squad routing
 */
export class MLStatisticalDetector {
    /**
     * Compute comprehensive descriptive statistics from a historical window.
     */
    static computeBaseline(samples) {
        if (samples.length === 0) {
            return {
                count: 0,
                mean: 0,
                stdDev: 0,
                median: 0,
                q1: 0,
                q3: 0,
                iqr: 0,
                min: 0,
                max: 0,
            };
        }
        const sorted = [...samples].sort((a, b) => a - b);
        const count = sorted.length;
        const sum = sorted.reduce((acc, val) => acc + val, 0);
        const mean = sum / count;
        const variance = sorted.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / count;
        const stdDev = Math.sqrt(variance) || 1e-6; // prevent div by 0
        const median = this.getPercentile(sorted, 0.5);
        const q1 = this.getPercentile(sorted, 0.25);
        const q3 = this.getPercentile(sorted, 0.75);
        const iqr = q3 - q1;
        return {
            count,
            mean,
            stdDev,
            median,
            q1,
            q3,
            iqr,
            min: sorted[0],
            max: sorted[count - 1],
        };
    }
    static getPercentile(sorted, p) {
        const idx = (sorted.length - 1) * p;
        const lower = Math.floor(idx);
        const upper = Math.ceil(idx);
        const weight = idx - lower;
        return sorted[lower] * (1 - weight) + sorted[upper] * weight;
    }
    /**
     * Evaluate a real-time metric against baseline using both parametric (Z-score)
     * and non-parametric (IQR) outlier criteria.
     */
    static detectAnomaly(metricName, currentValue, baselineSamples, zThreshold = 2.5) {
        const baseline = this.computeBaseline(baselineSamples);
        const zScore = baseline.stdDev > 0 ? (currentValue - baseline.mean) / baseline.stdDev : 0;
        const isZScoreAnomaly = Math.abs(zScore) >= zThreshold;
        const iqrLower = baseline.q1 - 1.5 * baseline.iqr;
        const iqrUpper = baseline.q3 + 1.5 * baseline.iqr;
        const isIqrAnomaly = currentValue < iqrLower || currentValue > iqrUpper;
        let severity = 'P3';
        let confidence = 0.5;
        const absZ = Math.abs(zScore);
        if (absZ >= 4.0 || (isIqrAnomaly && absZ >= 3.5)) {
            severity = 'P0';
            confidence = 0.98;
        }
        else if (absZ >= 3.0 || isIqrAnomaly) {
            severity = 'P1';
            confidence = 0.89;
        }
        else if (absZ >= zThreshold) {
            severity = 'P2';
            confidence = 0.75;
        }
        return {
            metricName,
            currentValue,
            baseline,
            zScore: parseFloat(zScore.toFixed(3)),
            isZScoreAnomaly,
            isIqrAnomaly,
            severity,
            confidence,
        };
    }
}
export class MLIncidentRouter {
    static predefinedSquads = [
        {
            squadId: 'squad-sre-core',
            name: 'Site Reliability & Infrastructure Squad',
            specialization: 'High-availability failover, database replication lag, kubernetes pod crashes, traffic degradation',
            keywords: ['replication', 'database', 'lag', 'split-brain', 'failover', 'postgres', 'pod', 'oomkilled', 'latency', '503'],
            weights: { latency: 0.9, errorRate: 0.95, cpuPressure: 0.8, memoryLeak: 0.85 }
        },
        {
            squadId: 'squad-secops-defense',
            name: 'SecOps & Zero-Trust Defense Squad',
            specialization: 'Credential compromise, egress anomalies, unauthorized MCP calls, DID spoofing, rate spikes',
            keywords: ['unauthorized', 'egress', 'token', 'exploit', 'ddos', 'security', 'did', 'vault', 'cipher', 'breach'],
            weights: { authFailures: 0.98, egressAnomaly: 0.95, didSignatureError: 0.99 }
        },
        {
            squadId: 'squad-finops-scale',
            name: 'FinOps & Cost Optimization Squad',
            specialization: 'LLM token burn spikes, compute runaway, cloud ingress runaway, API over-budget alerts',
            keywords: ['billing', 'token', 'cost', 'overrun', 'budget', 'credits', 'stripe', 'unkey', 'quota'],
            weights: { costDrift: 0.95, tokenBurnRate: 0.9 }
        }
    ];
    /**
     * Simple TF-IDF / term-frequency vectorizer for incident description & telemetry features.
     */
    static routeIncidentToSquad(title, description, anomalies) {
        const text = `${title} ${description}`.toLowerCase();
        const tokens = text.split(/[^a-zA-Z0-9_\-]+/).filter(Boolean);
        let bestSquad = this.predefinedSquads[0];
        let highestScore = -1;
        for (const squad of this.predefinedSquads) {
            let score = 0;
            for (const kw of squad.keywords) {
                if (tokens.includes(kw)) {
                    score += 1.5;
                }
                else if (text.includes(kw)) {
                    score += 0.8;
                }
            }
            // Check anomalies against squad specialized weights
            for (const anomaly of anomalies) {
                for (const [metricKey, weight] of Object.entries(squad.weights)) {
                    if (anomaly.metricName.toLowerCase().includes(metricKey.toLowerCase())) {
                        score += anomaly.zScore * weight * 0.4;
                    }
                }
            }
            if (score > highestScore) {
                highestScore = score;
                bestSquad = squad;
            }
        }
        // Determine highest anomaly severity
        const severityHierarchy = { P0: 4, P1: 3, P2: 2, P3: 1 };
        let maxSeverity = 'P3';
        for (const a of anomalies) {
            if (severityHierarchy[a.severity] > severityHierarchy[maxSeverity]) {
                maxSeverity = a.severity;
            }
        }
        const normalizedSimilarity = Math.min(1.0, Math.max(0.1, (highestScore + 1) / (tokens.length + 5)));
        return {
            squadId: bestSquad.squadId,
            squadName: bestSquad.name,
            similarityScore: parseFloat(normalizedSimilarity.toFixed(3)),
            recommendedSeverity: maxSeverity,
        };
    }
    /**
     * Factory to construct standard agent squads with W3C DIDs and cryptographic keys.
     */
    static createDefaultSquad(squadId) {
        const agents = [
            {
                id: 'agent-atlas-1',
                did: 'did:key:z6MkuSREatlasOrchestrator0184x7',
                role: 'atlas_orchestrator',
                name: 'Atlas 2.0 Orchestrator',
                capabilities: ['goal_decomposition', 'dag_planning', 'state_machine_advance', 'consensus_broker'],
                voteWeight: 1.5,
                publicKey: '037b5a19c671b56a3e9c4d924151b6817290fbb0124803d2745300fbc4b48ec193',
                status: 'idle',
            },
            {
                id: 'agent-sre-1',
                did: 'did:key:z6MkuSREreliabilityGuardian0927v1',
                role: 'sre_reliability',
                name: 'SRE Reliability Guardian',
                capabilities: ['telemetry_diagnostics', 'failover_execution', 'circuit_breaker', 'rollback'],
                voteWeight: 1.2,
                publicKey: '0289a3f912e75390bb9a6ec27265bc1010375685718dfb01037365027464917a12',
                status: 'idle',
            },
            {
                id: 'agent-secops-1',
                did: 'did:key:z6MkuSecOpsZeroTrustSentinel442m9',
                role: 'secops_guardian',
                name: 'SecOps Zero-Trust Sentinel',
                capabilities: ['mcp_sandbox_inspection', 'dual_consent_enforcement', 'credential_isolation'],
                voteWeight: 1.3,
                publicKey: '02fba7295719302847cbb391054a88371904726510378401928471928374619284',
                status: 'idle',
            },
            {
                id: 'agent-dataops-1',
                did: 'did:key:z6MkuDataOpsIntegrityMarshal831p5',
                role: 'dataops_engineer',
                name: 'DataOps Integrity Marshal',
                capabilities: ['schema_validation', 'wal_inspection', 'replication_repair'],
                voteWeight: 1.0,
                publicKey: '031029384756192837465928172635481920394857162534182930495817263541',
                status: 'idle',
            },
            {
                id: 'agent-finops-1',
                did: 'did:key:z6MkuFinOpsResourceOverseer109w8',
                role: 'finops_overseer',
                name: 'FinOps Resource Overseer',
                capabilities: ['budget_ceiling_check', 'compute_cost_impact', 'egress_toll_calculation'],
                voteWeight: 1.0,
                publicKey: '029485716253410293847561829304958172635418293049581726354819203948',
                status: 'idle',
            },
        ];
        return {
            id: squadId,
            name: squadId.includes('secops') ? 'SecOps & Zero-Trust Defense Squad' : 'Site Reliability & Infrastructure Squad',
            specialization: 'Mission-Critical Autonomous Operations',
            agents,
            consensusThreshold: 0.67, // Byzantine fault tolerance 2/3 threshold
        };
    }
}
//# sourceMappingURL=ml-router.js.map