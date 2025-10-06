import {
  Component,
  OnInit,
  OnDestroy,
  AfterViewInit,
  ViewChildren,
  ElementRef,
  QueryList,
  signal,
  computed,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { timer, Subscription, firstValueFrom, timeout, of, catchError } from 'rxjs';

import { MarketDataService } from '../../services/market-data.service';
import { StrategyService, UnifiedSignal } from '../../services/strategy.service';
import { TRADING_SYMBOLS } from '../../constants/symbols.constant';

type Bar = { t: number; o: number; h: number; l: number; c: number };

@Component({
  selector: 'app-signals', // keep the route/component name
  standalone: true,
  imports: [CommonModule],
  templateUrl: './signals.html', // we'll send this next
  styleUrls: ['./signals.scss'], // and this after
})
export class SignalsComponent implements OnInit, OnDestroy, AfterViewInit {
  private market = inject(MarketDataService);
  private strategy = inject(StrategyService);

  /** Symbols to render (use your constant list) */
  readonly symbols = TRADING_SYMBOLS;

  /** Bars per symbol (ring buffer of last N candles) */
  private readonly MAX_BARS = 60;
  barsMap = signal(new Map<string, Bar[]>());

  /** Optional: latest unified signal per symbol for tile outlines */
  signalMap = signal(new Map<string, UnifiedSignal>());

  /** Grid sizing */
  tileWidth = 260;
  tileHeight = 120;

  /** Schedule (align to 15-minute close + 30s) */
  private readonly UPDATE_INTERVAL_MS = 15 * 60 * 1000;
  private readonly INITIAL_DELAY_MS = this.calculateInitialDelay();
  private updateSub?: Subscription;
  private signalSub?: Subscription;

  /** Canvas refs for each tile */
  @ViewChildren('candleCanvas') canvases!: QueryList<ElementRef<HTMLCanvasElement>>;

  /** Derived: list used for rendering order */
  visibleSymbols = computed(() => this.symbols);

  ngOnInit(): void {
    // Seed with empty arrays so template can render immediately
    const seed = new Map<string, Bar[]>();
    for (const s of this.symbols) seed.set(s, []);
    this.barsMap.set(seed);

    // Initial pull
    this.refreshAll().then(() => this.renderAll());

    // Align to 15m cadence (next boundary + 30s)
    this.updateSub = timer(this.INITIAL_DELAY_MS, this.UPDATE_INTERVAL_MS).subscribe(() => {
      this.refreshAll().then(() => this.renderAll());
    });

    // Optional: subscribe to unified signals to style tile borders
    this.signalSub = this.strategy.getAllUnifiedSignals().subscribe((list) => {
      const map = new Map<string, UnifiedSignal>();
      for (const s of list) map.set(s.symbol, s);
      this.signalMap.set(map);
    });
  }

  ngAfterViewInit(): void {
    // Initial draw once canvases exist
    queueMicrotask(() => this.renderAll());
  }

  ngOnDestroy(): void {
    this.updateSub?.unsubscribe();
    this.signalSub?.unsubscribe();
  }

  /** Pull last 5d of 15m bars for all symbols (parallel) and keep last MAX_BARS */
  private async refreshAll(): Promise<void> {
    const map = new Map(this.barsMap());
    await Promise.all(
      this.symbols.map(async (symbol) => {
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

        // keep only the last MAX_BARS
        map.set(symbol, bars.slice(-this.MAX_BARS));
      }),
    );
    this.barsMap.set(map);
  }

  /** Draw all canvases based on current bars */
  renderAll(): void {
    const order = this.visibleSymbols();
    const refs = this.canvases?.toArray() ?? [];
    for (let i = 0; i < order.length && i < refs.length; i++) {
      const symbol = order[i];
      const el = refs[i]?.nativeElement;
      if (el) this.drawMiniCandles(el, this.barsMap().get(symbol) ?? []);
    }
  }

  /** Candlestick renderer (canvas) */
  private drawMiniCandles(canvas: HTMLCanvasElement, bars: Bar[]): void {
    const w = (canvas.width = this.tileWidth); // set width/height on each draw to clear
    const h = (canvas.height = this.tileHeight);

    const ctx = canvas.getContext('2d');
    if (!ctx || bars.length === 0) return;

    // Find range
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const b of bars) {
      if (b.l < min) min = b.l;
      if (b.h > max) max = b.h;
    }
    if (!isFinite(min) || !isFinite(max) || max <= min) return;

    const toY = (price: number) => {
      const p = (price - min) / (max - min);
      return h - p * (h - 8) - 4; // 4px vertical padding
    };

    // Layout
    const n = bars.length;
    const gap = 1; // 1px gap between candles
    const slot = (w - 8) / n; // horizontal slot per bar
    const body = Math.max(1, Math.floor(slot - gap)); // body width

    // Baseline (first close)
    ctx.globalAlpha = 0.15;
    ctx.strokeStyle = '#cbd5e1';
    ctx.beginPath();
    const baseY = toY(bars[0].c);
    ctx.moveTo(0, baseY);
    ctx.lineTo(w, baseY);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Candles
    for (let i = 0; i < n; i++) {
      const b = bars[i];
      const x = 4 + i * slot + (slot - body) / 2;

      const openY = toY(b.o);
      const closeY = toY(b.c);
      const highY = toY(b.h);
      const lowY = toY(b.l);

      const up = b.c >= b.o;
      ctx.strokeStyle = up ? '#22c55e' : '#ef4444';
      ctx.fillStyle = up ? '#22c55e' : '#ef4444';

      // wick
      ctx.beginPath();
      ctx.moveTo(x + body / 2, highY);
      ctx.lineTo(x + body / 2, lowY);
      ctx.stroke();

      // body
      const top = Math.min(openY, closeY);
      const height = Math.max(1, Math.abs(closeY - openY));
      ctx.fillRect(x, top, body, height);
    }
  }

  /** Next 15-minute boundary + 30 seconds (ms) */
  private calculateInitialDelay(): number {
    const now = new Date();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    const millis = now.getMilliseconds();

    const minutesToNext15 = 15 - (minutes % 15);
    const delayMin = minutesToNext15 === 15 ? 0 : minutesToNext15;
    const totalMs = (delayMin * 60 + 30 - seconds) * 1000 - millis;
    const periodMs = 15 * 60 * 1000;
    return totalMs > 0 ? totalMs : totalMs + periodMs;
  }

  /** helper to read a tile's class from its unified signal (optional styling) */
  tileClass(sym: string): string {
    const s = this.signalMap().get(sym);
    if (!s?.action) return '';
    switch (s.action) {
      case 'strong_buy':
        return 'strong-buy';
      case 'buy':
        return 'buy';
      case 'strong_sell':
        return 'strong-sell';
      case 'sell':
        return 'sell';
      default:
        return 'hold';
    }
  }
}
