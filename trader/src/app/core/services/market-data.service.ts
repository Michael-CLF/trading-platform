import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError, timer } from 'rxjs';
import { catchError, retry, map, shareReplay, timeout } from 'rxjs/operators';
import { environment } from '../../../environments/environment.development';

/**
 * Quote response from the market API
 */
export interface Quote {
  symbol: string;
  price: number | null;
  currency: 'USD';
  asOf: string; // ISO timestamp
  provider: 'polygon';
}

/**
 * Bars response from the market API
 */
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

/**
 * Simplified bar format for UI components
 */
export interface UiBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Error details for market data failures
 */
export interface MarketDataError {
  symbol?: string;
  message: string;
  statusCode: number;
  timestamp: string;
}

/**
 * Market Data Service
 * Handles all stock market data operations with proper error handling,
 * caching, and retry logic for resilience
 */
@Injectable({ providedIn: 'root' })
export class MarketDataService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiBaseUrl; // http://localhost:4000/api/v1

  // Cache for active quotes to prevent duplicate requests
  private quoteCache = new Map<string, Observable<Quote>>();
  private readonly CACHE_DURATION_MS = 5000; // 5 seconds cache for quotes

  /**
   * Get real-time quote for a stock symbol
   * Includes caching to prevent excessive API calls
   */
  getQuote(symbol: string): Observable<Quote> {
    // Normalize symbol to uppercase
    const normalizedSymbol = symbol.toUpperCase();

    // Check cache first
    const cached = this.quoteCache.get(normalizedSymbol);
    if (cached) {
      return cached;
    }

    // Create new request with caching
    const quote$ = this.http
      .get<Quote>(`${this.baseUrl}/market/quote`, {
        params: { symbol: normalizedSymbol },
      })
      .pipe(
        timeout(10000), // 10 second timeout
        retry({
          count: 2,
          delay: (error, retryCount) => {
            console.log(`Retry attempt ${retryCount} for quote ${normalizedSymbol}`);
            return timer(1000 * retryCount); // Progressive delay
          },
        }),
        catchError((error) => this.handleError(error, normalizedSymbol)),
        shareReplay({ bufferSize: 1, refCount: true }),
      );

    // Store in cache
    this.quoteCache.set(normalizedSymbol, quote$);

    // Clear cache after duration
    setTimeout(() => {
      this.quoteCache.delete(normalizedSymbol);
    }, this.CACHE_DURATION_MS);

    return quote$;
  }

  /**
   * Get historical price bars for a stock symbol
   * @param symbol Stock ticker symbol
   * @param interval Time interval (1m, 5m, 15m, 30m, 1h, 1d)
   * @param range Date range (1d, 5d, 1mo, 3mo, 6mo, 1y)
   * @param timezone Optional timezone (defaults to America/New_York)
   */
  getBars(
    symbol: string,
    interval: string,
    range: string,
    timezone?: string,
  ): Observable<BarsResponse> {
    // Build query parameters
    let params = new HttpParams()
      .set('symbol', symbol.toUpperCase())
      .set('interval', interval)
      .set('range', range);

    if (timezone) {
      params = params.set('timezone', timezone);
    }

    return this.http.get<BarsResponse>(`${this.baseUrl}/market/bars`, { params }).pipe(
      timeout(15000), // 15 second timeout for bars (larger data)
      retry({
        count: 2,
        delay: (error, retryCount) => {
          console.log(`Retry attempt ${retryCount} for bars ${symbol}`);
          return timer(1500 * retryCount);
        },
      }),
      catchError((error) => this.handleError(error, symbol)),
    );
  }

  /**
   * Get bars formatted for UI components (charts)
   * Transforms the API response to a simpler format
   */
  getBarsForUi(
    symbol: string,
    interval: string,
    range: string,
    timezone?: string,
  ): Observable<UiBar[]> {
    return this.getBars(symbol, interval, range, timezone).pipe(
      map((response) =>
        response.points.map((point) => ({
          time: point.t,
          open: point.o,
          high: point.h,
          low: point.l,
          close: point.c,
          volume: point.v,
        })),
      ),
      catchError((error) => {
        console.error('Failed to fetch UI bars:', error);
        return throwError(() => error);
      }),
    );
  }

  /**
   * Get multiple quotes in parallel
   * Useful for dashboard views showing multiple stocks
   */
  getMultipleQuotes(symbols: string[]): Observable<Quote[]> {
    const requests = symbols.map((symbol) =>
      this.getQuote(symbol).pipe(
        catchError((error) => {
          console.error(`Failed to fetch quote for ${symbol}:`, error);
          // Return a null quote on error to not break the entire batch
          return [
            {
              symbol,
              price: null,
              currency: 'USD' as const,
              asOf: new Date().toISOString(),
              provider: 'polygon' as const,
            },
          ];
        }),
      ),
    );

    return new Observable((subscriber) => {
      const quotes: Quote[] = [];
      let completed = 0;

      requests.forEach((request, index) => {
        request.subscribe({
          next: (quote) => {
            quotes[index] = quote;
            completed++;
            if (completed === requests.length) {
              subscriber.next(quotes);
              subscriber.complete();
            }
          },
          error: (error) => {
            // Individual errors are already handled
            completed++;
            if (completed === requests.length) {
              subscriber.next(quotes);
              subscriber.complete();
            }
          },
        });
      });
    });
  }

  /**
   * Clear the quote cache
   * Useful when you need fresh data immediately
   */
  clearCache(): void {
    this.quoteCache.clear();
  }

  /**
   * Centralized error handling
   */
  private handleError(error: HttpErrorResponse, symbol?: string): Observable<never> {
    let errorMessage = 'An unknown error occurred';

    if (error.error instanceof ErrorEvent) {
      // Client-side error
      errorMessage = `Client error: ${error.error.message}`;
    } else {
      // Server-side error
      errorMessage = error.error?.message || error.message || `Server error: ${error.status}`;

      // Log the full error for debugging
      console.error('Market data error:', {
        symbol,
        status: error.status,
        statusText: error.statusText,
        message: errorMessage,
        url: error.url,
        error: error.error,
      });
    }

    const marketError: MarketDataError = {
      symbol,
      message: errorMessage,
      statusCode: error.status || 0,
      timestamp: new Date().toISOString(),
    };

    return throwError(() => marketError);
  }
}
