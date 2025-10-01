// src/app/core/services/market-data.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';

// ✅ correct relative paths from core/services → environments & shared
import { environment } from '../../../environments/environment';
import { Quote } from '../shared/models/quote.model';

import { map } from 'rxjs/operators';
import { Observable } from 'rxjs';

// Backend/Polygon-friendly shape (what /market/bars should return)
export interface BarsResponse {
  symbol: string;
  interval: string; // e.g. "15m"
  range: string; // e.g. "5d"
  timezone?: string;
  provider?: string; // "polygon" | "alpha_vantage" | etc.
  points: Array<{
    t: string; // ISO or epoch mapped to ISO in backend
    o: number;
    h: number;
    l: number;
    c: number;
    v?: number;
  }>;
}

// Optional UI-friendly bar type if you want pretty names in components
export interface UiBar {
  time: string; // ISO string
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

@Injectable({ providedIn: 'root' })
export class MarketDataService {
  private http = inject(HttpClient);
  private baseUrl = environment.apiBaseUrl;

  /** Quote for a single symbol */
  getQuote(symbol: string) {
    return this.http.get<Quote>(`${this.baseUrl}/market/quote`, {
      params: { symbol },
    });
  }

  /**
   * Raw bars (backend/native shape)
   * GET /market/bars?symbol=...&interval=15m&range=5d&timezone=America/New_York
   */
  getBars(
    symbol: string,
    interval: string,
    range: string,
    timezone?: string,
  ): Observable<BarsResponse> {
    let params = new HttpParams()
      .set('symbol', symbol)
      .set('interval', interval)
      .set('range', range);

    if (timezone) params = params.set('timezone', timezone);

    return this.http.get<BarsResponse>(`${this.baseUrl}/market/bars`, { params });
  }

  /**
   * Convenience helper: same call, but mapped to UI-friendly field names
   * Returns { time, open, high, low, close, volume }[]
   */
  getBarsForUi(
    symbol: string,
    interval: string,
    range: string,
    timezone?: string,
  ): Observable<UiBar[]> {
    return this.getBars(symbol, interval, range, timezone).pipe(
      map((res) =>
        (res.points ?? []).map((p) => ({
          time: p.t,
          open: p.o,
          high: p.h,
          low: p.l,
          close: p.c,
          volume: p.v,
        })),
      ),
    );
  }
}
