import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../../environments/environment.development';

export interface Quote {
  symbol: string;
  price: number | null;
  currency: 'USD';
  asOf: string; // ISO
  provider: 'polygon';
}

export interface BarsResponse {
  symbol: string;
  interval: string;
  range: string;
  timezone?: string;
  provider: 'polygon';
  points: Array<{ t: string; o: number; h: number; l: number; c: number; v: number }>;
}

export interface UiBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

@Injectable({ providedIn: 'root' })
export class MarketDataService {
  private http = inject(HttpClient);
  private baseUrl = environment.apiBaseUrl; // http://localhost:4000/api/v1

  getQuote(symbol: string) {
    return this.http.get<Quote>(`${this.baseUrl}/market/quote`, { params: { symbol } });
  }

  getBars(symbol: string, interval: string, range: string, timezone?: string) {
    let params = new HttpParams()
      .set('symbol', symbol)
      .set('interval', interval)
      .set('range', range);
    if (timezone) params = params.set('timezone', timezone);
    return this.http.get<BarsResponse>(`${this.baseUrl}/market/bars`, { params });
  }

  /** Convenience for charts/logic */
  getBarsForUi(symbol: string, interval: string, range: string, timezone?: string) {
    return this.getBars(symbol, interval, range, timezone).pipe(
      // map to simple UI bars
      (source) =>
        new Observable<UiBar[]>((subscriber) => {
          const sub = source.subscribe({
            next: (r) => {
              const bars = r.points.map((p) => ({
                time: p.t,
                open: p.o,
                high: p.h,
                low: p.l,
                close: p.c,
                volume: p.v,
              }));
              subscriber.next(bars);
              subscriber.complete();
            },
            error: (err) => subscriber.error(err),
          });
          return () => sub.unsubscribe();
        }),
    );
  }
}
import { Observable } from 'rxjs';
