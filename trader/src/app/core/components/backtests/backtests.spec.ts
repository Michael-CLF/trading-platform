import { Component, inject, signal } from '@angular/core';
import { CommonModule, PercentPipe, DecimalPipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { MarketDataService, UiBar } from '../../services/market-data.service';

interface BacktestResult {
  symbol: string;
  trades: number;
  winRate: number;
  pnlPct: number;
}

@Component({
  selector: 'app-backtests',
  standalone: true,
  imports: [CommonModule, PercentPipe, DecimalPipe],
  templateUrl: './backtests.html',
  styleUrls: ['./backtests.scss'],
})
export class BacktestsComponent {
  private market = inject(MarketDataService);
  loading = signal(true);
  rows = signal<BacktestResult[]>([]);
  private readonly symbols = ['AAPL', 'MSFT', 'NVDA'];

  async ngOnInit() {
    this.loading.set(true);
    const out: BacktestResult[] = [];
    for (const s of this.symbols) {
      const bars = await firstValueFrom(
        this.market.getBarsForUi(s, '15m', '5d', 'America/New_York'),
      );
      if (bars.length < 30) continue;
      out.push(runSmaBacktest(s, bars, 5, 20));
    }
    this.rows.set(out);
    this.loading.set(false);
  }
}

function runSmaBacktest(symbol: string, bars: UiBar[], fast: number, slow: number): BacktestResult {
  const closes = bars.map((b) => b.close);
  const sma = (n: number, i: number) => {
    if (i + 1 < n) return NaN;
    let sum = 0;
    for (let k = i - n + 1; k <= i; k++) sum += closes[k];
    return sum / n;
  };

  let inPos = false,
    entry = 0,
    wins = 0,
    trades = 0,
    ret = 1;
  for (let i = 1; i < closes.length; i++) {
    const fPrev = sma(fast, i - 1),
      sPrev = sma(slow, i - 1);
    const fNow = sma(fast, i),
      sNow = sma(slow, i);
    if (![fPrev, sPrev, fNow, sNow].every(isFinite)) continue;

    if (!inPos && fPrev <= sPrev && fNow > sNow) {
      inPos = true;
      entry = closes[i];
      trades++;
    }
    if (inPos && fPrev >= sPrev && fNow < sNow) {
      const r = closes[i] / entry;
      if (r > 1) wins++;
      ret *= r;
      inPos = false;
    }
  }
  if (inPos) ret *= closes.at(-1)! / entry;

  return { symbol, trades, winRate: trades ? wins / trades : 0, pnlPct: ret - 1 };
}
