// src/app/core/components/dashboard/dashboard.ts
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';
import { MarketDataService } from '../../services/market-data.service';
import { Quote } from '../../shared/models/quote.model';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

type QuoteRow = Quote & { delta: number; pct: number };

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, DatePipe, DecimalPipe],
  templateUrl: './dashboard.html',
  styleUrls: ['./dashboard.scss'],
  providers: [DecimalPipe],
})
export class Dashboard implements OnInit {
  // DI
  private readonly market = inject(MarketDataService);
  private readonly dec = inject(DecimalPipe);

  // Watchlist (edit as you like)
  readonly symbols: string[] = [
    'AAPL',
    'AMD',
    'AMZN',
    'AVGO',
    'COIN',
    'CRWD',
    'GOOGL',
    'IWM',
    'MARA',
    'META',
    'MSFT',
    'NET',
    'NVDA',
    'PANW',
    'PLTR',
    'QQQ',
    'RIOT',
    'SHOP',
    'SPY',
    'TSLA',
    'TTD',
    'UBER',
    'XLE',
    'XLF',
    'XLK',
    'XLC',
    'XLY',
  ];

  // UI state
  readonly quotes = signal<Quote[]>([]);
  readonly loading = signal<boolean>(true);
  readonly error = signal<string | null>(null);

  // ----- computed helpers -----
  /** enrich each quote with $ delta and % change (safe fallbacks) */
  readonly rows = computed<QuoteRow[]>(() =>
    this.quotes().map((q) => {
      const delta = this.delta(q);
      const pct = this.pct(q, delta);
      return { ...q, delta, pct };
    }),
  );

  /** top N gainers/losers by pct change */
  readonly gainers = computed<QuoteRow[]>(() =>
    [...this.rows()].sort((a, b) => b.pct - a.pct).slice(0, 6),
  );
  readonly losers = computed<QuoteRow[]>(() =>
    [...this.rows()].sort((a, b) => a.pct - b.pct).slice(0, 6),
  );

  // ---------- lifecycle ----------
  ngOnInit(): void {
    this.loadWatchlist();
  }

  // ---------- data loading ----------
  loadWatchlist(): void {
    this.loading.set(true);
    this.error.set(null);

    const calls: Observable<Quote | null>[] = this.symbols.map((s) =>
      this.market.getQuote(s).pipe(
        catchError((err) => {
          console.warn('Quote failed for', s, err);
          return of(null);
        }),
      ),
    );

    forkJoin(calls).subscribe({
      next: (list: Array<Quote | null>) => {
        const ok: Quote[] = list.filter((q): q is Quote => !!q);
        ok.sort((a, b) => a.symbol.localeCompare(b.symbol));
        this.quotes.set(ok);
        this.loading.set(false);
      },
      error: (err) => {
        const msg = (err && (err.error?.message ?? err.message)) || 'Failed to load watchlist';
        this.error.set(String(msg));
        this.loading.set(false);
      },
    });
  }

  // ---------- formatting helpers for template ----------
  signedPct(q: QuoteRow): string {
    const v = q.pct;
    return `${v >= 0 ? '+' : ''}${this.dec.transform(v, '1.1-2')}%`;
  }

  signedDelta(q: QuoteRow): string {
    const v = q.delta;
    return `${v >= 0 ? '+' : ''}${this.dec.transform(v, '1.2-2')}`;
  }

  deltaClass(q: QuoteRow): string {
    return q.delta >= 0 ? 'var(--color-positive)' : 'var(--color-negative)';
  }

  badgeClass(q: QuoteRow): string {
    return q.pct >= 0 ? 'var(--color-positive)' : 'var(--color-negative)';
  }
  badgeBgClass(q: QuoteRow): string {
    return q.pct >= 0 ? 'var(--color-positive-bg)' : 'var(--color-negative-bg)';
  }

  // ---------- math helpers ----------
  /** $ change (prefer API 'change', else price - previousClose, else 0) */
  private delta(q: Quote): number {
    if (q.change != null) return q.change;
    if (q.previousClose != null) return (q.price ?? 0) - q.previousClose;
    return 0;
  }

  /** % change (prefer API 'changePct', else derive from prev close; delta is provided for reuse) */
  private pct(q: Quote, delta: number): number {
    if (q.changePct != null) return q.changePct;
    const prev = q.previousClose ?? (q.price ?? 0) - (q.change ?? 0);
    if (!prev) return 0;
    return (delta / prev) * 100;
  }
}
