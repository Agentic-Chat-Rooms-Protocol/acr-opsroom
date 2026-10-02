/**
 * Retort MetaHarness DoE & ANOVA Attribution Types
 *
 * Provides type contracts for Design-of-Experiments factorial grids,
 * Honest Scoring with tooling false-fail exclusions, and multi-way ANOVA factor attribution.
 */

export type Diagnosis = 'pass' | 'genuine' | 'tooling';

export interface RetortCell {
  model: string;
  harness_config: string;
  language?: string;
  task: string;
  requirement_coverage: number; // [0.0, 1.0]
  code_quality?: number;        // [0.0, 1.0]
  cost_usd: number;
  latency_ms: number;
  diagnosis: Diagnosis;
}

export interface AnovaFactor {
  factor: string;
  ss: number;          // Sum of squares
  df: number;          // Degrees of freedom
  ms: number;          // Mean square (SS / DF)
  f_stat: number;      // F-statistic against residual
  p_val: number;       // Approximated p-value
  eta_squared: number; // Variance explained (SS_factor / SS_total)
}

export interface AnovaResult {
  factors: AnovaFactor[];
  ss_residual: number;
  df_residual: number;
  ms_residual: number;
  ss_total: number;
  cells_analyzed: number;
  cells_excluded_tooling: number;
}
