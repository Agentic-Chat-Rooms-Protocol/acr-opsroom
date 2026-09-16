/**
 * ACR OpsRoom - ML Router & Statistical Anomaly Detector
 * Grounded in /ml-best-practices:
 * - Feature standardization & statistical testing (Z-Score, IQR)
 * - Time-series anomaly detection on telemetry metrics
 * - Semantic vector scoring & Cosine Similarity for squad routing
 */
import { OpsSeverity, AgentSquad } from './types.js';
export interface TelemetrySample {
    value: number;
    timestamp: number;
}
export interface StatisticalSummary {
    count: number;
    mean: number;
    stdDev: number;
    median: number;
    q1: number;
    q3: number;
    iqr: number;
    min: number;
    max: number;
}
export interface AnomalyReport {
    metricName: string;
    currentValue: number;
    baseline: StatisticalSummary;
    zScore: number;
    isZScoreAnomaly: boolean;
    isIqrAnomaly: boolean;
    severity: OpsSeverity;
    confidence: number;
}
export declare class MLStatisticalDetector {
    /**
     * Compute comprehensive descriptive statistics from a historical window.
     */
    static computeBaseline(samples: number[]): StatisticalSummary;
    private static getPercentile;
    /**
     * Evaluate a real-time metric against baseline using both parametric (Z-score)
     * and non-parametric (IQR) outlier criteria.
     */
    static detectAnomaly(metricName: string, currentValue: number, baselineSamples: number[], zThreshold?: number): AnomalyReport;
}
export interface SquadVector {
    squadId: string;
    name: string;
    specialization: string;
    keywords: string[];
    weights: Record<string, number>;
}
export declare class MLIncidentRouter {
    private static predefinedSquads;
    /**
     * Simple TF-IDF / term-frequency vectorizer for incident description & telemetry features.
     */
    static routeIncidentToSquad(title: string, description: string, anomalies: AnomalyReport[]): {
        squadId: string;
        squadName: string;
        similarityScore: number;
        recommendedSeverity: OpsSeverity;
    };
    /**
     * Factory to construct standard agent squads with W3C DIDs and cryptographic keys.
     */
    static createDefaultSquad(squadId: string): AgentSquad;
}
//# sourceMappingURL=ml-router.d.ts.map