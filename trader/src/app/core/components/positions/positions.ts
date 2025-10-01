import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CommonModule, DecimalPipe, PercentPipe, CurrencyPipe } from '@angular/common';

export interface Position {
  symbol: string;
  qty: number;
  avgPrice: number;
  lastPrice: number;
  costBasis: number;
  marketValue: number;
  pnl: number; // absolute P/L
  pnlPct: number; // 0..1 (e.g., 0.052 = 5.2%)
}

@Component({
  selector: 'app-positions',
  standalone: true,
  imports: [CommonModule, DecimalPipe, PercentPipe, CurrencyPipe],
  templateUrl: './positions.html',
  styleUrls: ['./positions.scss'],
})
export class PositionsComponent {
  private http = inject(HttpClient);

  loading = signal(true);
  rows = signal<Position[]>([]);

  ngOnInit() {
    this.http.get<Position[]>('/assets/mock/positions.json').subscribe({
      next: (res) => {
        this.rows.set(res);
        this.loading.set(false);
      },
      error: () => {
        this.rows.set([]);
        this.loading.set(false); // <-- end loading on error
      },
    });
  }

  totalCostBasis() {
    return this.rows().reduce((sum, p) => sum + p.costBasis, 0);
  }
  totalMarketValue() {
    return this.rows().reduce((sum, p) => sum + p.marketValue, 0);
  }
  totalPnL() {
    return this.rows().reduce((sum, p) => sum + p.pnl, 0);
  }
}
