// src/app/core/components/trade-history/trade-history.ts
import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  inject,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription, firstValueFrom, of, catchError, timeout } from 'rxjs';

import { TRADING_SYMBOLS } from '../../constants/symbols.constant';
import { MarketDataService } from '../../services/market-data.service';

/** UI bar shape from MarketDataService.getBarsForUi */
type UiBar = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/** Allowed ranges for the quick buttons */
type RangeId = '1D' | '1W' | '1M' | '3M' | '6M' | '1Y';

@Component({
  selector: 'app-trade-history',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './trade-history.html',
  styleUrls: ['./trade-history.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TradeHistoryComponent implements OnDestroy {
  private readonly market = inject(MarketDataService);

  // --- UI config (similar sizing to signals) ---
  readonly viewW = 1900;
  readonly viewH = 520;
  readonly padLeft = 56;
  readonly padRight = 24;
  readonly padTop = 24;
  readonly padBottom = 40;

  readonly innerW = computed(() => this.viewW - this.padLeft - this.padRight);
  readonly innerH = computed(() => this.viewH - this.padTop - this.padBottom);

  // --- symbol pills & range buttons ---
  readonly symbols = TRADING_SYMBOLS;
  readonly selected = signal<string | null>(null);

  readonly ranges: { id: RangeId; label: string }[] = [
    { id: '1D', label: '1D' },
    { id: '1W', label: '1W' },
    { id: '1M', label: '1M' },
    { id: '3M', label: '3M' },
    { id: '6M', label: '6M' },
    { id: '1Y', label: '1Y' },
  ];
  readonly selectedRange = signal<RangeId>('1M');

  // bars & scales
  readonly bars = signal<UiBar[]>([]);
  private sub?: Subscription;

  // y-domain based on close prices
  readonly yDomain = computed<[number, number] | null>(() => {
    const b = this.bars();
    if (!b.length) return null;
    const closes = b.map((x) => x.close);
    let min = Math.min(...closes);
    let max = Math.max(...closes);
    if (max <= min) return null;
    const pad = (max - min) * 0.07;
    return [min - pad, max + pad];
  });

  // x/y scale helpers (no d3)
  private xFromIndex(i: number, n: number): number {
    if (n <= 1) return this.padLeft;
    const frac = i / (n - 1);
    return this.padLeft + frac * this.innerW();
  }
  private yFromPrice(p: number): number {
    const dom = this.yDomain();
    if (!dom) return this.viewH - this.padBottom;
    const [min, max] = dom;
    const ratio = (p - min) / (max - min);
    return this.padTop + (1 - ratio) * this.innerH();
  }

  // SVG path for the line (simple “M … L …”)
  readonly linePath = computed<string>(() => {
    const b = this.bars();
    if (b.length < 2) return '';
    const n = b.length;
    let d = `M ${this.xFromIndex(0, n)} ${this.yFromPrice(b[0].close)}`;
    for (let i = 1; i < n; i++) {
      d += ` L ${this.xFromIndex(i, n)} ${this.yFromPrice(b[i].close)}`;
    }
    return d;
  });

  // axis ticks (time labels evenly spaced across the range)
  private readonly timeFmt = new Intl.DateTimeFormat([], { month: 'short', day: 'numeric' });
  private readonly timeFmtIntraday = new Intl.DateTimeFormat([], {
    hour: 'numeric',
    minute: '2-digit',
  });

  readonly xTicks = computed<Array<{ x: number; label: string }>>(() => {
    const b = this.bars();
    if (!b.length) return [];
    const n = b.length;
    const target = Math.min(8, Math.max(3, Math.floor(this.innerW() / 220)));
    const out: Array<{ x: number; label: string }> = [];
    for (let i = 0; i < target; i++) {
      const idx = Math.round((i / (target - 1)) * (n - 1));
      const ts = new Date(b[idx].time);
      const label =
        this.selectedRange() === '1D' || this.selectedRange() === '1W'
          ? this.timeFmtIntraday.format(ts)
          : this.timeFmt.format(ts);
      out.push({ x: this.xFromIndex(idx, n), label });
    }
    return out;
  });

  // y-ticks (5 grid lines)
  readonly yTicks = computed<Array<{ y: number; label: string }>>(() => {
    const dom = this.yDomain();
    if (!dom) return [];
    const [min, max] = dom;
    const steps = 5;
    const out: Array<{ y: number; label: string }> = [];
    for (let i = 0; i < steps; i++) {
      const frac = i / (steps - 1);
      const val = min + frac * (max - min);
      out.push({ y: this.yFromPrice(val), label: val.toFixed(2) });
    }
    return out;
  });

  // -------------- UI actions --------------

  async selectSymbol(sym: string) {
    // toggle: clicking again clears
    if (this.selected() === sym) {
      this.selected.set(null);
      this.bars.set([]);
      this.teardown();
      return;
    }
    this.selected.set(sym);
    await this.loadBars();
  }

  async selectRange(id: RangeId) {
    if (this.selectedRange() === id) return;
    this.selectedRange.set(id);
    await this.loadBars();
  }

  // -------------- data loading --------------

  private async loadBars() {
    this.teardown();
    const sym = this.selected();
    if (!sym) {
      this.bars.set([]);
      return;
    }

    const { interval, range } = this.intervalFor(this.selectedRange());

    // Use the normalized UI shape
    const stream = this.market.getBarsForUi(sym, interval, range).pipe(
      timeout(12_000),
      catchError(() => of([])),
    );

    this.sub = stream.subscribe((points: any) => {
      // ensure oldest→newest & filter bad rows
      const cleaned: UiBar[] = (points || [])
        .map((p: any) => ({
          time: p.time,
          open: +p.open,
          high: +p.high,
          low: +p.low,
          close: +p.close,
          volume: +p.volume,
        }))
        .filter((x: UiBar) => Number.isFinite(x.close) && x.time)
        .sort((a: UiBar, b: UiBar) => new Date(a.time).getTime() - new Date(b.time).getTime());

      // Intraday ranges (1D / 1W) can be heavy; cap to ~300 points
      const capped =
        this.selectedRange() === '1D' || this.selectedRange() === '1W'
          ? cleaned.slice(-300)
          : cleaned;

      this.bars.set(capped);
    });
  }

  /** Map quick range → backend interval/range */
  private intervalFor(id: RangeId): { interval: string; range: string } {
    switch (id) {
      case '1D':
        return { interval: '15m', range: '1d' }; // intraday
      case '1W':
        return { interval: '30m', range: '5d' }; // 5 trading days
      case '1M':
        return { interval: '1d', range: '1m' };
      case '3M':
        return { interval: '1d', range: '3m' };
      case '6M':
        return { interval: '1d', range: '6m' };
      case '1Y':
        return { interval: '1d', range: '1y' };
    }
  }

  // -------------- lifecycle --------------

  ngOnDestroy(): void {
    this.teardown();
  }

  private teardown() {
    this.sub?.unsubscribe();
    this.sub = undefined;
  }
}
