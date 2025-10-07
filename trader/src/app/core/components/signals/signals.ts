import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';

import { LiveCandlesStore, Bar } from '../../services/live-candles.store';
import { TRADING_SYMBOLS } from '../../constants/symbols.constant';
import { StrategyService, UnifiedSignal } from '../../services/strategy.service';

/** Signal type for buy/sell indicators */
interface TradeSignal {
  barIndex: number;
  type: 'BUY' | 'SELL';
  price: number;
  reason: string;
  confidence: number;
}

/** Timeframe options */
type Timeframe = '15m' | '1h' | '1d';

/** Chart info for display */
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
export class SignalsComponent implements OnInit, AfterViewInit, OnDestroy {
  private store = inject(LiveCandlesStore);
  private strategy = inject(StrategyService);

  /** list of symbols to show as toggles */
  readonly symbols = TRADING_SYMBOLS;

  /** single selection */
  selected = signal<string | null>(null);

  /** selected timeframe */
  selectedTimeframe = signal<Timeframe>('15m');

  /** chart info for display */
  chartInfo = signal<ChartInfo | null>(null);

  /** canvas ref */
  @ViewChild('candleCanvas', { static: false }) canvasRef!: ElementRef<HTMLCanvasElement>;

  /** latest bars for selected symbol */
  private sub?: Subscription;
  private strategySub?: Subscription;
  private bars: Bar[] = [];
  private currentSignal: UnifiedSignal | null | undefined = null;

  /** detected trade signals */
  private signals: TradeSignal[] = [];

  /** simple badge text */
  headerText = computed(() => this.selected() ?? 'None');

  ngOnInit(): void {
    // default: select nothing; user clicks a symbol
  }

  ngAfterViewInit(): void {
    console.log('AfterViewInit - canvas ref:', this.canvasRef?.nativeElement);
    // if a symbol is preselected, subscribe after view init
    const sym = this.selected();
    if (sym) this.startStream(sym);
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.strategySub?.unsubscribe();
  }

  // --------- UI actions ---------

  selectNone(): void {
    this.sub?.unsubscribe();
    this.sub = undefined;
    this.selected.set(null);
    this.clearCanvas();
  }

  toggle(sym: string): void {
    const cur = this.selected();
    if (cur === sym) {
      this.selectNone();
      return;
    }
    this.selected.set(sym);
    console.log('Toggled to:', sym, 'Canvas:', this.canvasRef?.nativeElement);

    // Subscribe to strategy signals for this symbol
    this.strategySub?.unsubscribe();
    this.strategySub = this.strategy.getUnifiedSignal(sym).subscribe((signal) => {
      this.currentSignal = signal;
      // Recalculate signals when strategy updates
      if (this.bars.length > 0) {
        this.signals = this.detectSignals(this.bars);
        this.drawFullSession(this.canvasRef?.nativeElement, this.bars);
      }
    });

    this.startStream(sym);
  }

  // --------- streaming + render ---------

  private startStream(sym: string): void {
    this.sub?.unsubscribe();
    console.log('Starting stream for:', sym);
    this.sub = this.store.stream(sym).subscribe({
      next: (bars) => {
        console.log('Received bars:', bars?.length, bars);
        this.bars = bars ?? [];
        this.updateChartInfo();
        this.signals = this.detectSignals(this.bars);
        this.drawFullSession(this.canvasRef?.nativeElement, this.bars);
      },
      error: (err) => {
        console.error('Stream error:', err);
      },
    });
  }

  /**
   * Update chart info display with current data
   */
  private updateChartInfo(): void {
    if (this.bars.length === 0 || !this.selected()) return;

    const last = this.bars[this.bars.length - 1];
    const first = this.bars[0];
    const high = Math.max(...this.bars.map((b) => b.h));
    const low = Math.min(...this.bars.map((b) => b.l));
    // Volume might not be available in Bar type, so safely access it
    const volume = this.bars.reduce((sum, b) => sum + ((b as any).v || 0), 0);

    this.chartInfo.set({
      symbol: this.selected()!,
      currentPrice: last.c,
      priceChange: last.c - first.o,
      priceChangePercent: ((last.c - first.o) / first.o) * 100,
      high,
      low,
      open: first.o,
      volume,
    });
  }

