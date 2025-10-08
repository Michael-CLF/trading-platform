import {
  Component,
  OnDestroy,
  OnInit,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription, firstValueFrom, of, timeout, catchError, timer, switchMap } from 'rxjs';

import { TRADING_SYMBOLS } from '../../constants/symbols.constant';
import { StrategyService, UnifiedSignal } from '../../services/strategy.service';
import { MarketDataService } from '../../services/market-data.service';

// Type definitions
type Bar = { t: number; o: number; h: number; l: number; c: number };

interface TradeSignal {
  barIndex: number;
  type: 'BUY' | 'SELL';
  price: number;
  confidence: number;
}

interface ChartInfo {
  symbol: string;
  currentPrice: number;
  priceChange: number;
  priceChangePercent: number;
  high: number;
  low: number;
  open: number;
  volume: number;
}

@Component({
  selector: 'app-signals',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './signals.html',
  styleUrls: ['./signals.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SignalsComponent implements OnInit, OnDestroy {
  // Service injection using inject() - Angular 18 best practice
  private readonly market = inject(MarketDataService);
  private readonly strategy = inject(StrategyService);

  // Constants
  readonly symbols = TRADING_SYMBOLS;
  readonly math = Math;

  // Signals for reactive state management
  readonly selected = signal<string | null>(null);
  readonly bars = signal<Bar[]>([]);
  readonly livePrice = signal<number | null>(null);
  readonly chartInfo = signal<ChartInfo | null>(null);
  readonly tradeSignals = signal<TradeSignal[]>([]);

  // Chart geometry configuration - MAXIMIZED SIZES
  readonly viewW = 1900; // Increased width for fuller screen
  readonly viewH = 800; // Increased height to include time labels
  readonly padLeft = 40; // Reduced padding
  readonly padRight = 40; // Reduced padding
  readonly padTop = 30; // Reduced top padding
  readonly padBottom = 40; // Increased for time labels inside frame
  private _bodyW = 8;
  readonly chartHeight = this.viewH + 'px';

  // Theme colors
  readonly activePillColor = '#adff2f';
  readonly pillActiveFg = '#0b1220';
  readonly pillActiveBorder = '#60a5fa';

  // Computed values using Angular signals
  readonly yDomain = computed<[number, number] | null>(() => {
    const b = this.bars();
    if (!b.length) return null;

    let min = Math.min(...b.map((x: Bar) => x.l));
    let max = Math.max(...b.map((x: Bar) => x.h));

    const lp = this.livePrice();
    if (lp !== null) {
      min = Math.min(min, lp);
      max = Math.max(max, lp);
    }

    if (max <= min) return null;
    const pad = (max - min) * 0.05;
    return [min - pad, max + pad];
  });

  // Computed geometry values
  readonly innerW = computed(() => this.viewW - this.padLeft - this.padRight);
  readonly innerH = computed(() => this.viewH - this.padTop - this.padBottom);
  readonly step = computed(() => {
    const count = this.bars().length || 1;
    return this.innerW() / count;
  });

  // Subscriptions management
  private subscriptions = new Set<Subscription>();
  private pollSubscription?: Subscription;
  private quoteSubscription?: Subscription;
  private strategySubscription?: Subscription;

  ngOnInit(): void {
    // Component is ready - user will click to select symbols
  }

  ngOnDestroy(): void {
    this.teardown();
  }

  /**
   * Selects a symbol and starts data fetching
   * @param symbol - The trading symbol to select
   */
  selectSymbol(symbol: string): void {
    const current = this.selected();
    if (current === symbol) {
      // Deselect if clicking the same symbol
      this.selectNone();
    } else {
      // Clear previous data and set new symbol
      this.teardown();
      this.selected.set(symbol);
      // Start fetching data for the new symbol
      this.start(symbol);
    }
  }

  /**
   * Deselects the current symbol and clears all data
   */
  selectNone(): void {
    this.teardown();
    this.selected.set(null);
    this.clearChart();
  }

  /**
   * Toggles selection of a symbol
   * @param sym - The symbol to toggle
   */
  toggle(sym: string): void {
    this.selectSymbol(sym);
  }

  /**
   * Clears all chart data
   */
  private clearChart(): void {
    this.bars.set([]);
    this.livePrice.set(null);
    this.chartInfo.set(null);
    this.tradeSignals.set([]);
  }

  /**
   * Starts data fetching for the selected symbol
   * @param sym - The symbol to fetch data for
   */
  private async start(sym: string): Promise<void> {
    this.teardown();

    // Fetch initial bars
    try {
      const b = await this.fetchBars(sym);
      this.bars.set(b);
      this.updateChartInfo();
      this.tradeSignals.set(this.detectSignals(b));
    } catch (error) {
      console.error('Error fetching initial bars:', error);
    }

    // Setup periodic bar refresh (every minute)
    this.pollSubscription = timer(60_000, 60_000).subscribe(async () => {
      const s = this.selected();
      if (!s) return;

      try {
        const b = await this.fetchBars(s);
        this.bars.set(b);
        this.updateChartInfo();
        this.tradeSignals.set(this.detectSignals(b));
      } catch (error) {
        console.error('Error refreshing bars:', error);
      }
    });

    // Setup live quote polling (every 15 seconds)
    this.quoteSubscription = timer(0, 15_000)
      .pipe(switchMap(() => this.market.getQuote(sym).pipe(catchError(() => of(null)))))
      .subscribe((quote) => {
        if (quote?.price) {
          this.livePrice.set(quote.price);
          this.updateChartInfo();
        }
      });

    // Setup strategy signal subscription
    this.strategySubscription = this.strategy.getUnifiedSignal(sym).subscribe(() => {
      const b = this.bars();
      this.tradeSignals.set(this.detectSignals(b));
    });

    // Track all subscriptions
    if (this.pollSubscription) this.subscriptions.add(this.pollSubscription);
    if (this.quoteSubscription) this.subscriptions.add(this.quoteSubscription);
    if (this.strategySubscription) this.subscriptions.add(this.strategySubscription);
  }

  /**
   * Cleans up all active subscriptions
   */
  private teardown(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
    this.subscriptions.clear();

    this.pollSubscription?.unsubscribe();
    this.quoteSubscription?.unsubscribe();
    this.strategySubscription?.unsubscribe();

    this.pollSubscription = undefined;
    this.quoteSubscription = undefined;
    this.strategySubscription = undefined;
  }

  /**
   * Fetches bar data for a symbol
   * @param symbol - The symbol to fetch bars for
   * @returns Promise of Bar array
   */
  private async fetchBars(symbol: string): Promise<Bar[]> {
    const raw = await firstValueFrom(
      this.market.getBars15m(symbol, '5d').pipe(
        timeout(10_000),
        catchError(() => of([])),
      ),
    );

    const bars: Bar[] = (raw as any[])
      .map((b: any) => ({
        t: b.ts ?? b.t ?? b.time ?? Date.now(),
        o: b.o ?? b.open,
        h: b.h ?? b.high,
        l: b.l ?? b.low,
        c: b.c ?? b.close,
      }))
      .filter((v) => [v.t, v.o, v.h, v.l, v.c].every((n) => Number.isFinite(n)));

    // Limit to last 60 bars (today's session if available)
    const last = bars.at(-1);
    if (!last) return [];

    const day = new Date(last.t);
    day.setHours(0, 0, 0, 0);

    const start = new Date(day);
    start.setHours(9, 30, 0, 0);

    const end = new Date(day);
    end.setHours(16, 0, 0, 0);

    const todayBars = bars.filter((b) => b.t >= +start && b.t <= +end);
    return (todayBars.length ? todayBars : bars).slice(-60);
  }

  /**
   * Updates the chart info panel data
   */
  private updateChartInfo(): void {
    const b = this.bars();
    const s = this.selected();

    if (!b.length || !s) {
      this.chartInfo.set(null);
      return;
    }

    const first = b[0];
    const last = b[b.length - 1];
    const hi = Math.max(...b.map((x) => x.h));
    const lo = Math.min(...b.map((x) => x.l));
    const current = this.livePrice() ?? last.c;

    this.chartInfo.set({
      symbol: s,
      currentPrice: current,
      priceChange: current - first.o,
      priceChangePercent: ((current - first.o) / first.o) * 100,
      high: hi,
      low: lo,
      open: first.o,
      volume: 0,
    });
  }

  /**
   * Detects trading signals using SMA crossover strategy
   * @param bars - Array of bars to analyze
   * @returns Array of trade signals
   */
  private detectSignals(bars: Bar[]): TradeSignal[] {
    if (bars.length < 21) return [];

    const closes = bars.map((b) => b.c);

    // Simple Moving Average calculation
    const sma = (period: number, index: number): number => {
      if (index + 1 < period) return NaN;
      const sum = closes.slice(index - period + 1, index + 1).reduce((a, b) => a + b, 0);
      return sum / period;
    };

    const signals: TradeSignal[] = [];

    for (let i = 20; i < bars.length; i++) {
      const s5 = sma(5, i);
      const s20 = sma(20, i);
      const s5Prev = sma(5, i - 1);
      const s20Prev = sma(20, i - 1);

      if (![s5, s20, s5Prev, s20Prev].every(Number.isFinite)) continue;

      // Bullish crossover
      if (s5Prev <= s20Prev && s5 > s20) {
        signals.push({
          barIndex: i,
          type: 'BUY',
          price: bars[i].c,
          confidence: 0.8,
        });
      }

      // Bearish crossover
      if (s5Prev >= s20Prev && s5 < s20) {
        signals.push({
          barIndex: i,
          type: 'SELL',
          price: bars[i].c,
          confidence: 0.8,
        });
      }
    }

    return signals;
  }

  // SVG helper methods

  /**
   * Gets the body width for candles
   * @returns Body width in pixels
   */
  getBodyWidth(): number {
    const s = this.step();
    return Math.max(2, Math.floor(s * 0.6));
  }

  /**
   * Calculates the X coordinate for the middle of a bar
   * @param i - Bar index
   * @returns X coordinate
   */
  xMid(i: number): number {
    const s = this.step();
    return this.padLeft + i * s + s / 2;
  }

  /**
   * Calculates the X coordinate for the body of a bar
   * @param i - Bar index
   * @returns X coordinate
   */
  xBody(i: number): number {
    return this.xMid(i) - this.getBodyWidth() / 2;
  }

  /**
   * Calculates the Y coordinate for a price
   * @param price - Price value
   * @returns Y coordinate
   */
  y(price: number): number {
    const dom = this.yDomain();
    if (!dom) return this.viewH - this.padBottom;

    const [min, max] = dom;
    const ratio = (price - min) / (max - min);
    return this.padTop + (1 - ratio) * this.innerH();
  }

  /**
   * Formats timestamp to time label
   * @param timestamp - Unix timestamp
   * @returns Formatted time string
   */
  timeLabel(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  // Track by functions for *ngFor optimization
  trackBar(_: number, bar: Bar): number {
    return bar.t;
  }

  trackSignal(_: number, signal: TradeSignal): string {
    return `${signal.type}-${signal.barIndex}`;
  }
}
