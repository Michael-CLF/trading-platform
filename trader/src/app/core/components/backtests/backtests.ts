import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { BacktestSummary } from '../../shared/models/backtest.models';

@Component({
  selector: 'app-backtests',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './backtests.html',
  styleUrls: ['./backtests.scss'],
})
export class BacktestsComponent {
  private http = inject(HttpClient);
  loading = signal(true);
  items = signal<BacktestSummary[]>([]);

  ngOnInit() {
    this.http.get<BacktestSummary[]>('/assets/mock/backtests.json').subscribe({
      next: (res) => this.items.set(res),
      error: () => this.items.set([]),
      complete: () => this.loading.set(false),
    });
  }
}
