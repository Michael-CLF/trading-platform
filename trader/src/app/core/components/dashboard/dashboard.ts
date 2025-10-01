import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Signal } from '../../shared/models/signal.models';
import { CommonModule, DatePipe, DecimalPipe } from '@angular/common';
import { Quote } from '../../shared/models/quote.model';
import { MarketDataService } from '../../services/market-data.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, DatePipe, DecimalPipe],
  templateUrl: './dashboard.html',
  styleUrls: ['./dashboard.scss'],
})
export class Dashboard implements OnInit {
  private http = inject(HttpClient);
  private market = inject(MarketDataService);

  loading = signal<boolean>(true);
  rows = signal<Signal[]>([]);
  quote = signal<Quote | null>(null);
  error = signal<string | null>(null);

  readonly defaultSymbol = 'AAPL';

  ngOnInit(): void {
    this.fetchQuote(this.defaultSymbol);
  }

  fetchQuote(symbol: string) {
    this.loading.set(true);
    this.error.set(null);

    this.market.getQuote(symbol).subscribe({
      next: (q: Quote) => {
        this.quote.set(q);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err?.error?.message ?? 'Failed to load quote');
        this.loading.set(false);
      },
    });
  }
}
