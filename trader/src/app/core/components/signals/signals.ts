import { Component, OnDestroy, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription, firstValueFrom, of, timeout, catchError, timer, switchMap } from 'rxjs';

import { TRADING_SYMBOLS } from '../../constants/symbols.constant';
import { StrategyService, UnifiedSignal } from '../../services/strategy.service';
import { MarketDataService } from '../../services/market-data.service';

// Type definitions
type Bar = { t: number; o: number; h: number; l: number; c: number };

// Find this interface near the top (around line 20)
interface TradeSignal {
  barIndex: number;
  type: 'BUY' | 'SELL';
  price: number;
  confidence: number;
  action?: string; // Add this - will be 'buy', 'strong_buy', 'sell', 'strong_sell'
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

    // Show label every 2 bars = 30 minutes for better spacing
    const labelEveryNBars = 1;

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

  private convertUnifiedSignalToTradeSignals(
    bars: Bar[],
    unifiedSignal: UnifiedSignal | null | undefined,
  ): TradeSignal[] {
    console.log('=== convertUnifiedSignalToTradeSignals CALLED ===');
    console.log('bars length:', bars?.length);
    console.log('unifiedSignal:', unifiedSignal);
    console.log('unifiedSignal type:', typeof unifiedSignal);

    if (!unifiedSignal) {
      console.log('❌ No unified signal - returning empty array');
      return [];
    }

    if (!bars.length) {
      console.log('❌ No bars - returning empty array');
      return [];
    }

    console.log('✅ Have signal and bars, processing...');

    const signals: TradeSignal[] = [];
    const lastIndex = bars.length - 1;

    const action = unifiedSignal.action;
    const confidence = unifiedSignal.confidence ?? 0;

    console.log('Signal action:', action);
    console.log('Signal confidence:', confidence);

    if (confidence < 0.5) {
      console.log('❌ Confidence too low:', confidence, '(need > 0.5)');
      return [];
    }

    let signalType: 'BUY' | 'SELL' | null = null;

    if (action === 'buy' || action === 'strong_buy') {
      signalType = 'BUY';
      console.log('✅ BUY signal detected');
    } else if (action === 'sell' || action === 'strong_sell') {
      signalType = 'SELL';
      console.log('✅ SELL signal detected');
    } else {
      console.log('❌ Action is', action, '- no badge to show');
    }

    if (!signalType) {
      console.log('❌ No signal type, returning empty');
      return [];
    }

    signals.push({
      barIndex: lastIndex,
      type: signalType,
      price: bars[lastIndex].c,
      confidence: confidence,
      action: action,
    });

    console.log('🎯 GENERATED SIGNAL:', signals[0]);
    console.log('=== END convertUnifiedSignalToTradeSignals ===');
    return signals;
  }

  /**
   * Calculate signals directly if StrategyService doesn't have them yet
   */
  private async ensureSignalsExist(symbol: string, bars: Bar[]): Promise<void> {
    try {
      // Check if we already have a signal
      const existingSignal = await firstValueFrom(
        this.strategy.getUnifiedSignal(symbol).pipe(
          timeout(2000),
          catchError(() => of(null)),
        ),
      );

      // If signal exists and is recent, use it
      if (existingSignal && existingSignal.action !== 'hold') {
        console.log('Using existing signal from StrategyService:', existingSignal);
        return;
      }

      console.log('No signal in StrategyService, calculating directly...');

      // Calculate SMA signal (same logic as watchlist)
      const closes = bars.map((b) => b.c);
      const smaSignal = this.calculateSMASignal(symbol, closes);

      if (smaSignal) {
        // Update StrategyService with our calculated signal
        this.strategy.updateTechnicalIndicator(
          symbol,
          'sma_cross',
          smaSignal.signal,
          smaSignal.strength,
        );
        console.log('Calculated and stored SMA signal:', smaSignal);
      }
    } catch (error) {
      console.error('Error ensuring signals exist:', error);
    }
  }

  /**
   * Calculate SMA signal (copied from watchlist)
   */
  private calculateSMASignal(
    symbol: string,
    closes: number[],
  ): { signal: 'buy' | 'sell' | 'neutral'; strength: number } | null {
    const fast = 5;
    const slow = 20;
    const lastIndex = closes.length - 1;

    const sma = (period: number, index: number): number => {
      if (index + 1 < period) return NaN;
      let sum = 0;
      for (let i = index - period + 1; i <= index; i++) {
        sum += closes[i];
      }
      return sum / period;
    };

    const sma5Now = sma(fast, lastIndex);
    const sma20Now = sma(slow, lastIndex);
    const sma5Prev = sma(fast, lastIndex - 1);
    const sma20Prev = sma(slow, lastIndex - 1);

    if (!isFinite(sma5Now) || !isFinite(sma20Now) || !isFinite(sma5Prev) || !isFinite(sma20Prev)) {
      return null;
    }

    // Bullish crossover
    if (sma5Prev <= sma20Prev && sma5Now > sma20Now) {
      const strength = Math.min(0.9, 0.6 + ((sma5Now - sma20Now) / sma20Now) * 10);
      return { signal: 'buy', strength };
    }
    // Bearish crossover
    if (sma5Prev >= sma20Prev && sma5Now < sma20Now) {
      const strength = Math.min(0.9, 0.6 + ((sma20Now - sma5Now) / sma20Now) * 10);
      return { signal: 'sell', strength };
    }

    return { signal: 'neutral', strength: 0.3 };
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
      await this.ensureSignalsExist(sym, b);

      // Get initial unified signal
      try {
        const unifiedSignal = await firstValueFrom(
          this.strategy.getUnifiedSignal(sym).pipe(
            timeout(5000),
            catchError(() => of(null)),
          ),
        );
        this.tradeSignals.set(this.convertUnifiedSignalToTradeSignals(b, unifiedSignal));
      } catch (error) {
        console.error('Error getting initial unified signal:', error);
        this.tradeSignals.set([]);
      }
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
        await this.ensureSignalsExist(s, b);

        // Get updated unified signal
        try {
          const unifiedSignal = await firstValueFrom(
            this.strategy.getUnifiedSignal(s).pipe(
              timeout(5000),
              catchError(() => of(null)),
            ),
          );
          this.tradeSignals.set(this.convertUnifiedSignalToTradeSignals(b, unifiedSignal));
        } catch (error) {
          console.error('Error getting unified signal:', error);
        }
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
    this.strategySubscription = this.strategy.getUnifiedSignal(sym).subscribe((unifiedSignal) => {
      console.log('Received unified signal for', sym, unifiedSignal);
      const bars = this.bars();

      // Convert unified signal to trade signals for display
      this.tradeSignals.set(this.convertUnifiedSignalToTradeSignals(bars, unifiedSignal));
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
