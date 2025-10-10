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

interface TooltipData {
  x: number;
  y: number;
  price: number;
  date: string;
  time: string;
}

/** Statistics for the current data range */
interface RangeStats {
  high: number;
  low: number;
  change: number;
  changePercent: number;
  volume: number;
}

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

  // loading + request guard
  readonly loading = signal(false);
  private requestSeq = 0; // increases per load to drop stale responses
  private currentLoadPromise: Promise<void> | null = null;
  private abortController: AbortController | null = null;

  // bars & scales
  readonly bars = signal<UiBar[]>([]);
  private sub?: Subscription;

  readonly tooltipData = signal<TooltipData | null>(null);
  readonly showTooltip = signal(false);

  // Hover crosshair position
  readonly crosshairX = signal<number | null>(null);
  readonly crosshairY = signal<number | null>(null);

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

  // SVG path for the line (simple "M … L …")
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

  /** Area fill from line down to the bottom of the plot */
  readonly areaPath = computed<string>(() => {
    const b = this.bars();
    if (b.length < 2) return '';
    const n = b.length;
    const baselineY = this.padTop + this.innerH(); // bottom of plot

    // Start at bottom-left, climb to the line, trace the line, return to bottom-right, close
    let d = `M ${this.xFromIndex(0, n)} ${baselineY}`;
    d += ` L ${this.xFromIndex(0, n)} ${this.yFromPrice(b[0].close)}`;
    for (let i = 1; i < n; i++) {
      d += ` L ${this.xFromIndex(i, n)} ${this.yFromPrice(b[i].close)}`;
    }
    d += ` L ${this.xFromIndex(n - 1, n)} ${baselineY} Z`;
    return d;
  });

  // axis ticks (time labels evenly spaced across the range)
  readonly xTicks = computed<Array<{ x: number; label: string }>>(() => {
    const b = this.bars();
    if (!b.length) return [];
    const n = b.length;

    const asDate = (idx: number) => new Date(b[Math.max(0, Math.min(n - 1, idx))].time);

    const make = (idxs: number[], fmt: Intl.DateTimeFormat) =>
      idxs.map((i) => ({ x: this.xFromIndex(i, n), label: fmt.format(asDate(i)) }));

    // 1Y → one label per month with year, last 12 months
    if (this.selectedRange() === '1Y') {
      const monthYearFmt = new Intl.DateTimeFormat([], { month: 'short', year: 'numeric' });
      const minT = new Date(b[0].time).getTime();
      const maxT = new Date(b[n - 1].time).getTime();

      // Start from the latest data point and go back 12 months
      const end = new Date(maxT);
      end.setDate(1);
      end.setHours(0, 0, 0, 0);

      const monthStarts: number[] = [];
      for (let k = 11; k >= 0; k--) {
        const d = new Date(end);
        d.setMonth(end.getMonth() - k);
        const target = +d;

        let best = 0,
          bestDiff = Infinity;
        for (let i = 0; i < n; i++) {
          const diff = Math.abs(new Date(b[i].time).getTime() - target);
          if (diff < bestDiff) {
            best = i;
            bestDiff = diff;
          }
        }
        monthStarts.push(best);
      }

      const unique = [...new Set(monthStarts)].sort((a, b) => a - b);
      return make(unique, monthYearFmt);
    }

    // 3M / 6M → date labels (not times)
    if (this.selectedRange() === '3M' || this.selectedRange() === '6M') {
      const dateFmt = new Intl.DateTimeFormat([], { month: 'short', day: 'numeric' });
      const ticks = Math.min(12, Math.max(6, Math.floor(this.innerW() / 160)));
      const step = Math.max(1, Math.floor(n / ticks));
      const idxs = Array.from({ length: Math.min(ticks, n) }, (_, i) => Math.min(n - 1, i * step));
      return make(idxs, dateFmt);
    }

    // 1M → date labels
    if (this.selectedRange() === '1M') {
      const dateFmt = new Intl.DateTimeFormat([], { month: 'short', day: 'numeric' });
      const target = Math.min(8, Math.max(5, Math.floor(this.innerW() / 220)));
      const step = Math.max(1, Math.floor(n / target));
      const idxs = Array.from({ length: Math.min(target, n) }, (_, i) => Math.min(n - 1, i * step));
      return make(idxs, dateFmt);
    }

    // 1W → show last 5 trading days with dates (not times)
    if (this.selectedRange() === '1W') {
      const dateFmt = new Intl.DateTimeFormat([], { month: 'short', day: 'numeric' });
      // Show evenly spaced dates across the week
      const target = Math.min(5, n);
      const idxs = Array.from({ length: target }, (_, i) =>
        Math.round((i / Math.max(1, target - 1)) * (n - 1)),
      );
      return make(idxs, dateFmt);
    }

    // 1D → intraday time labels
    if (this.selectedRange() === '1D') {
      const timeFmt = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' });
      const target = Math.min(8, Math.max(4, Math.floor(this.innerW() / 200)));
      const idxs = Array.from({ length: target }, (_, i) =>
        Math.round((i / (target - 1)) * (n - 1)),
      );
      return make(idxs, timeFmt);
    }

    return [];
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

  readonly rangeStats = computed<RangeStats | null>(() => {
    const b = this.bars();
    if (!b.length) return null;

    const closes = b.map((x) => x.close);
    const volumes = b.map((x) => x.volume);

    const high = Math.max(...closes);
    const low = Math.min(...closes);
    const firstPrice = closes[0];
    const lastPrice = closes[closes.length - 1];
    const change = lastPrice - firstPrice;
    const changePercent = firstPrice > 0 ? (change / firstPrice) * 100 : 0;
    const totalVolume = volumes.reduce((sum, v) => sum + v, 0);

    return {
      high,
      low,
      change,
      changePercent,
      volume: totalVolume,
    };
  });

  // -------------- UI actions --------------

  async selectSymbol(sym: string) {
    // Cancel any in-flight request
    this.abortController?.abort();

    // 🆕 ADD THIS LINE:
    this.hideTooltip();

    // Toggle: clicking again clears
    if (this.selected() === sym) {
      this.selected.set(null);
      this.bars.set([]);
      this.loading.set(false);
      this.teardown();
      return;
    }

    this.selected.set(sym);
    await this.loadBars();
  }

  async selectRange(id: RangeId) {
    if (this.selectedRange() === id) return;

    // Cancel any in-flight request
    this.abortController?.abort();

    // 🆕 ADD THIS LINE:
    this.hideTooltip();

    this.selectedRange.set(id);
    await this.loadBars();
  }

  // -------------- data loading --------------

  private async loadBars() {
    this.teardown();
    const sym = this.selected();
    if (!sym) {
      this.bars.set([]);
      this.currentLoadPromise = null;
      return;
    }

    const mySeq = ++this.requestSeq;
    this.loading.set(true);

    // Create and store the load promise
    this.currentLoadPromise = this.performLoad(sym, mySeq);
    await this.currentLoadPromise;
    this.currentLoadPromise = null;
  }

  private async performLoad(sym: string, mySeq: number): Promise<void> {
    const { interval, range } = this.intervalFor(this.selectedRange());

    const fetchUi = async (i: string, r: string) => {
      try {
        const result = await firstValueFrom(
          this.market.getBarsForUi(sym, i, r).pipe(
            timeout(12_000),
            catchError((err) => {
              console.warn(`Failed to fetch bars for ${sym} with ${i}/${r}:`, err);
              return of([] as any[]);
            }),
          ),
        );
        return result;
      } catch (err) {
        console.warn(`Exception fetching bars for ${sym}:`, err);
        return [] as any[];
      }
    };

    // 1) try preferred interval/range
    let points = await fetchUi(interval, range);

    // 2) fallback if API returns nothing (common for intraday not allowed)
    if (!points?.length) {
      const fb = this.fallbackIntervalFor(this.selectedRange());
      if (fb.interval !== interval || fb.range !== range) {
        points = await fetchUi(fb.interval, fb.range);
      }
    }

    // If another click/range happened meanwhile, ignore this response
    if (mySeq !== this.requestSeq) {
      console.log('Stale request detected, ignoring results');
      return;
    }

    // Normalize → oldest→newest, filter junk
    const cleaned = (points || [])
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

    // Only clear bars if we have no data AND this is the most recent request
    if (!cleaned.length) {
      console.warn(`No valid data returned for ${sym} with range ${this.selectedRange()}`);
      // Keep existing bars visible rather than clearing to blank
      this.loading.set(false);
      return;
    }

    // Cap dense intraday to ~300 pts
    const capped =
      this.selectedRange() === '1D' || this.selectedRange() === '1W'
        ? cleaned.slice(-300)
        : cleaned;

    console.log(`Loaded ${capped.length} bars for ${sym} range ${this.selectedRange()}`);
    this.bars.set(capped);
    this.loading.set(false);
  }
  private intervalFor(id: RangeId): { interval: string; range: string } {
    switch (id) {
      case '1D':
        return { interval: '15m', range: '1d' };
      case '1W':
        return { interval: '1h', range: '5d' };
      case '1M':
        return { interval: '1d', range: '1mo' }; // ⚠️ Changed '1m' → '1mo'
      case '3M':
        return { interval: '1d', range: '3mo' }; // ⚠️ Changed '3m' → '3mo'
      case '6M':
        return { interval: '1d', range: '6mo' }; // ⚠️ Changed '6m' → '6mo'
      case '1Y':
        return { interval: '1d', range: '1y' };
    }
  }
  private fallbackIntervalFor(id: RangeId): { interval: string; range: string } {
    switch (id) {
      case '1D':
        return { interval: '1d', range: '5d' };
      case '1W':
        return { interval: '1d', range: '1mo' }; // ⚠️ Changed '1m' → '1mo'
      case '1M':
        return { interval: '1d', range: '3mo' }; // ⚠️ Changed '3m' → '3mo'
      case '3M':
        return { interval: '1d', range: '6mo' }; // ⚠️ Changed '6m' → '6mo'
      case '6M':
        return { interval: '1d', range: '1y' };
      case '1Y':
        return { interval: '1d', range: '1y' }; // ⚠️ Changed from '2y' (not supported)
    }
  }
  // -------------- data loading --------------

  // -------------- Mouse interaction --------------

  /**
   * Handle mouse move over the chart to show tooltip and crosshair
   */
  onChartMouseMove(event: MouseEvent) {
    const svg = event.currentTarget as SVGElement;
    const rect = svg.getBoundingClientRect();

    // Get mouse position relative to SVG viewport coordinates
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    // Check if mouse is within the chart area (accounting for padding)
    const inBounds =
      mouseX >= this.padLeft &&
      mouseX <= this.padLeft + this.innerW() &&
      mouseY >= this.padTop &&
      mouseY <= this.padTop + this.innerH();

    if (!inBounds) {
      this.showTooltip.set(false);
      this.crosshairX.set(null);
      this.crosshairY.set(null);
      return;
    }

    // Find the nearest data point
    const b = this.bars();
    if (!b.length) return;

    const n = b.length;
    const relativeX = mouseX - this.padLeft;
    const fraction = relativeX / this.innerW();
    const index = Math.round(fraction * (n - 1));
    const clampedIndex = Math.max(0, Math.min(n - 1, index));

    const bar = b[clampedIndex];
    const pointX = this.xFromIndex(clampedIndex, n);
    const pointY = this.yFromPrice(bar.close);

    // Format date and time
    const date = new Date(bar.time);
    const dateStr = new Intl.DateTimeFormat([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date);

    const timeStr = new Intl.DateTimeFormat([], {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(date);

    // Calculate tooltip position
    // Use the data point position (pointX, pointY) which are in viewBox coordinates
    // Add offsets to position tooltip near the crosshair point
    const tooltipOffsetX = 15;
    const tooltipOffsetY = -70;
    const tooltipWidth = 120;
    const tooltipHeight = 80;

    let tooltipX = pointX + tooltipOffsetX;
    let tooltipY = pointY + tooltipOffsetY;

    // Adjust if tooltip would go off right edge of chart
    if (tooltipX + tooltipWidth > this.padLeft + this.innerW()) {
      tooltipX = pointX - tooltipWidth - 15; // Show on left of crosshair
    }

    // Adjust if tooltip would go off top edge of chart
    if (tooltipY < this.padTop) {
      tooltipY = pointY + 15; // Show below crosshair instead
    }

    // Adjust if tooltip would go off bottom edge of chart
    if (tooltipY + tooltipHeight > this.padTop + this.innerH()) {
      tooltipY = this.padTop + this.innerH() - tooltipHeight;
    }

    // Adjust if tooltip would go off left edge
    if (tooltipX < this.padLeft) {
      tooltipX = this.padLeft + 5;
    }

    // Update tooltip data with viewBox coordinates
    this.tooltipData.set({
      x: tooltipX,
      y: tooltipY,
      price: bar.close,
      date: dateStr,
      time: timeStr,
    });

    // Update crosshair position
    this.crosshairX.set(pointX);
    this.crosshairY.set(pointY);
    this.showTooltip.set(true);
  }

  onChartMouseLeave() {
    this.showTooltip.set(false);
    this.crosshairX.set(null);
    this.crosshairY.set(null);
    this.tooltipData.set(null);
  }

  /**
   * Hide tooltip (used when changing symbols/ranges)
   */
  private hideTooltip() {
    this.showTooltip.set(false);
    this.crosshairX.set(null);
    this.crosshairY.set(null);
    this.tooltipData.set(null);
  }
  /**
   * Format volume numbers for display (e.g., 1.2M, 456.7K)
   */
  formatVolume(volume: number): string {
    if (volume >= 1_000_000_000) {
      return (volume / 1_000_000_000).toFixed(1) + 'B';
    } else if (volume >= 1_000_000) {
      return (volume / 1_000_000).toFixed(1) + 'M';
    } else if (volume >= 1_000) {
      return (volume / 1_000).toFixed(1) + 'K';
    }
    return volume.toFixed(0);
  }

  // -------------- lifecycle --------------

  ngOnDestroy(): void {
    this.teardown();
    this.currentLoadPromise = null;
  }

  private teardown() {
    this.sub?.unsubscribe();
    this.sub = undefined;
  }
}
