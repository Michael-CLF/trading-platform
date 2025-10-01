import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { QuoteBarResponse, Ticker } from '../shared/models/market.models';

@Injectable({ providedIn: 'root' })
export class MarketDataService {
  private http = inject(HttpClient);

  /** GET /market/bars?symbol=SPY&range=1y&interval=1d (relative URL; interceptor prefixes) */
  getDailyBars(symbol: Ticker, range = '1y'): Observable<QuoteBarResponse> {
    const url = `/market/bars?symbol=${encodeURIComponent(symbol)}&range=${range}&interval=1d`;
    return this.http.get<QuoteBarResponse>(url);
  }
}
