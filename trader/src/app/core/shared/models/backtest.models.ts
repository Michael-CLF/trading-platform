export interface BacktestMetrics {
  cagr: number;
  sharpe: number;
  sortino: number;
  maxDrawdown: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
}

export interface BacktestSummary {
  id: string;
  name: string;
  metrics: BacktestMetrics;
  from: string;
  to: string;
}
