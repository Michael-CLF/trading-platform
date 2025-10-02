// src/app/core/services/market-data.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { Observable, map } from 'rxjs';

// 👇 Use ONLY the shared model
import { Quote } from '../../shared/models/quote.model';

export interface BarsResponse {
  symbol: string;
  interval: string; // e.g. '15m'
  range: string; // e.g. '5d'
  timezone?: string;
  bars: Array<{
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
  }>;
}

@Injectable({ providedIn: 'root' })
export class MarketDataService {
  private http = inject(HttpClient);
  private baseUrl = environment.apiBaseUrl; // e.g. http://localhost:4000/api/v1

  /** Normalized quote for the UI */
  getQuote(symbol: string): Observable<Quote> {
    return this.http.get<any>(`${this.baseUrl}/market/quote`, { params: { symbol } }).pipe(
      map((raw: any): Quote => {
        // Provider fields that MAY exist:
        // Finnhub: { c (last), d (change), dp (change%), pc (prev), t (ms) }
        // Polygon (prev/last): { c, o, h, l, v, t, n } etc.
        const last = toNum(raw?.price) ?? toNum(raw?.c) ?? toNum(raw?.last) ?? 0;

        const prev = toNum(raw?.previousClose) ?? toNum(raw?.pc) ?? 0;

        const change = isNum(raw?.change) ? Number(raw.change) : last - prev;

        const changePct = isNum(raw?.changePct)
          ? Number(raw.changePct)
          : prev
            ? (change / prev) * 100
            : 0;

        const asOfIso = raw?.asOf
          ? String(raw.asOf)
          : raw?.t
            ? new Date(Number(raw.t)).toISOString()
            : new Date().toISOString();

        return {
          symbol: String(raw?.symbol ?? symbol).toUpperCase(),
          price: last, // <- never null
          change, // optional in model; we still provide
          changePct, // optional in model; we still provide
          previousClose: prev || undefined,
          asOf: asOfIso,
          provider: raw?.provider ?? undefined,
        };
      }),
    );
  }

  /** Bars passthrough shaped for your UI */
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
}

/* ---------------- helpers ---------------- */
function isNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}
function toNum(x: unknown): number | undefined {
  return isNum(x) ? x : undefined;
}
