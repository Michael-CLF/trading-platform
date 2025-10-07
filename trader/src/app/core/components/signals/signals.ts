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
import { Subscription, firstValueFrom, of, timeout, catchError, timer } from 'rxjs';

import { TRADING_SYMBOLS } from '../../constants/symbols.constant';
import { StrategyService, UnifiedSignal } from '../../services/strategy.service';
import { MarketDataService } from '../../services/market-data.service';

/** Bar type */
type Bar = { t: number; o: number; h: number; l: number; c: number };

/** Buy/Sell badge for the canvas */
interface TradeSignal {
  barIndex: number;
  type: 'BUY' | 'SELL';
  price: number;
  reason: string;
  confidence: number;
}

/** Info panel */
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
  private market = inject(MarketDataService);
  private strategy = inject(StrategyService);

  /** toolbar symbols */
  readonly symbols = TRADING_SYMBOLS;

  /** single selection for the current template */
  selected = signal<string | null>(null);

  /** chart info signal (used by the info panel block in the template) */
  chartInfo = signal<ChartInfo | null>(null);

  /** canvas */
  @ViewChild('candleCanvas', { static: false }) canvasRef!: ElementRef<HTMLCanvasElement>;

  /** data + subs */
  private bars: Bar[] = [];
  private currentSignal: UnifiedSignal | null | undefined = null;
  private signals: TradeSignal[] = [];
  private refreshSub?: Subscription;
  private strategySub?: Subscription;

  /** header text helper */
  headerText = computed(() => this.selected() ?? 'None');

  /** polling cadence for live updates (15m bars) */
  private readonly UPDATE_MS = 60_000; // light 1-min poll; bar boundary alignment handled in service

  ngOnInit(): void {
    // nothing selected initially
  }

  ngAfterViewInit(): void {
    const sym = this.selected();
    if (sym) {
      this.start(sym);
    }
  }

  ngOnDestroy(): void {
    this.teardown();
  }

  /** ---------------- UI actions ---------------- */

  selectNone(): void {
    this.teardown();
    this.selected.set(null);
    this.clearCanvas();
    this.chartInfo.set(null);
  }

  toggle(sym: string): void {
    const cur = this.selected();
    if (cur === sym) {
      this.selectNone();
      return;
    }

    // single select
    this.selected.set(sym);

    // rewire strategy subscription for badges
    this.strategySub?.unsubscribe();
    this.strategySub = this.strategy.getUnifiedSignal(sym).subscribe((sig) => {
      this.currentSignal = sig;
      if (this.bars.length) {
        this.signals = this.detectSignals(this.bars);
        this.drawFullSession(this.canvasRef?.nativeElement, this.bars);
      }
    });

    this.start(sym);
  }

  /** ---------------- data lifecycle ---------------- */

  private start(sym: string): void {
    this.teardown(); // clear prior polling

    // initial fetch immediately
    this.fetchBars(sym).then((bars) => {
      this.bars = bars;
      this.updateChartInfo();
      this.signals = this.detectSignals(this.bars);
      this.drawFullSession(this.canvasRef?.nativeElement, this.bars);
    });

    // light polling to keep the last bar fresh
    this.refreshSub = timer(this.UPDATE_MS, this.UPDATE_MS).subscribe(() => {
      const s = this.selected();
      if (!s) return;
      this.fetchBars(s).then((bars) => {
        this.bars = bars;
        this.updateChartInfo();
        this.signals = this.detectSignals(this.bars);
        this.drawFullSession(this.canvasRef?.nativeElement, this.bars);
      });
    });
  }

  private teardown(): void {
    this.refreshSub?.unsubscribe();
    this.refreshSub = undefined;
    this.strategySub?.unsubscribe();
    this.strategySub = undefined;
  }

  private async fetchBars(symbol: string): Promise<Bar[]> {
    // Pull the same way your “working yesterday” file did
    const raw = await firstValueFrom(
      this.market.getBars15m(symbol, '5d').pipe(
        timeout(8000),
        catchError(() => of([] as any[])),
      ),
    );

    const bars: Bar[] = (raw as any[]).map((b) => ({
      t: b.t ?? b.time ?? b.timestamp ?? Date.now(),
      o: b.o ?? b.open,
      h: b.h ?? b.high,
      l: b.l ?? b.low,
      c: b.c ?? b.close,
    }));

    // Keep a tidy window (60 bars) just like before
    return bars.filter(isBarValid).slice(-60);

    function isBarValid(x: Bar): x is Bar {
      return (
        typeof x.t === 'number' &&
        isFinite(x.t) &&
        [x.o, x.h, x.l, x.c].every((n) => typeof n === 'number' && isFinite(n))
      );
    }
  }

  /** ---------------- info panel ---------------- */

  private updateChartInfo(): void {
    if (this.bars.length === 0 || !this.selected()) return;

    const last = this.bars[this.bars.length - 1];
    const first = this.bars[0];

    const high = Math.max(...this.bars.map((b) => b.h));
    const low = Math.min(...this.bars.map((b) => b.l));
    const volume = 0; // not provided on 15m route in your old flow

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

  /** ---------------- signal detection (SMA 5/20) ---------------- */

  private detectSignals(bars: Bar[]): TradeSignal[] {
    if (bars.length < 20) return [];

    const closes = bars.map((b) => b.c);
    const fast = 5;
    const slow = 20;

    const sma = (period: number, i: number): number => {
      if (i + 1 < period) return NaN;
      let sum = 0;
      for (let k = i - period + 1; k <= i; k++) sum += closes[k];
      return sum / period;
    };

    const out: TradeSignal[] = [];
    for (let i = slow; i < bars.length; i++) {
      const s5 = sma(fast, i);
      const s20 = sma(slow, i);
      const s5p = sma(fast, i - 1);
      const s20p = sma(slow, i - 1);
      if (![s5, s20, s5p, s20p].every(Number.isFinite)) continue;

      // Bullish crossover
      if (s5p <= s20p && s5 > s20) {
        const conf = Math.min(0.9, 0.6 + ((s5 - s20) / s20) * 10);
        out.push({
          barIndex: i,
          type: 'BUY',
          price: bars[i].c,
          reason: conf >= 0.75 ? 'Strong Buy Signal' : 'Buy Signal',
          confidence: conf,
        });
      }
      // Bearish crossover
      if (s5p >= s20p && s5 < s20) {
        const conf = Math.min(0.9, 0.6 + ((s20 - s5) / s20) * 10);
        out.push({
          barIndex: i,
          type: 'SELL',
          price: bars[i].c,
          reason: conf >= 0.75 ? 'Strong Sell Signal' : 'Sell Signal',
          confidence: conf,
        });
      }
    }

    return out.filter((s) => s.confidence >= 0.75);
  }

  /** ---------------- canvas drawing (unchanged layout, sturdier fallbacks) ---------------- */

  private drawFullSession(canvas: HTMLCanvasElement | undefined, allBars: Bar[]): void {
    if (!canvas) return;

    // Price scale width for left axis
    const PRICE_SCALE_WIDTH = 60;

    // Size canvas to container width + tall viewport height
    const parentW = canvas.parentElement?.getBoundingClientRect().width ?? window.innerWidth - 40;
    const w = (canvas.width = Math.max(320, Math.floor(parentW)));
    const h = (canvas.height = Math.max(420, Math.floor(window.innerHeight * 0.7)));

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);

    if (!allBars?.length) return;

    // Try to render today's regular session; if not enough bars, fall back to last ~26 bars
    const last = allBars[allBars.length - 1];
    const day = new Date(last.t);
    day.setHours(0, 0, 0, 0);
    const start = new Date(day);
    start.setHours(9, 30, 0, 0);
    const end = new Date(day);
    end.setHours(16, 0, 0, 0);

    const startMs = start.getTime();
    const endMs = end.getTime();

    let bars = allBars.filter((b) => b.t >= startMs && b.t <= endMs);
    if (bars.length < 10) {
      // Market closed: draw last day's worth of 15m bars
      const PER_DAY_15M = 26;
      bars = allBars.slice(-PER_DAY_15M);
    }
    if (bars.length === 0) return;

    // Winsorized Y range for stability
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
    if (!(isFinite(ymin) && isFinite(ymax)) || ymax <= ymin) {
      ymin = Math.min(...lows);
      ymax = Math.max(...highs);
    }
    if (!(isFinite(ymin) && isFinite(ymax)) || ymax <= ymin) return;

    // Layout
    const leftPad = PRICE_SCALE_WIDTH + 8;
    const rightPad = 8;
    const bottomPad = 22;
    const topPad = 30;
    const usableW = w - leftPad - rightPad;
    const step = usableW / bars.length;
    const bodyW = Math.max(2, Math.floor(step * 0.6));

    const toY = (p: number) => {
      const a = (p - ymin) / (ymax - ymin);
      return h - bottomPad - a * (h - topPad - bottomPad);
    };

    // Y-axis price scale
    this.drawPriceScale(ctx, ymin, ymax, toY, leftPad, topPad, bottomPad, h);

    // Current price dashed line
    if (bars.length > 0) {
      const currentPrice = bars[bars.length - 1].c;
      this.drawCurrentPriceLine(ctx, currentPrice, toY, leftPad, w, rightPad);
    }

    // Baseline (first bar’s open)
    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.strokeStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.moveTo(0, toY(bars[0].o));
    ctx.lineTo(w, toY(bars[0].o));
    ctx.stroke();
    ctx.restore();

    // Vertical grid + time labels
    ctx.save();
    ctx.globalAlpha = 0.26;
    ctx.strokeStyle = 'rgba(148,163,184,.28)';
    ctx.fillStyle = 'rgba(148,163,184,.78)';
    ctx.font = '11px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    const labelEvery = 2; // ~30 minutes at 15m bars
    for (let i = 0; i < bars.length; i++) {
      const xMid = leftPad + i * step + step / 2;
      ctx.beginPath();
      ctx.moveTo(xMid, topPad);
      ctx.lineTo(xMid, h - bottomPad - 2);
      ctx.stroke();

      if (i % labelEvery === 0) {
        const lab = new Date(bars[i].t).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        });
        ctx.fillText(lab, xMid, h - 2);
      }
    }
    ctx.restore();

    // Candles
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

    // Buy/Sell badges
    this.drawSignals(ctx, bars, leftPad, step, bodyW, toY, topPad, bottomPad, h);
  }

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

    const range = ymax - ymin;
    const numTicks = 8;
    const rawStep = range / numTicks;
    const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
    const norm = rawStep / mag;
    let step: number;
    if (norm < 1.5) step = 1 * mag;
    else if (norm < 3) step = 2 * mag;
    else if (norm < 7) step = 5 * mag;
    else step = 10 * mag;

    const startPrice = Math.ceil(ymin / step) * step;
    for (let price = startPrice; price <= ymax; price += step) {
      const y = toY(price);
      ctx.beginPath();
      ctx.moveTo(leftPad, y);
      ctx.lineTo(leftPad - 5, y);
      ctx.stroke();
      ctx.fillText(price.toFixed(2), leftPad - 8, y);
    }
    ctx.restore();
  }

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

    // badge
    const label = price.toFixed(2);
    ctx.font = 'bold 11px ui-sans-serif, system-ui, -apple-system';
    const tw = ctx.measureText(label).width;
    const bw = tw + 12;
    const bh = 18;
    const bx = w - rightPad - bw;
    const by = y - bh / 2;

    ctx.fillStyle = '#3b82f6';
    ctx.setLineDash([]);
    ctx.fillRect(bx, by, bw, bh);

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx + bw / 2, y);
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
    for (const s of this.signals) {
      if (s.barIndex >= bars.length) continue;
      const bar = bars[s.barIndex];
      const i = s.barIndex;

      const x = leftPad + i * step + step / 2;
      const chartHeight = h - topPad - bottomPad;
      const y =
        s.type === 'BUY'
          ? h - bottomPad - chartHeight * 0.15 // 15% up from bottom
          : topPad + chartHeight * 0.15; // 15% down from top

      const isStrong = s.confidence >= 0.75;
      const bw = isStrong ? 40 : 35;
      const bh = 18;
      const bx = x - bw / 2;
      const by = y - bh / 2;

      ctx.save();
      const base = s.type === 'BUY' ? '#22c55e' : '#ef4444';
      ctx.fillStyle = base;
      ctx.globalAlpha = 0.85 + (s.confidence - 0.6) * 0.4;
      (ctx as any).roundRect?.(bx, by, bw, bh, 3);
      // Fallback if roundRect is not supported
      if (!(ctx as any).roundRect) {
        ctx.beginPath();
        ctx.rect(bx, by, bw, bh);
      }
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff';
      ctx.font = isStrong
        ? 'bold 11px ui-sans-serif, system-ui, -apple-system'
        : '11px ui-sans-serif, system-ui, -apple-system';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(s.type, x, y);

      // connector
      ctx.strokeStyle = base;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([2, 2]);
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      const candleY = s.type === 'BUY' ? toY(bar.l) : toY(bar.h);
      ctx.moveTo(x, by + (s.type === 'BUY' ? -bh / 2 : bh / 2));
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

  /** quantile helper */
  private quantile(sorted: number[], q: number): number {
    if (!sorted.length) return NaN;
    const idx = Math.min(sorted.length - 1, Math.max(0, (sorted.length - 1) * q));
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    const w = idx - lo;
    return sorted[lo] * (1 - w) + sorted[hi] * w;
  }
}
