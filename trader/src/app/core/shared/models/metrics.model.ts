/**
 * Performance metrics for backtests and monitoring.
 */
export interface Metrics {
  cagr: number; // Compound Annual Growth Rate
  sharpe: number; // Sharpe ratio after costs
  maxDd: number; // Maximum drawdown (fraction, not %)
  hitRate: number; // Fraction of winning trades
  turnover: number; // Total traded / equity
}
