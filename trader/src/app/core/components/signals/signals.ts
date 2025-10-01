// src/app/core/components/signals/signals.ts
import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { MarketDataService, UiBar } from '../../services/market-data.service';
import { Signal, SignalAction } from '../../shared/models/signal.models';

import { forkJoin, Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Component({
  selector: 'app-signals',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './signals.html',
  styleUrls: ['./signals.scss'],
})
export class SignalsComponent {
  private market = inject(MarketDataService);

  loading = signal<boolean>(true);
  query = signal<string>(''); // symbol search
  action = signal<SignalAction | ''>(''); // action filter
  rows = signal<Signal[]>([]);

  // Adjust to your watchlist
  private readonly symbols = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL'];

  ngOnInit(): void {
    // Fetch 15m bars for each symbol (Polygon -> backend -> here)
    const calls: Observable<[string, UiBar[]]>[] = this.symbols.map((sym) =>
      this.market
        .getBarsForUi(sym, '15m', '5d', 'America/New_York')
        .pipe(map((bars) => [sym, bars] as [string, UiBar[]])),
    );

    forkJoin(calls).subscribe({
      next: (results) => {
        const out: Signal[] = [];
        for (const [sym, bars] of results) {
          const sig = computeSmaSignal(sym, bars, 5, 20); // 5/20 SMA cross
          if (sig) out.push(sig);
        }
        this.rows.set(out);
        this.loading.set(false);
      },
      error: () => {
        this.rows.set([]);
        this.loading.set(false);
      },
    });
  }

  filtered = computed(() => {
    const q = this.query().trim().toUpperCase();
    const a = this.action();
    return this.rows().filter((s) => {
      const matchSymbol = q ? s.symbol.toUpperCase().includes(q) : true;
      const matchAction = a ? s.action === a : true;
      return matchSymbol && matchAction;
    });
  });
}

/** Simple SMA crossover signal. Uses LOWERCASE actions to match SignalAction. */
function computeSmaSignal(symbol: string, bars: UiBar[], fast = 5, slow = 20): Signal | null {
  if (!bars || bars.length < slow + 1) return null;

  const closes = bars.map((b) => b.close);
  const sma = (arr: number[], n: number, idx: number) =>
    arr.slice(idx - n + 1, idx + 1).reduce((s, x) => s + x, 0) / n;

  const i = closes.length - 1;
  const fastPrev = sma(closes, fast, i - 1);
  const slowPrev = sma(closes, slow, i - 1);
  const fastNow = sma(closes, fast, i);
  const slowNow = sma(closes, slow, i);

  let action: SignalAction | null = null;
  if (fastPrev <= slowPrev && fastNow > slowNow) action = 'buy' as SignalAction;
  if (fastPrev >= slowPrev && fastNow < slowNow) action = 'sell' as SignalAction;
  if (!action) return null;

  // NOTE: your Signal type doesn't have `when`, so we don't set it.
  const sig: Signal = {
    symbol,
    action, // 'buy' | 'sell'
    price: bars[i].close,
    note: `${fast}/${slow} SMA cross`,
  };
  return sig;
}
