/**
 * Retort Multi-Way ANOVA Factor Attribution Engine
 *
 * Implements Honest Scoring (excluding Diagnosis::Tooling harness artifacts)
 * and multi-way variance decomposition attributing outcome variance across
 * {model, harness_config, language, task}.
 */

import { RetortCell, AnovaResult, AnovaFactor } from './types.js';

export class RetortAnovaEngine {
  /**
   * Decomposes factorial grid variance using multi-way ANOVA with honest scoring.
   *
   * @param cells Factorial grid experimental cells
   * @param metricKey Target response metric key ('requirement_coverage' or 'code_quality')
   * @param factorKeys Factor keys to evaluate, e.g. ['model', 'harness_config']
   */
  public static compute(
    cells: RetortCell[],
    metricKey: 'requirement_coverage' | 'code_quality' = 'requirement_coverage',
    factorKeys: Array<keyof RetortCell> = ['model', 'harness_config']
  ): AnovaResult {
    // 1. Honest Scoring: Exclude tooling false-fails
    const scoredCells: RetortCell[] = [];
    let cellsExcludedTooling = 0;

    for (const cell of cells) {
      if (cell.diagnosis === 'tooling') {
        cellsExcludedTooling++;
      } else {
        scoredCells.push(cell);
      }
    }

    const n = scoredCells.length;
    if (n < 2) {
      return {
        factors: [],
        ss_residual: 0,
        df_residual: 0,
        ms_residual: 0,
        ss_total: 0,
        cells_analyzed: n,
        cells_excluded_tooling: cellsExcludedTooling,
      };
    }

    // 2. Compute grand mean
    const values = scoredCells.map((c) => Number(c[metricKey] ?? 0));
    const grandMean = values.reduce((sum, v) => sum + v, 0) / n;

    // 3. Compute total sum of squares (SS_total)
    let ssTotal = 0;
    for (const val of values) {
      ssTotal += (val - grandMean) ** 2;
    }

    // Guard against zero variance
    if (ssTotal <= 1e-12) {
      const factors: AnovaFactor[] = factorKeys.map((k) => ({
        factor: String(k),
        ss: 0,
        df: 0,
        ms: 0,
        f_stat: 0,
        p_val: 1,
        eta_squared: 0,
      }));
      return {
        factors,
        ss_residual: 0,
        df_residual: n - 1,
        ms_residual: 0,
        ss_total: 0,
        cells_analyzed: n,
        cells_excluded_tooling: cellsExcludedTooling,
      };
    }

    // 4. Compute SS for each factor
    const factors: AnovaFactor[] = [];
    let sumFactorSS = 0;
    let sumFactorDF = 0;

    for (const factorKey of factorKeys) {
      // Group by factor level
      const groups = new Map<string, number[]>();
      for (const cell of scoredCells) {
        const level = String(cell[factorKey] ?? 'unknown');
        if (!groups.has(level)) {
          groups.set(level, []);
        }
        groups.get(level)!.push(Number(cell[metricKey] ?? 0));
      }

      const numLevels = groups.size;
      const df = Math.max(0, numLevels - 1);
      let ss = 0;

      for (const [, grpValues] of groups.entries()) {
        const grpMean = grpValues.reduce((s, v) => s + v, 0) / grpValues.length;
        ss += grpValues.length * (grpMean - grandMean) ** 2;
      }

      // Bound factor SS by remaining total
      ss = Math.min(ss, ssTotal);
      const ms = df > 0 ? ss / df : 0;
      const etaSquared = ss / ssTotal;

      factors.push({
        factor: String(factorKey),
        ss,
        df,
        ms,
        f_stat: 0, // Computed after residual MS
        p_val: 1,
        eta_squared: etaSquared,
      });

      sumFactorSS += ss;
      sumFactorDF += df;
    }

    // 5. Compute residual (error) SS and DF
    const ssResidual = Math.max(0, ssTotal - sumFactorSS);
    const dfResidual = Math.max(1, n - 1 - sumFactorDF);
    const msResidual = ssResidual / dfResidual;

    // 6. Compute F-statistic and p-value per factor
    for (const f of factors) {
      if (msResidual > 1e-12 && f.df > 0) {
        f.f_stat = f.ms / msResidual;
        f.p_val = RetortAnovaEngine.approxFPValue(f.f_stat, f.df, dfResidual);
      } else {
        f.f_stat = 0;
        f.p_val = 1.0;
      }
    }

    return {
      factors,
      ss_residual: ssResidual,
      df_residual: dfResidual,
      ms_residual: msResidual,
      ss_total: ssTotal,
      cells_analyzed: n,
      cells_excluded_tooling: cellsExcludedTooling,
    };
  }

  /**
   * Defensive continuous approximation for the F-distribution survival function (p-value).
   */
  private static approxFPValue(f: number, df1: number, df2: number): number {
    if (f <= 0 || df1 <= 0 || df2 <= 0) return 1.0;
    // Transform to standard score approximation via Wilson-Hilferty transformation
    const x = f;
    const v1 = df1;
    const v2 = df2;
    const z =
      (Math.pow(x / (1 + (x * v1) / v2), 1 / 3) * (1 - 2 / (9 * v2)) -
        (1 - 2 / (9 * v1))) /
      Math.sqrt((2 / (9 * v1)) + (2 / (9 * v2)) * Math.pow(x / (1 + (x * v1) / v2), 2 / 3));

    // Standard normal CDF approximation (Abramowitz & Stegun)
    const pNormal = 0.5 * (1 + Math.tanh(z * Math.sqrt(2 / Math.PI) * (1 + 0.044715 * z * z)));
    const pValue = Math.max(0.0001, Math.min(1.0, 1.0 - pNormal));
    return pValue;
  }
}
