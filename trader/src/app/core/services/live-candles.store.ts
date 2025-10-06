import { Injectable } from '@angular/core';
import { catchError, map, shareReplay, switchMap, timer, of } from 'rxjs';
import { MarketDataService } from './market-data.service';
import { TRADING_SYMBOLS } from '../constants/symbols.constant';

export type Bar = { t: number; o: number; h: number; l: number; c: number };

@Injectable({ providedIn: 'root' })
export class LiveCandlesStore {
  readonly symbols = TRADING_SYMBOLS;
  private readonly UPDATE_MS = 15 * 60 * 1000; // refresh every 15m
  private readonly MAX_BARS = 60; // show last 60 bars on screen

  constructor(private market: MarketDataService) {}

  /** Public stream for one symbol. Caller subscribes/unsubs when they change selection. */
  stream(symbol: string) {
    return timer(0, this.UPDATE_MS).pipe(
      switchMap(() => this.fetchOnce(symbol)),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
  }

  /** One-time fetch of last 5d 15m bars -> normalized -> trimmed */
  private fetchOnce(symbol: string) {
    return this.market.getBars15m(symbol, '5d').pipe(
      catchError(() => of([] as any[])),
      map((raw) => this.normalize(raw).slice(-this.MAX_BARS)),
    );
  }

  // ---------- normalization helpers ----------

  private parseTs(v: any): number {
    if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
    if (typeof v === 'string') {
      const t = Date.parse(v);
      return isNaN(t) ? Date.now() : t;
    }
    if (v instanceof Date) return v.getTime();
    return Date.now();
  }

  private num(v: any): number {
    const n = typeof v === 'string' ? parseFloat(v) : +v;
    return isFinite(n) ? n : NaN;
  }

  private normalize(raw: any[]): Bar[] {
    if (!Array.isArray(raw)) return [];
    const out: Bar[] = [];
    for (const b of raw) {
      const t = this.parseTs(b?.t ?? b?.time ?? b?.timestamp);
      const o = this.num(b?.o ?? b?.open);
      const h = this.num(b?.h ?? b?.high ?? o);
      const l = this.num(b?.l ?? b?.low ?? o);
      const c = this.num(b?.c ?? b?.close ?? o);
      if (isFinite(t) && isFinite(o) && isFinite(c)) {
        out.push({
          t,
          o,
          h: isFinite(h) ? h : Math.max(o, c),
          l: isFinite(l) ? l : Math.min(o, c),
          c,
        });
      }
    }
    return out;
  }
}
