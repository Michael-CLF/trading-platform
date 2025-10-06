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

@Component({
  selector: 'app-signals',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './signals.html',
  styleUrls: ['./signals.scss'],
})
export class SignalsComponent implements OnInit, AfterViewInit, OnDestroy {
  private store = inject(LiveCandlesStore);

  /** list of symbols to show as toggles */
  readonly symbols = TRADING_SYMBOLS;

  /** single selection */
  selected = signal<string | null>(null);

  /** canvas ref */
  @ViewChild('candleCanvas', { static: false }) canvasRef!: ElementRef<HTMLCanvasElement>;

  /** latest bars for selected symbol */
  private sub?: Subscription;
  private bars: Bar[] = [];

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
        this.drawFullSession(this.canvasRef?.nativeElement, this.bars);
      },
      error: (err) => {
        console.error('Stream error:', err);
      },
    });
  }
  /** Draw today’s session if available; else last ~26 bars.
   *  Robust: index-based x positions + outlier-trimmed y-scale.
   */
  private drawFullSession(canvas: HTMLCanvasElement | undefined, allBars: Bar[]): void {
    if (!canvas) return;

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

    // Fallback: last ~1 day of 15m bars if we didn’t capture the session (after-hours, holidays, API quirk)
    if (bars.length < 10) {
      const PER_DAY_15M = 26;
      bars = allBars.slice(-PER_DAY_15M);
    }
    if (bars.length === 0) return;

    // ----- robust Y range: winsorize 2%..98% so outliers don’t compress the chart
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

    // ----- layout helpers
    const leftPad = 8,
      rightPad = 8,
      bottomPad = 22,
      topPad = 8;
    const usableW = w - leftPad - rightPad;
    const step = usableW / bars.length;
    const bodyW = Math.max(2, Math.floor(step * 0.6));

    const toY = (p: number) => {
      const a = (p - ymin) / (ymax - ymin);
      return h - bottomPad - a * (h - topPad - bottomPad);
    };

    // ----- baseline from first bar’s open (purely cosmetic)
    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.strokeStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.moveTo(0, toY(bars[0].o));
    ctx.lineTo(w, toY(bars[0].o));
    ctx.stroke();
    ctx.restore();

    // ----- vertical grid + time labels every ~30m (i.e., every 2 bars if 15m)
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
        const lab = new Date(bars[i].t).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
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

  /**
   * Draw time grid lines and labels for the trading session
   * This is extracted into a separate method following single responsibility principle
   */
  private drawTimeGrid(
    ctx: CanvasRenderingContext2D,
    startMs: number,
    endMs: number,
    w: number,
    h: number,
    toX: (t: number) => number,
    leftPad: number,
    rightPad: number,
    topPad: number,
    bottomPad: number,
  ): void {
    ctx.save();
    ctx.globalAlpha = 0.26;
    ctx.strokeStyle = 'rgba(148,163,184,.28)';
    ctx.fillStyle = 'rgba(148,163,184,.78)';
    ctx.font = '11px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    const HALF_HOUR = 30 * 60 * 1000;
    const minLabelSpacing = 80;
    let lastLabelX = -1e9;

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
  }
}
