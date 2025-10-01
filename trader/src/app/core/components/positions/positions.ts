// src/app/core/components/positions/positions.ts
import { Component, inject, signal } from '@angular/core';
import { CommonModule, DecimalPipe, PercentPipe, CurrencyPipe } from '@angular/common';
import { MarketDataService, UiBar } from '../../services/market-data.service';
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
  imports: [CommonModule, DecimalPipe, PercentPipe, CurrencyPipe],
  templateUrl: './positions.html',
  styleUrls: ['./positions.scss'],
})
export class PositionsComponent {
  private market = inject(MarketDataService);

  loading = signal<boolean>(true);
  rows = signal<Position[]>([]);
  bars = signal<UiBar[]>([]);
  quote = signal<Quote | null>(null);

  ngOnInit(): void {
    // Replace mock call with real data calls
    this.market.getBarsForUi('AAPL', '15m', '5d', 'America/New_York').subscribe(() => {
      // Example synthetic “positions” until you have a real endpoint:
      // derive a row from the latest bar + quote so the table is not empty
      this.market.getQuote('AAPL').subscribe((q) => {
        if (q) {
          const last = q.price ?? 0;
          const qty = 10;
          const avgPrice = last * 0.98;
          const costBasis = qty * avgPrice;
          const marketValue = qty * last;
          const pnl = marketValue - costBasis;
          const pnlPct = costBasis ? pnl / costBasis : 0;

          this.rows.set([
            {
              symbol: 'AAPL',
              qty,
              avgPrice,
              lastPrice: last,
              costBasis,
              marketValue,
              pnl,
              pnlPct,
            },
          ]);

          this.quote.set(q);
          this.loading.set(false);
        }
      });
    });
  }

  totalCostBasis(): number {
    return this.rows().reduce((sum, p) => sum + (p?.costBasis ?? 0), 0);
  }
  totalMarketValue(): number {
    return this.rows().reduce((sum, p) => sum + (p?.marketValue ?? 0), 0);
  }
  totalPnL(): number {
    return this.rows().reduce((sum, p) => sum + (p?.pnl ?? 0), 0);
  }
}
