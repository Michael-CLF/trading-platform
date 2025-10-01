import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { BacktestSummary } from '../shared/models/backtest.models';

@Injectable({ providedIn: 'root' })
export class BacktestsService {
  private http = inject(HttpClient);

  /** GET /backtests */
  list(): Observable<BacktestSummary[]> {
    return this.http.get<BacktestSummary[]>('/backtests');
  }

  /** POST /backtests/run */
  run(config: unknown) {
    return this.http.post<{ id: string }>('/backtests/run', config);
  }
}
