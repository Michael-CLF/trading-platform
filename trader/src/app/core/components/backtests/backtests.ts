// src/app/core/components/backtests/backtests.ts
import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

import { MarketDataService, UiBar } from '../../services/market-data.service';
import { firstValueFrom } from 'rxjs';

interface BacktestResult {
  symbol: string;
  trades: number;
  totalReturnPct: number; // 0..100
  maxDrawdownPct?: number; // 0..100
}

@Component({
  selector: 'app-backtests',
  standalone: true,
  // 🔇 Removed DecimalPipe/PercentPipe from imports since not used in template
  imports: [CommonModule],
  templateUrl: './backtests.html',
  styleUrls: ['./backtests.scss'],
})
export class BacktestsComponent {
  private market = inject(MarketDataService);

  loading = signal<boolean>(true);
  rows = signal<BacktestResult[]>([]);

  async ngOnInit(): Promise<void> {
    const symbols = ['AAPL', 'MSFT', 'NVDA']; // adjust to your list
    const results: BacktestResult[] = [];

    for (const s of symbols) {
      // ✅ Use firstValueFrom to get UiBar[] (not possibly undefined)
      const bars: UiBar[] = await firstValueFrom(
        this.market.getBarsForUi(s, '15m', '5d', 'America/New_York'),
      );

      if (!bars?.length || bars.length < 30) continue;

      const r = runSmaBacktest(s, bars, 5, 20);
      results.push(r);
    }

    this.rows.set(results);
    this.loading.set(false);
  }
}

/* --- Simple SMA backtest, same as before --- */
function runSmaBacktest(symbol: string, bars: UiBar[], fast = 5, slow = 20): BacktestResult {
  const closes = bars.map((b) => b.close);

  const sma = (arr: number[], n: number, idx: number) =>
    arr.slice(idx - n + 1, idx + 1).reduce((s, x) => s + x, 0) / n;

  let inPos = false;
  let entry = 0;
  let trades = 0;
  let equity = 1; // normalized
  let peak = 1;
  let maxDD = 0;

  for (let i = slow; i < closes.length; i++) {
    const fastNow = sma(closes, fast, i);
    const slowNow = sma(closes, slow, i);
    const fastPrev = sma(closes, fast, i - 1);
    const slowPrev = sma(closes, slow, i - 1);

    const buy = !inPos && fastPrev <= slowPrev && fastNow > slowNow;
    const sell = inPos && fastPrev >= slowPrev && fastNow < slowNow;

    if (buy) {
      inPos = true;
      entry = closes[i];
      trades++;
    } else if (sell) {
      inPos = false;
      const ret = closes[i] / entry;
      equity *= ret;
      peak = Math.max(peak, equity);
      maxDD = Math.max(maxDD, (peak - equity) / peak);
      trades++;
    }
  }

  if (inPos) {
    const ret = closes.at(-1)! / entry;
    equity *= ret;
    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, (peak - equity) / peak);
    trades++;
  }

  return {
    symbol,
    trades,
    totalReturnPct: (equity - 1) * 100,
    maxDrawdownPct: maxDD * 100,
  };
}
