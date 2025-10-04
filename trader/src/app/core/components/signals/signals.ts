import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { MarketDataService, UiBar } from '../../services/market-data.service';
import { StrategyService } from '../../services/strategy.service';

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
  private strategy = inject(StrategyService);

  loading = signal(true);
  query = signal<string>('');
  action = signal<SignalAction | ''>('');
  rows = signal<SignalRow[]>([]);

  private readonly symbols = ['AAPL', 'MSFT', 'NVDA', 'SPY', 'QQQ', 'IWM', 'GOOGL', 'AMZN'];

  async ngOnInit() {
    this.loading.set(true);
    const out: SignalRow[] = [];

    for (const s of this.symbols) {
      const bars = await firstValueFrom(
        this.market.getBarsForUi(s, '15m', '5d', 'America/New_York'),
      );
      if (bars.length < 30) continue;

      // Calculate SMA signal
      const sig = this.computeSmaSignal(s, bars, 5, 20);
      if (sig) {
        out.push(sig);

        // Send technical signal to strategy service
        const technicalSignal = sig.action === 'buy' ? 'buy' : 'sell';
        const strength = sig.confidence || 0.6;
        this.strategy.updateTechnicalIndicator(s, 'sma_cross', technicalSignal, strength);
      }
    }

    this.rows.set(out);
    this.loading.set(false);

    // Subscribe to unified signals for monitoring
    this.strategy.getAllUnifiedSignals().subscribe((signals) => {
      console.log('All unified signals:', signals);
      // You could update the UI here to show combined signals
    });
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

  private sma(closes: number[], n: number, i: number): number {
    if (i + 1 < n) return NaN;
    let sum = 0;
    for (let k = i - n + 1; k <= i; k++) sum += closes[k];
    return sum / n;
  }

  private computeSmaSignal(symbol: string, bars: UiBar[], fast = 5, slow = 20): SignalRow | null {
    const closes = bars.map((b) => b.close);
    const i = closes.length - 1;
    const fNow = this.sma(closes, fast, i);
    const sNow = this.sma(closes, slow, i);
    const fPrev = this.sma(closes, fast, i - 1);
    const sPrev = this.sma(closes, slow, i - 1);

    if (![fNow, sNow, fPrev, sPrev].every(isFinite)) return null;

    let action: SignalAction | null = null;
    let confidence = 0.6;

    if (fPrev <= sPrev && fNow > sNow) {
      action = 'buy';
      // Calculate confidence based on crossover strength
      const crossStrength = (fNow - sNow) / sNow;
      confidence = Math.min(0.9, 0.6 + crossStrength * 2);
    } else if (fPrev >= sPrev && fNow < sNow) {
      action = 'sell';
      const crossStrength = (sNow - fNow) / sNow;
      confidence = Math.min(0.9, 0.6 + crossStrength * 2);
    }

    if (!action) return null;

    return {
      symbol,
      action,
      price: bars[i].close,
      timestamp: bars[i].time,
      reason: `${fast}/${slow} SMA cross`,
      confidence,
    };
  }
}
