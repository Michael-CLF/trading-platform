import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';
import { MarketDataService } from '../../services/market-data.service';
import { Quote } from '../../shared/models/quote.model';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, DatePipe, DecimalPipe], // needed for *ngIf/*ngFor and pipes
  templateUrl: './dashboard.html',
  styleUrls: ['./dashboard.scss'],
})
export class Dashboard implements OnInit {
  private readonly market = inject(MarketDataService);

  readonly symbols = ['AAPL', 'AMZN', 'GOOGL', 'MSFT', 'NVDA'];
  readonly quotes = signal<Quote[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly count = computed(() => this.quotes().length);

  ngOnInit(): void {
    this.loadWatchlist();
  }

  loadWatchlist(): void {
    this.loading.set(true);
    this.error.set(null);

    const calls: Observable<Quote | null>[] = this.symbols.map((s) =>
      this.market.getQuote(s).pipe(catchError(() => of(null))),
    );

    forkJoin(calls).subscribe({
      next: (list) => {
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
}
