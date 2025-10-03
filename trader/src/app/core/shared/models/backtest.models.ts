// src/app/core/shared/models/backtest.models.ts
import { Trade } from './trade.model';
import { Metrics } from './metrics.model';

/**
 * Lightweight per-symbol summary row (used by simple tables or services).
 * winRate and pnlPct are fractions: 0..1
 */
export interface BacktestSummary {
  symbol: string;
  trades: number;
  winRate: number; // 0..1
  pnlPct: number; // 0..1
}

/**
 * Full backtest result object for richer views (equity curve, metrics, trade ledger).
 */
export interface BacktestResult {
  equityCurve: Array<{ ts: string; equity: number }>;
  trades: Trade[];
  metrics: Metrics;
}
