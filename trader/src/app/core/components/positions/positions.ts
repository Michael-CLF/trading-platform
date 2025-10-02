import { Component, inject, signal } from '@angular/core';
import { CommonModule, CurrencyPipe, DecimalPipe, PercentPipe } from '@angular/common';
import { forkJoin } from 'rxjs';
import { MarketDataService } from '../../services/market-data.service';
import { Quote } from '../../shared/models/quote.model';

export interface Position {
  symbol: string;
  qty: number;
  avgPrice: number;
  lastPrice: number;
  costBasis: number;
  marketValue: number;
  pnl: number;
  pnlPct: number;
}

@Component({
  selector: 'app-positions',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DecimalPipe, PercentPipe],
  templateUrl: './positions.html',
  styleUrls: ['./positions.scss'],
})
export class PositionsComponent {
  private market = inject(MarketDataService);

  loading = signal(true);
  rows = signal<Position[]>([]);

  // Replace with your real lots later
  private readonly lots = [
    { symbol: 'AAPL', qty: 10, avgPrice: 250 },
    { symbol: 'MSFT', qty: 8, avgPrice: 420 },
    { symbol: 'NVDA', qty: 5, avgPrice: 1000 },
  ];

  ngOnInit() {
    const calls = this.lots.map((l) => this.market.getQuote(l.symbol));
    forkJoin(calls).subscribe({
      next: (qs: Quote[]) => {
        const rows = this.lots.map((lot, i) => {
          const q = qs[i];
          const last = q.price ?? lot.avgPrice;
          const costBasis = lot.qty * lot.avgPrice;
          const marketValue = lot.qty * last;
          const pnl = marketValue - costBasis;
          const pnlPct = costBasis ? pnl / costBasis : 0;
          return {
            symbol: lot.symbol,
            qty: lot.qty,
            avgPrice: lot.avgPrice,
            lastPrice: last,
            costBasis,
            marketValue,
            pnl,
            pnlPct,
          };
        });
        this.rows.set(rows);
        this.loading.set(false);
      },
      error: () => {
        this.rows.set([]);
        this.loading.set(false);
      },
    });
  }

  totalCostBasis() {
    return this.rows().reduce((s, r) => s + r.costBasis, 0);
  }
  totalMarketValue() {
    return this.rows().reduce((s, r) => s + r.marketValue, 0);
  }
  totalPnL() {
    return this.rows().reduce((s, r) => s + r.pnl, 0);
  }
}
