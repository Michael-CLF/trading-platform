import { Component, OnDestroy, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription, firstValueFrom, of, timeout, catchError, timer, switchMap } from 'rxjs';

import { TRADING_SYMBOLS } from '../../constants/symbols.constant';
import { StrategyService } from '../../services/strategy.service';
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

  // Chart geometry configuration
  readonly viewW = 1900;
  readonly viewH = 800;
  readonly padLeft = 40;
  readonly padRight = 40;
  readonly padTop = 30;
  readonly padBottom = 40;
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

  // Time formatter
  private readonly timeFormatter = new Intl.DateTimeFormat([], {
    hour: 'numeric',
    minute: '2-digit',
  });

  // X-axis ticks computed signal
  readonly xTicks = computed<Array<{ x: number; label: string }>>(() => {
    const b = this.bars();
    console.log('xTicks recalculating with bars.length =', b.length);

    if (!b.length) {
      console.log('No bars yet, returning empty ticks');
      return [];
    }

    const labelEveryNBars = 4; // Every 4 bars = 1 hour

    const ticks: Array<{ x: number; label: string }> = [];

    for (let i = 0; i < b.length; i += labelEveryNBars) {
      const bar = b[i];
      const x = this.xMid(i);
      const label = this.timeFormatter.format(new Date(bar.t));
      ticks.push({ x, label });
    }

    const lastIndex = b.length - 1;
    if (lastIndex % labelEveryNBars !== 0 && lastIndex > 0) {
      const lastBar = b[lastIndex];
      const x = this.xMid(lastIndex);
      const label = this.timeFormatter.format(new Date(lastBar.t));
      ticks.push({ x, label });
    }

    console.log('xTicks returning', ticks.length, 'ticks:', ticks);
    return ticks;
  });

  ngOnInit(): void {
    // Component is ready
  }

  ngOnDestroy(): void {
    this.teardown();
  }

  selectSymbol(symbol: string): void {
    const current = this.selected();
    if (current === symbol) {
      this.selectNone();
    } else {
      this.teardown();
      this.selected.set(symbol);
      this.start(symbol);
    }
  }

  selectNone(): void {
    this.teardown();
    this.selected.set(null);
    this.clearChart();
  }

  toggle(sym: string): void {
    this.selectSymbol(sym);
  }

  private clearChart(): void {
    this.bars.set([]);
    this.livePrice.set(null);
    this.chartInfo.set(null);
    this.tradeSignals.set([]);
  }

  private async start(sym: string): Promise<void> {
    this.teardown();

    try {
      const b = await this.fetchBars(sym);
      console.log('About to set bars signal with:', b.length, 'bars');
      this.bars.set(b);
      console.log('Bars signal after set:', this.bars());

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

  private async fetchBars(symbol: string): Promise<Bar[]> {
    console.log('fetchBars called for symbol:', symbol);

    const raw = await firstValueFrom(
      this.market.getBars15m(symbol, '1d').pipe(
        timeout(10_000),
        catchError(() => of([])),
      ),
    );

    console.log('Raw data received:', raw);
    console.log('Raw data length:', raw?.length);

    const bars: Bar[] = (raw as any[])
      .map((b: any) => {
        let timestamp: number;

        if (b.ts15) {
          timestamp = new Date(b.ts15).getTime();
        } else if (typeof b.ts === 'string') {
          timestamp = new Date(b.ts).getTime();
        } else if (typeof b.ts === 'number') {
          timestamp = b.ts;
        } else if (b.t) {
          timestamp = typeof b.t === 'number' ? b.t : new Date(b.t).getTime();
        } else if (b.time) {
          timestamp = typeof b.time === 'number' ? b.time : new Date(b.time).getTime();
        } else {
          timestamp = Date.now();
        }

        return {
          t: timestamp,
          o: b.o ?? b.open,
          h: b.h ?? b.high,
          l: b.l ?? b.low,
          c: b.c ?? b.close,
        };
      })
      .filter((v) => [v.t, v.o, v.h, v.l, v.c].every((n) => Number.isFinite(n)));

    console.log('Bars after mapping:', bars.length);

    if (!bars.length) {
      console.log('No bars after mapping, returning empty array');
      return [];
    }

    // Get TODAY in Eastern Time (market timezone)
    const now = new Date();
    const todayET = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));

    // Set to start of today
    const todayStart = new Date(todayET);
    todayStart.setHours(0, 0, 0, 0);

    // Market open: 9:30 AM ET today
    const marketOpen = new Date(todayStart);
    marketOpen.setHours(9, 30, 0, 0);

    // Market close: 4:00 PM ET today
    const marketClose = new Date(todayStart);
    marketClose.setHours(16, 0, 0, 0);

    console.log('Filtering for today only:', {
      marketOpen: marketOpen.toLocaleString('en-US', { timeZone: 'America/New_York' }),
      marketClose: marketClose.toLocaleString('en-US', { timeZone: 'America/New_York' }),
    });

    // Filter to ONLY today's trading session
    const todayBars = bars.filter((b) => {
      return b.t >= marketOpen.getTime() && b.t <= marketClose.getTime();
    });

    console.log('Today bars filtered:', todayBars.length);

    if (todayBars.length === 0) {
      console.log("No bars in today's session yet");
      return [];
    }

    console.log(
      'Time range:',
      new Date(todayBars[0].t).toLocaleString('en-US', { timeZone: 'America/New_York' }),
      'to',
      new Date(todayBars[todayBars.length - 1].t).toLocaleString('en-US', {
        timeZone: 'America/New_York',
      }),
    );

    return todayBars;
  }

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

  private detectSignals(bars: Bar[]): TradeSignal[] {
    if (bars.length < 21) return [];

    const closes = bars.map((b) => b.c);

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

      if (s5Prev <= s20Prev && s5 > s20) {
        signals.push({
          barIndex: i,
          type: 'BUY',
          price: bars[i].c,
          confidence: 0.8,
        });
      }

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
  getBodyWidth(): number {
    const s = this.step();
    return Math.max(2, Math.floor(s * 0.6));
  }

  xMid(i: number): number {
    const s = this.step();
    return this.padLeft + i * s + s / 2;
  }

  xBody(i: number): number {
    return this.xMid(i) - this.getBodyWidth() / 2;
  }

  y(price: number): number {
    const dom = this.yDomain();
    if (!dom) return this.viewH - this.padBottom;

    const [min, max] = dom;
    const ratio = (price - min) / (max - min);
    return this.padTop + (1 - ratio) * this.innerH();
  }

  timeLabel(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  trackBar(_: number, bar: Bar): number {
    return bar.t;
  }

  trackSignal(_: number, signal: TradeSignal): string {
    return `${signal.type}-${signal.barIndex}`;
  }
}
