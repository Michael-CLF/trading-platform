// trader/src/app/core/services/market-data.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, forkJoin, of, throwError, timer } from 'rxjs';
import { catchError, map, retry, shareReplay, timeout } from 'rxjs/operators';
import { environment } from '../../../environments/environment.development';
import { Quote } from '../shared/models/quote.model';
import { Bar1m, Bar15m } from '../shared/models/bar.model';
import { aggregateTo15m } from '../shared/utils/bars.utils';

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
  // below CACHE_DURATION_MS
  private readonly barsCacheMs = 60_000; // cache bars for 60s to avoid re-fetch bursts
  private readonly bars1mCache = new Map<string, Observable<Bar1m[]>>();
  private readonly bars15mCache = new Map<string, Observable<Bar15m[]>>();

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
  // replace your current mapPointsToBar1m with this version
  private mapPointsToBar1m(points: BarsResponse['points']): Bar1m[] {
    if (!points?.length) return [];
    return points
      .map((p) => ({
        ts: p.t,
        o: p.o,
        h: p.h,
        l: p.l,
        c: p.c,
        v: p.v ?? 0,
      }))
      .sort((a, b) => a.ts.localeCompare(b.ts));
  }

  // replace your current getBars1m with this version
  getBars1m(symbol: string, range: string, timezone?: string): Observable<Bar1m[]> {
    const key = `${symbol.toUpperCase()}|1m|${range}|${timezone ?? ''}`;

    const cached = this.bars1mCache.get(key);
    if (cached) return cached;

    const stream$ = this.getBars(symbol, '1m', range, timezone).pipe(
      map((res) => this.mapPointsToBar1m(res.points)),
      shareReplay({ bufferSize: 1, refCount: false }),
    );

    this.bars1mCache.set(key, stream$);
    setTimeout(() => this.bars1mCache.delete(key), this.barsCacheMs);

    return stream$;
  }

  // replace your current getBars15m with this version
  getBars15m(symbol: string, range: string, timezone?: string): Observable<Bar15m[]> {
    const key = `${symbol.toUpperCase()}|15m|${range}|${timezone ?? ''}`;

    const cached = this.bars15mCache.get(key);
    if (cached) return cached;

    // Prefer native 15m from backend → far smaller payload.
    // IMPORTANT: map to Bar15m shape (ts15, not ts).
    const tryDirect15m$: Observable<Bar15m[]> = this.getBars(symbol, '15m', range, timezone).pipe(
      map((res) =>
        res.points.map((p) => ({
          ts15: p.t, // <-- Bar15m expects ts15
          o: p.o,
          h: p.h,
          l: p.l,
          c: p.c,
          v: p.v ?? 0,
        })),
      ),
    );

    // Fallback to 1m→15m aggregation if 15m isn’t available
    const fallbackFrom1m$: Observable<Bar15m[]> = this.getBars1m(symbol, range, timezone).pipe(
      map((bar1m) => aggregateTo15m(bar1m)), // returns Bar15m[]
    );

    const stream$ = tryDirect15m$.pipe(
      catchError(() => fallbackFrom1m$),
      shareReplay({ bufferSize: 1, refCount: false }),
    );

    this.bars15mCache.set(key, stream$);
    setTimeout(() => this.bars15mCache.delete(key), this.barsCacheMs);

    return stream$;
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
