// src/app/core/components/dashboard/dashboard.ts
import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MarketDataService } from '../../services/market-data.service';
import { Quote } from '../../shared/models/quote.model';

import { Observable, forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, DatePipe, DecimalPipe],
  templateUrl: './dashboard.html',
  styleUrls: ['./dashboard.scss'],
})
export class Dashboard implements OnInit {
  // DI
  private http = inject(HttpClient);
  private market = inject(MarketDataService);

  // Watchlist symbols (keep your list here)
  readonly symbols: string[] = [
    'AAPL',
    'MSFT',
    'GOOGL',
    'AMZN',
    'NVDA',
    // add/remove as needed; beware of providers that don't like dots (e.g., BRK.B)
  ];

  // UI state (Angular signals)
  readonly quotes = signal<Quote[]>([]);
  readonly loading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  // Example computed (optional): total items
  readonly count = computed(() => this.quotes().length);

  ngOnInit(): void {
    // Optional: fetch a single symbol quickly
    this.loadSingle('AAPL');
    // Main list
    this.loadWatchlist();
  }

  // -------- Public methods used by template --------

  loadWatchlist(): void {
    this.loading.set(true);
    this.error.set(null);

    const calls: Observable<Quote | null>[] = this.symbols.map((s: string) =>
      this.market.getQuote(s).pipe(
        catchError((err) => {
          console.warn('Quote failed for', s, err);
          return of(null); // tolerate per-symbol failures
        }),
      ),
    );

    forkJoin(calls).subscribe({
      next: (list: Array<Quote | null>) => {
        const ok: Quote[] = list.filter((q: Quote | null): q is Quote => !!q);
        // stable order with explicit types to avoid "implicit any"
        ok.sort((a: Quote, b: Quote) => a.symbol.localeCompare(b.symbol));
        this.quotes.set(ok);
        this.loading.set(false);
      },
      error: (err) => {
        // This should rarely hit now, but keep it just in case
        const msg = (err && (err.error?.message ?? err.message)) || 'Failed to load watchlist';
        this.error.set(String(msg));
        this.loading.set(false);
      },
    });
  }

  // -------- Helpers --------

  private loadSingle(symbol: string): void {
    this.market.getQuote(symbol).subscribe({
      next: (q: Quote) => {
        // Only add if not already there
        const existing = this.quotes().some((x) => x.symbol === q.symbol);
        if (!existing) {
          const next = [...this.quotes(), q];
          next.sort((a: Quote, b: Quote) => a.symbol.localeCompare(b.symbol));
          this.quotes.set(next);
        }
      },
      error: (err) => {
        console.warn('Single quote failed for', symbol, err);
      },
    });
  }
}