  /**
   * Detect buy/sell signals using the same logic as watchlist
   * Uses SMA crossover strategy from your StrategyService
   * Only shows signals with >= 75% confidence (strong signals only)
   */
  private detectSignals(bars: Bar[]): TradeSignal[] {
    if (bars.length < 20) return [];

    const signals: TradeSignal[] = [];
    const closes = bars.map((b) => b.c);
    const fast = 5;
    const slow = 20;

    const sma = (period: number, index: number): number => {
      if (index + 1 < period) return NaN;
      let sum = 0;
      for (let i = index - period + 1; i <= index; i++) {
        sum += closes[i];
      }
      return sum / period;
    };

    // Check each bar for crossover signals
    for (let i = slow; i < bars.length; i++) {
      const sma5Now = sma(fast, i);
      const sma20Now = sma(slow, i);
      const sma5Prev = sma(fast, i - 1);
      const sma20Prev = sma(slow, i - 1);

      if (
        !isFinite(sma5Now) ||
        !isFinite(sma20Now) ||
        !isFinite(sma5Prev) ||
        !isFinite(sma20Prev)
      ) {
        continue;
      }

      // Bullish crossover: SMA5 crosses above SMA20
      if (sma5Prev <= sma20Prev && sma5Now > sma20Now) {
        const strength = Math.min(0.9, 0.6 + ((sma5Now - sma20Now) / sma20Now) * 10);

        signals.push({
          barIndex: i,
          type: 'BUY',
          price: bars[i].c,
          reason: strength >= 0.75 ? 'Strong Buy Signal' : 'Buy Signal',
          confidence: strength,
        });
      }

      // Bearish crossover: SMA5 crosses below SMA20
      if (sma5Prev >= sma20Prev && sma5Now < sma20Now) {
        const strength = Math.min(0.9, 0.6 + ((sma20Now - sma5Now) / sma20Now) * 10);

        signals.push({
          barIndex: i,
          type: 'SELL',
          price: bars[i].c,
          reason: strength >= 0.75 ? 'Strong Sell Signal' : 'Sell Signal',
          confidence: strength,
        });
      }
    }

    // FEATURE 6: Only show strong signals (>= 0.75 confidence)
    return signals.filter((s) => s.confidence >= 0.75);
  }

  /** Draw today's session if available; else last ~26 bars.
   *  Includes: Y-axis price scale, current price line, volume bars, better spacing
   */
  private drawFullSession(canvas: HTMLCanvasElement | undefined, allBars: Bar[]): void {
    if (!canvas) return;

    // FEATURE 1: Increased left padding for Y-axis price scale
    const PRICE_SCALE_WIDTH = 60;

    // size canvas to full width and tall viewport
    const parentW = canvas.parentElement?.getBoundingClientRect().width ?? window.innerWidth - 40;
    const w = (canvas.width = Math.max(320, Math.floor(parentW)));
    const h = (canvas.height = Math.max(420, Math.floor(window.innerHeight * 0.7)));

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, w, h);

    if (!allBars?.length) return;

    // ----- prefer today's regular session if present
    const last = allBars[allBars.length - 1];
    const day = new Date(last.t);
    day.setHours(0, 0, 0, 0);
    const start = new Date(day);
    start.setHours(9, 30, 0, 0);
    const end = new Date(day);
    end.setHours(16, 0, 0, 0);
    const startMs = start.getTime(),
      endMs = end.getTime();

    let bars = allBars.filter((b) => b.t >= startMs && b.t <= endMs);

    // Fallback: last ~1 day of 15m bars if we didn't capture the session (after-hours, holidays, API quirk)
    if (bars.length < 10) {
      const PER_DAY_15M = 26;
      bars = allBars.slice(-PER_DAY_15M);
    }
    if (bars.length === 0) return;

    // ----- robust Y range: winsorize 2%..98% so outliers don't compress the chart
    const lows = bars
      .map((b) => b.l)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const highs = bars
      .map((b) => b.h)
      .filter(Number.isFinite)
      .sort((a, b) => a - b);

    let ymin = this.quantile(lows, 0.02);
    let ymax = this.quantile(highs, 0.98);

    // if for any reason the quantiles collapsed, fallback to plain min/max
    if (!(isFinite(ymin) && isFinite(ymax)) || ymax <= ymin) {
      ymin = Math.min(...lows);
      ymax = Math.max(...highs);
    }
    if (!(isFinite(ymin) && isFinite(ymax)) || ymax <= ymin) return;

