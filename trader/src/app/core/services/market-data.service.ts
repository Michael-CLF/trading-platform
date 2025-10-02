// trader/src/app/core/services/market-data.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, forkJoin, of, throwError, timer } from 'rxjs';
import { catchError, map, retry, shareReplay, timeout } from 'rxjs/operators';
import { environment } from '../../../environments/environment.development';
import { Quote } from '../shared/models/quote.model';

/** Shape used by chart components after transformation */
export interface UiBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Raw bars payload coming from the backend */
export interface BarsResponse {
  symbol: string;
  interval: string;
  range: string;
  timezone?: string;
  provider: 'polygon';
  points: Array<{
    t: string;
    o: number;
    h: number;
    l: number;
    c: number;
    v: number;
  }>;
}

/** Error envelope we throw downstream */
export interface MarketDataError {
  symbol?: string;
  message: string;
  statusCode: number;
  timestamp: string;
}

@Injectable({ providedIn: 'root' })
export class MarketDataService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiBaseUrl; // e.g. http://localhost:4000/api/v1

  /** Short-lived cache to prevent duplicate quote calls while a request is in flight */
  private readonly quoteCache = new Map<string, Observable<Quote>>();
  private readonly CACHE_DURATION_MS = 5_000;

  // ------------------------ Quotes ------------------------

  /**
   * Get a single quote (via your backend).
   * - Debounced by a tiny in-memory cache
   * - Normalizes to the provider-agnostic Quote model
   */
  getQuote(symbol: string): Observable<Quote> {
    const normalized = symbol.trim().toUpperCase();
    if (!normalized) {
      return throwError(
        () =>
          <MarketDataError>{
            symbol,
            message: 'Symbol required',
            statusCode: 400,
            timestamp: new Date().toISOString(),
          },
      );
    }

    const cached = this.quoteCache.get(normalized);
    if (cached) return cached;

    const params = new HttpParams().set('symbol', normalized);

    const quote$ = this.http.get<unknown>(`${this.baseUrl}/market/quote`, { params }).pipe(
      timeout(8_000),
      retry({ count: 1, delay: (_e, i) => timer(250 * i) }),
      map((raw) => this.normalizeQuote(normalized, raw)),
      // Cache the latest value for any late subscribers while request is active
      shareReplay({ bufferSize: 1, refCount: true }),
      catchError((err) => this.handleError(err, normalized)),
    );

    this.quoteCache.set(normalized, quote$);
    // Clear the cache entry after a small window
    setTimeout(() => this.quoteCache.delete(normalized), this.CACHE_DURATION_MS);

    return quote$;
  }

  /**
   * Normalize backend (or Polygon-like) responses to our Quote model.
   * Accepts either:
   *  - already-normalized backend shape { price, change, changePct, previousClose, asOf }
   *  - or Polygon-ish fields { c, d, dp, pc, t }
   */
  private normalizeQuote(symbol: string, raw: any): Quote {
    // If backend already normalized, trust it
    if (raw && typeof raw.price === 'number') {
      return {
        symbol,
        price: raw.price,
        change: typeof raw.change === 'number' ? raw.change : undefined,
        changePct: typeof raw.changePct === 'number' ? raw.changePct : undefined,
        previousClose: typeof raw.previousClose === 'number' ? raw.previousClose : undefined,
        asOf:
          typeof raw.asOf === 'string'
            ? raw.asOf
            : new Date(typeof raw.t === 'number' ? raw.t : Date.now()).toISOString(),
        provider: typeof raw.provider === 'string' ? raw.provider : 'polygon',
      };
    }

    // Fallback: try to interpret Polygon fields
    const price = Number(raw?.c ?? NaN);
    if (!Number.isFinite(price)) {
      throw <MarketDataError>{
        symbol,
        message: 'Quote payload missing price',
        statusCode: 502,
        timestamp: new Date().toISOString(),
      };
    }

    return {
      symbol,
      price,
      change: Number.isFinite(Number(raw?.d)) ? Number(raw.d) : undefined,
      changePct: Number.isFinite(Number(raw?.dp)) ? Number(raw.dp) : undefined,
      previousClose: Number.isFinite(Number(raw?.pc)) ? Number(raw.pc) : undefined,
      asOf: new Date(typeof raw?.t === 'number' ? raw.t : Date.now()).toISOString(),
      provider: 'polygon',
    };
  }

  /** Fetch several quotes in parallel; failures are tolerated and filtered out by default */
  getMultipleQuotes(symbols: string[]): Observable<Quote[]> {
    if (!symbols?.length) return of([]);
    const calls = symbols.map((s) =>
      this.getQuote(s).pipe(
        catchError(() => of(null)), // tolerate per-symbol failures
      ),
    );
    return forkJoin(calls).pipe(map((list) => list.filter((q): q is Quote => !!q)));
  }

  /** Clear the in-memory quote cache */
  clearCache(): void {
    this.quoteCache.clear();
  }

  // ------------------------ Bars ------------------------

  /**
   * Get raw bars from backend
   */
  getBars(
    symbol: string,
    interval: string,
    range: string,
    timezone?: string,
  ): Observable<BarsResponse> {
    let params = new HttpParams()
      .set('symbol', symbol.trim().toUpperCase())
      .set('interval', interval)
      .set('range', range);

    if (timezone) params = params.set('timezone', timezone);

    return this.http.get<BarsResponse>(`${this.baseUrl}/market/bars`, { params }).pipe(
      timeout(15_000),
      retry({ count: 2, delay: (_e, i) => timer(1_000 * i) }),
      catchError((err) => this.handleError(err, symbol)),
    );
  }

  /**
   * Bars formatted for charts
   */
  getBarsForUi(
    symbol: string,
    interval: string,
    range: string,
    timezone?: string,
  ): Observable<UiBar[]> {
    return this.getBars(symbol, interval, range, timezone).pipe(
      map((res) =>
        res.points.map((p) => ({
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

  // ------------------------ Errors ------------------------

  private handleError(error: HttpErrorResponse, symbol?: string): Observable<never> {
    const message =
      (error?.error as any)?.message ?? error?.message ?? `HTTP ${error?.status ?? 0}`;

    console.error('Market data error', {
      symbol,
      status: error?.status,
      statusText: error?.statusText,
      message,
      url: error?.url,
      raw: error?.error,
    });

    const out: MarketDataError = {
      symbol,
      message,
      statusCode: error?.status ?? 0,
      timestamp: new Date().toISOString(),
    };

    return throwError(() => out);
  }
}
