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
  HostListener,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { timer, Subscription, firstValueFrom, timeout, of, catchError } from 'rxjs';

import { MarketDataService } from '../../services/market-data.service';
import { StrategyService, UnifiedSignal } from '../../services/strategy.service';
import { TRADING_SYMBOLS } from '../../constants/symbols.constant';

type Bar = { t: number; o: number; h: number; l: number; c: number };

@Component({
  selector: 'app-signals',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './signals.html',
  styleUrls: ['./signals.scss'],
})
export class SignalsComponent implements OnInit, OnDestroy, AfterViewInit {
  private market = inject(MarketDataService);
  private strategy = inject(StrategyService);

  /** master list */
  readonly symbols = TRADING_SYMBOLS;

  /** single-symbol mode: one chart at a time (checkboxes behave like radio) */
  private readonly SINGLE_MODE = true;
  selected = signal<Set<string>>(new Set()); // when empty, show none (you can change to default symbol if you prefer)

  /** cadence */
  private readonly UPDATE_INTERVAL_MS = 15 * 60 * 1000;
  private readonly INITIAL_DELAY_MS = this.calculateInitialDelay();
  private updateSub?: Subscription;
  private signalSub?: Subscription;

  /** data */
  private readonly MAX_BARS = 60;
  barsMap = signal(new Map<string, Bar[]>());
  signalMap = signal(new Map<string, UnifiedSignal>());

  /** canvases */
  @ViewChildren('candleCanvas') canvases!: QueryList<ElementRef<HTMLCanvasElement>>;

  /** derived list — SINGLE_MODE returns at most one symbol */
  visibleSymbols = computed(() => {
    const sel = Array.from(this.selected());
    if (this.SINGLE_MODE) {
      return sel.length ? [sel[0]] : []; // show only the first selected symbol
    }
    return sel.length ? sel : this.symbols;
  });

  /** canvas height: larger for single view */
  canvasHeight = computed(() => (this.SINGLE_MODE ? 260 : 120));

  ngOnInit(): void {
    const seed = new Map<string, Bar[]>();
    for (const s of this.symbols) seed.set(s, []);
    this.barsMap.set(seed);

    this.refreshAll().then(() => this.renderAll());

    this.updateSub = timer(this.INITIAL_DELAY_MS, this.UPDATE_INTERVAL_MS).subscribe(() => {
      this.refreshAll().then(() => this.renderAll());
    });

    this.signalSub = this.strategy.getAllUnifiedSignals().subscribe((list) => {
      const map = new Map<string, UnifiedSignal>();
      for (const s of list) map.set(s.symbol, s);
      this.signalMap.set(map);
    });
  }

  ngAfterViewInit(): void {
    queueMicrotask(() => this.renderAll());
  }

  ngOnDestroy(): void {
    this.updateSub?.unsubscribe();
    this.signalSub?.unsubscribe();
  }

  @HostListener('window:resize')
  onResize() {
    this.renderAll();
  }

  /** UI actions (checkbox behaves like radio in SINGLE_MODE) */
  toggleSymbol(sym: string) {
    if (this.SINGLE_MODE) {
      const set = new Set<string>(this.selected());
      if (set.has(sym)) set.clear();
      else {
        set.clear();
        set.add(sym);
      }
      this.selected.set(set);
    } else {
      const set = new Set(this.selected());
      set.has(sym) ? set.delete(sym) : set.add(sym);
      this.selected.set(set);
    }
    queueMicrotask(() => this.renderAll());
  }

  selectAll() {
    if (this.SINGLE_MODE) return; // ignore in single mode
    this.selected.set(new Set(this.symbols));
    queueMicrotask(() => this.renderAll());
  }

  clearSelection() {
    this.selected.set(new Set());
    queueMicrotask(() => this.renderAll());
  }