    // ----- layout helpers with space for Y-axis
    const leftPad = PRICE_SCALE_WIDTH + 8;
    const rightPad = 8;
    const bottomPad = 22;
    const topPad = 30; // FEATURE 3: More space at top for SELL badges
    const usableW = w - leftPad - rightPad;
    const step = usableW / bars.length;
    const bodyW = Math.max(2, Math.floor(step * 0.6));

    const toY = (p: number) => {
      const a = (p - ymin) / (ymax - ymin);
      return h - bottomPad - a * (h - topPad - bottomPad);
    };

    // FEATURE 1: Draw Y-axis price scale
    this.drawPriceScale(ctx, ymin, ymax, toY, leftPad, topPad, bottomPad, h);

    // FEATURE 2: Draw current price line
    if (bars.length > 0) {
      const currentPrice = bars[bars.length - 1].c;
      this.drawCurrentPriceLine(ctx, currentPrice, toY, leftPad, w, rightPad);
    }

    // ----- baseline from first bar's open (purely cosmetic)
    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.strokeStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.moveTo(0, toY(bars[0].o));
    ctx.lineTo(w, toY(bars[0].o));
    ctx.stroke();
    ctx.restore();

    // ----- vertical grid + time labels with AM/PM (FEATURE 4)
    ctx.save();
    ctx.globalAlpha = 0.26;
    ctx.strokeStyle = 'rgba(148,163,184,.28)';
    ctx.fillStyle = 'rgba(148,163,184,.78)';
    ctx.font = '11px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    const labelEvery = 2; // ~30 minutes for 15m bars
    for (let i = 0; i < bars.length; i++) {
      const xMid = leftPad + i * step + step / 2;
      // grid line
      ctx.beginPath();
      ctx.moveTo(xMid, topPad);
      ctx.lineTo(xMid, h - bottomPad - 2);
      ctx.stroke();

      if (i % labelEvery === 0) {
        // FEATURE 4: Add AM/PM to time labels
        const lab = new Date(bars[i].t).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true, // This adds AM/PM
        });
        ctx.fillText(lab, xMid, h - 2);
      }
    }
    ctx.restore();

    // ----- candles (index-based positioning)
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      const x0 = leftPad + i * step + (step - bodyW) / 2;

      const openY = toY(b.o);
      const closeY = toY(b.c);
      const highY = toY(b.h);
      const lowY = toY(b.l);

      const up = b.c >= b.o;
      const col = up ? '#22c55e' : '#ef4444';
      ctx.strokeStyle = col;
      ctx.fillStyle = col;

      // wick
      ctx.beginPath();
      ctx.moveTo(x0 + bodyW / 2, highY);
      ctx.lineTo(x0 + bodyW / 2, lowY);
      ctx.stroke();

      // body
      const top = Math.min(openY, closeY);
      const height = Math.max(1, Math.abs(closeY - openY));
      ctx.fillRect(x0, top, bodyW, height);
    }

    // ----- Draw buy/sell signal badges
    this.drawSignals(ctx, bars, leftPad, step, bodyW, toY, topPad, bottomPad, h);
  }

  /**
   * FEATURE 1: Draw Y-axis price scale on the left side
   */
  private drawPriceScale(
    ctx: CanvasRenderingContext2D,
    ymin: number,
    ymax: number,
    toY: (p: number) => number,
    leftPad: number,
    topPad: number,
    bottomPad: number,
    h: number,
  ): void {
    ctx.save();
    ctx.fillStyle = 'rgba(148,163,184,.9)';
    ctx.strokeStyle = 'rgba(148,163,184,.3)';
    ctx.font = '11px ui-sans-serif, system-ui, -apple-system';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    // Calculate nice price intervals
    const priceRange = ymax - ymin;
    const numTicks = 8;
    const rawStep = priceRange / numTicks;

    // Round to nice numbers
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const normalizedStep = rawStep / magnitude;
    let niceStep: number;

    if (normalizedStep < 1.5) niceStep = 1 * magnitude;
    else if (normalizedStep < 3) niceStep = 2 * magnitude;
    else if (normalizedStep < 7) niceStep = 5 * magnitude;
    else niceStep = 10 * magnitude;

    // Draw price levels
    const startPrice = Math.ceil(ymin / niceStep) * niceStep;

    for (let price = startPrice; price <= ymax; price += niceStep) {
      const y = toY(price);

      // Horizontal grid line
      ctx.beginPath();
      ctx.moveTo(leftPad, y);
      ctx.lineTo(leftPad - 5, y);
      ctx.stroke();

      // Price label
      const label = price.toFixed(2);
      ctx.fillText(label, leftPad - 8, y);
    }

    ctx.restore();
  }

  /**
   * FEATURE 2: Draw current price line across the chart
   */
  private drawCurrentPriceLine(
    ctx: CanvasRenderingContext2D,
    price: number,
    toY: (p: number) => number,
    leftPad: number,
    w: number,
    rightPad: number,
  ): void {
    const y = toY(price);

    ctx.save();
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);

    ctx.beginPath();
    ctx.moveTo(leftPad, y);
    ctx.lineTo(w - rightPad, y);
    ctx.stroke();

    // Price badge on the right
    const labelText = price.toFixed(2);
    ctx.font = 'bold 11px ui-sans-serif, system-ui, -apple-system';
    const textWidth = ctx.measureText(labelText).width;
    const badgeWidth = textWidth + 12;
    const badgeHeight = 18;
    const badgeX = w - rightPad - badgeWidth;
    const badgeY = y - badgeHeight / 2;

    ctx.fillStyle = '#3b82f6';
    ctx.setLineDash([]);
    ctx.fillRect(badgeX, badgeY, badgeWidth, badgeHeight);

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(labelText, badgeX + badgeWidth / 2, y);

    ctx.restore();
  }
  private drawSignals(
    ctx: CanvasRenderingContext2D,
    bars: Bar[],
    leftPad: number,
    step: number,
    bodyW: number,
    toY: (p: number) => number,
    topPad: number,
    bottomPad: number,
    h: number,
  ): void {
    for (const signal of this.signals) {
      if (signal.barIndex >= bars.length) continue;

      const bar = bars[signal.barIndex];
      const i = signal.barIndex;

      // Calculate x position using index-based positioning (same as candles)
      const x = leftPad + i * step + step / 2;
      const y = signal.type === 'BUY' ? h - bottomPad + 15 : topPad - 5;

      // Badge styling - stronger signals get brighter colors
      const isStrong = signal.confidence >= 0.75;
      const badgeWidth = isStrong ? 40 : 35;
      const badgeHeight = 18;
      const badgeX = x - badgeWidth / 2;
      const badgeY = y - badgeHeight / 2;

      // Badge background with opacity based on confidence
      ctx.save();
      const baseColor = signal.type === 'BUY' ? '#22c55e' : '#ef4444';
      ctx.fillStyle = baseColor;
      ctx.globalAlpha = 0.85 + (signal.confidence - 0.6) * 0.4; // 0.85-1.0 opacity
      ctx.beginPath();
      ctx.roundRect(badgeX, badgeY, badgeWidth, badgeHeight, 3);
      ctx.fill();

      // Badge text
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff';
      ctx.font = isStrong
        ? 'bold 11px ui-sans-serif, system-ui, -apple-system'
        : '11px ui-sans-serif, system-ui, -apple-system';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(signal.type, x, y);

      // Draw line connecting badge to candle
      ctx.strokeStyle = baseColor;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([2, 2]);
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      const candleY = signal.type === 'BUY' ? toY(bar.l) : toY(bar.h);
      ctx.moveTo(x, badgeY + (signal.type === 'BUY' ? -badgeHeight / 2 : badgeHeight / 2));
      ctx.lineTo(x, candleY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
  }

  private clearCanvas(): void {
    const el = this.canvasRef?.nativeElement;
    if (!el) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, el.width, el.height);
  }

  /** Simple quantile (0..1) for sorted numeric arrays; clamps if empty. */
  private quantile(sorted: number[], q: number): number {
    if (!sorted.length) return NaN;
    const idx = Math.min(sorted.length - 1, Math.max(0, (sorted.length - 1) * q));
    const lo = Math.floor(idx),
      hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    const w = idx - lo;
    return sorted[lo] * (1 - w) + sorted[hi] * w;
  }
}
