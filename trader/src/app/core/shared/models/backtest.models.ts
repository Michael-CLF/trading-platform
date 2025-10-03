export interface BacktestMetrics {
  cagr: number;
  sharpe: number;
  sortino: number;
  maxDrawdown: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
}
import { Trade } from './trade.model';
import { Metrics } from './metrics.model';

/**
 * Full backtest result for a strategy/model over a time period.
 */
export interface BacktestResult {
  equityCurve: Array<{ ts: string; equity: number }>;
  trades: Trade[];
  metrics: Metrics;
}
