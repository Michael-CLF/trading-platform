import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { MarketDataService, UiBar } from '../../services/market-data.service';

export type SignalAction = 'buy' | 'sell';
export interface SignalRow {
  symbol: string;
  action: SignalAction;
  price: number;
  timestamp: string;
  reason?: string;
  confidence?: number;
}

@Component({
  selector: 'app-signals',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './signals.html',
  styleUrls: ['./signals.scss'],
})
export class SignalsComponent {
  private market = inject(MarketDataService);

  loading = signal(true);
  query = signal<string>('');
  action = signal<SignalAction | ''>('');
  rows = signal<SignalRow[]>([]);

  private readonly symbols = ['AAPL', 'MSFT', 'NVDA'];

  async ngOnInit() {
    this.loading.set(true);
    const out: SignalRow[] = [];

    for (const s of this.symbols) {
      const bars = await firstValueFrom(
        this.market.getBarsForUi(s, '15m', '5d', 'America/New_York'),
      );
      if (bars.length < 30) continue;
      const sig = computeSmaSignal(s, bars, 5, 20);
      if (sig) out.push(sig);
    }

    this.rows.set(out);
    this.loading.set(false);
  }

  onQueryChange(v: string) {
    this.query.set(v ?? '');
  }
  onActionChange(v: '' | SignalAction) {
    this.action.set(v ?? '');
  }

  filtered = computed(() => {
    const q = this.query().trim().toUpperCase();
    const a = this.action();
    return this.rows().filter(
      (row) => (q ? row.symbol.toUpperCase().includes(q) : true) && (a ? row.action === a : true),
    );
  });
}

function sma(closes: number[], n: number, i: number) {
  if (i + 1 < n) return NaN;
  let sum = 0;
  for (let k = i - n + 1; k <= i; k++) sum += closes[k];
  return sum / n;
}

function computeSmaSignal(symbol: string, bars: UiBar[], fast = 5, slow = 20): SignalRow | null {
  const closes = bars.map((b) => b.close);
  const i = closes.length - 1;
  const fNow = sma(closes, fast, i),
    sNow = sma(closes, slow, i);
  const fPrev = sma(closes, fast, i - 1),
    sPrev = sma(closes, slow, i - 1);
  if (![fNow, sNow, fPrev, sPrev].every(isFinite)) return null;

  let action: SignalAction | null = null;
  if (fPrev <= sPrev && fNow > sNow) action = 'buy';
  if (fPrev >= sPrev && fNow < sNow) action = 'sell';
  if (!action) return null;

  return {
    symbol,
    action,
    price: bars[i].close,
    timestamp: bars[i].time,
    reason: `${fast}/${slow} SMA cross`,
    confidence: 0.6,
  };
}
