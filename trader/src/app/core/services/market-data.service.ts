import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { QuoteBarResponse, Ticker } from '../shared/models/market.models';
import { Quote } from '../shared/models/quote.model';
import { BarsResponse } from '../shared/models/bar.model';
import { environment } from '../../../environments/environment.development';

@Injectable({ providedIn: 'root' })
export class MarketDataService {
  private http = inject(HttpClient);
  private baseUrl = environment.apiBaseUrl;

  getQuote(symbol: string) {
    return this.http.get<Quote>(`${this.baseUrl}/market/quote`, {
      params: { symbol },
    });
  }

  getBars(symbol: string, interval: string, range: string, timezone: string) {
    return this.http.get<any>(`${this.baseUrl}/market/bars`, {
      params: { symbol, interval, range, timezone },
    });
  }
}