  /** data refresh */
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
        map.set(symbol, bars.slice(-this.MAX_BARS));
      }),
    );
    this.barsMap.set(map);
  }

  /** render */
  renderAll(): void {
    const order = this.visibleSymbols();
    const refs = this.canvases?.toArray() ?? [];
    for (let i = 0; i < order.length && i < refs.length; i++) {
      const sym = order[i];
      const el = refs[i]?.nativeElement;
      if (el) this.drawMiniCandles(el, this.barsMap().get(sym) ?? []);
    }
  }
  private drawMiniCandles(
    canvas: HTMLCanvasElement,
    allBars: { t: number; o: number; h: number; l: number; c: number }[],
  ): void {
    // Size to container width + tall viewport height
    const parentW = canvas.parentElement?.getBoundingClientRect().width ?? window.innerWidth - 40;
    const w = (canvas.width = Math.max(320, Math.floor(parentW)));
    const h = (canvas.height = Math.max(420, Math.floor(window.innerHeight * 0.6)));

    const ctx = canvas.getContext('2d');
    if (!ctx || !allBars?.length) return;

    // ---- Pick the trading session FROM THE LAST BAR WE HAVE
    //     (avoids "today vs UTC" mismatches)
    const last = allBars[allBars.length - 1];
    const sessionDay = new Date(last.t); // local date of last bar
    sessionDay.setHours(0, 0, 0, 0);

    // Session bounds (local time); if you want ET specifically I can wire that
    const start = new Date(sessionDay);
    start.setHours(9, 30, 0, 0);
    const end = new Date(sessionDay);
    end.setHours(16, 0, 0, 0);
    const startMs = start.getTime(),
      endMs = end.getTime();

    // Bars that fall inside this session; if none, fall back to last *day’s* worth (~26 bars @15m)
    let bars = allBars.filter((b) => b.t >= startMs && b.t <= endMs);
    if (bars.length === 0) {
      const PER_DAY_15M = 26;
      bars = allBars.slice(-PER_DAY_15M);
    }
    if (bars.length === 0) return;

    // ---- continue with the rest of the function unchanged...
    const BAR_MS = 15 * 60 * 1000;

    // y-range
    let min = Number.POSITIVE_INFINITY,
      max = Number.NEGATIVE_INFINITY;
    for (const b of bars) {
      if (b.l < min) min = b.l;
      if (b.h > max) max = b.h;
    }
    if (!(isFinite(min) && isFinite(max)) || max <= min) return;

    const leftPad = 8,
      rightPad = 8,
      bottomPad = 20,
      topPad = 6;
    const toY = (p: number) => {
      const a = (p - min) / (max - min);
      return h - bottomPad - a * (h - topPad - bottomPad);
    };
    const usableW = w - leftPad - rightPad;
    const toX = (tms: number) => {
      let p = (tms - startMs) / (endMs - startMs);
      p = Math.max(0, Math.min(1, p));
      return leftPad + p * usableW;
    };

    ctx.clearRect(0, 0, w, h);

    // baseline
    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.strokeStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.moveTo(0, toY(bars[0].c));
    ctx.lineTo(w, toY(bars[0].c));
    ctx.stroke();
    ctx.restore();

    // 30-minute grid + labels
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.strokeStyle = 'rgba(148,163,184,.28)';
    ctx.fillStyle = 'rgba(148,163,184,.78)';
    ctx.font = '11px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    const HALF_HOUR = 30 * 60 * 1000;
    let lastLabelX = -1e9;
    const minLabelSpacing = 80;

    for (let t = startMs; t <= endMs; t += HALF_HOUR) {
      const x = toX(t);
      ctx.beginPath();
      ctx.moveTo(x, topPad);
      ctx.lineTo(x, h - bottomPad - 2);
      ctx.stroke();

      if (x - lastLabelX >= minLabelSpacing) {
        const lab = new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        ctx.fillText(lab, x, h - 2);
        lastLabelX = x;
      }
    }
    ctx.restore();

    // candles across session
    for (const b of bars) {
      const t0 = b.t,
        t1 = t0 + BAR_MS;
      const x0 = toX(t0),
        x1 = toX(t1);
      const bodyW = Math.max(2, Math.floor(x1 - x0 - 1));
      const cx = x0 + (x1 - x0 - bodyW) / 2;

      const openY = toY(b.o),
        closeY = toY(b.c),
        highY = toY(b.h),
        lowY = toY(b.l);
      const up = b.c >= b.o;
      const col = up ? '#22c55e' : '#ef4444';
      ctx.strokeStyle = col;
      ctx.fillStyle = col;

      ctx.beginPath();
      ctx.moveTo(cx + bodyW / 2, highY);
      ctx.lineTo(cx + bodyW / 2, lowY);
      ctx.stroke();

      const top = Math.min(openY, closeY);
      const height = Math.max(1, Math.abs(closeY - openY));
      ctx.fillRect(cx, top, bodyW, height);
    }
  }

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

  /** (optional) status border mapping if you use it in your template */
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
