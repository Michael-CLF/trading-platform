// src/app/core/shared/utils/metrics.utils.ts

/**
 * Build an equity curve from a sequence of fractional returns.
 * Each r is a net return for one step (e.g., +0.003 = +30 bps).
 * Returns an array of { ts, equity } aligned to the input timestamps.
 */
export function buildEquityCurve(
  ts: string[],
  returns: number[],
  startEquity = 1,
): Array<{ ts: string; equity: number }> {
  const curve: Array<{ ts: string; equity: number }> = [];
  let eq = startEquity;

  for (let i = 0; i < returns.length; i++) {
    eq *= 1 + (returns[i] ?? 0);
    curve.push({ ts: ts[i], equity: eq });
  }
  return curve;
}

/**
 * Compute max drawdown from an equity curve.
 * Returns the maximum fractional decline from a prior peak.
 */
export function maxDrawdown(equity: number[]): number {
  let peak = -Infinity;
  let mdd = 0;
  for (const e of equity) {
    if (e > peak) peak = e;
    const dd = (peak - e) / peak;
    if (dd > mdd) mdd = dd;
  }
  return isFinite(mdd) ? mdd : 0;
}

/**
 * Annualized Sharpe ratio from per-step returns.
 * barsPerYear is used for scaling (252 trading days * 26 bars/day ≈ 6552 for 15m).
 */
export function sharpe(
  stepReturns: number[],
  barsPerYear = 252 * 26, // ~15-minute bars during RTH
): number {
  if (!stepReturns.length) return 0;

  const mean = stepReturns.reduce((a, b) => a + b, 0) / stepReturns.length;
  const varSum = stepReturns.reduce((a, b) => a + Math.pow(b - mean, 2), 0);
  const variance = varSum / Math.max(1, stepReturns.length - 1);
  const std = Math.sqrt(Math.max(variance, 0));

  if (std === 0) return 0;

  // Sharpe = (mean/SD) * sqrt(barsPerYear)
  return (mean / std) * Math.sqrt(barsPerYear);
}

/**
 * CAGR from the first to last equity points.
 */
export function cagrFromEquity(curve: Array<{ ts: string; equity: number }>): number {
  if (!curve.length) return 0;
  const start = curve[0].equity;
  const end = curve[curve.length - 1].equity;
  if (start <= 0 || end <= 0) return 0;

  // find elapsed years from timestamps (approx)
  const t0 = new Date(curve[0].ts).getTime();
  const t1 = new Date(curve[curve.length - 1].ts).getTime();
  const years = Math.max((t1 - t0) / (365.25 * 24 * 3600 * 1000), 1 / 365); // avoid div by 0
  return Math.pow(end / start, 1 / years) - 1;
}
