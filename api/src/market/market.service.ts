import { Injectable, Inject, HttpException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import * as qs from 'querystring';

type BarsInterval = '1m' | '5m' | '15m' | '30m' | '1h' | '1d';
type BarsRange = '1d' | '5d' | '1mo' | '3mo' | '6mo' | '1y';

@Injectable()
export class MarketService {
  private readonly polygonKey: string;
  private readonly polygonBase: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {
    this.polygonKey = this.config.get<string>('POLYGON_API_KEY') ?? '';
    this.polygonBase =
      this.config.get<string>('POLYGON_BASE_URL') ?? 'https://api.polygon.io';
  }

  /* ----------------------------- Public API ----------------------------- */

  async getQuote(symbol: string) {
    const cacheKey = `quote:${symbol}`;
    const ttl = this.config.get<number>('CACHE_TTL_QUOTE') ?? 15;

    const hit = await this.cache.get(cacheKey);
    if (hit) return hit;

    const data = await this.fetchQuotePolygon(symbol);
    await this.cache.set(cacheKey, data, ttl);
    return data;
  }

  async getBars(
    symbol: string,
    interval: BarsInterval,
    range: BarsRange,
    timezone?: string,
  ) {
    const cacheKey = `bars:${symbol}:${interval}:${range}:${timezone ?? 'local'}`;
    const ttl = this.config.get<number>('CACHE_TTL_INTRADAY') ?? 60;

    const hit = await this.cache.get(cacheKey);
    if (hit) return hit;

    const data = await this.fetchBarsPolygon(symbol, interval, range, timezone);
    await this.cache.set(cacheKey, data, ttl);
    return data;
  }

  /* ---------------------------- Polygon fetch --------------------------- */

  private async fetchQuotePolygon(symbol: string) {
    // Use snapshot endpoint for real-time data during market hours
    const snapshotUrl =
      `${this.polygonBase}/v2/snapshot/locale/us/markets/stocks/tickers/${symbol}?` +
      qs.stringify({ apiKey: this.polygonKey });

    try {
      // Try real-time snapshot first
      const snapshot = await this.safeGet<any>(snapshotUrl);

      if (snapshot?.ticker) {
        const ticker = snapshot.ticker;
        // Use current day data if available, otherwise fall back to previous close
        const price = ticker.day?.c || ticker.prevDay?.c || null;
        const timestamp = ticker.updated || Date.now();

        const out = {
          symbol,
          price,
          currency: 'USD',
          asOf: new Date(timestamp / 1000000).toISOString(), // Polygon uses nanoseconds
          provider: 'polygon',
          change: ticker.todaysChange || 0,
          changePercent: ticker.todaysChangePerc || 0,
          dayOpen: ticker.day?.o || null,
          dayHigh: ticker.day?.h || null,
          dayLow: ticker.day?.l || null,
          dayVolume: ticker.day?.v || null,
          prevClose: ticker.prevDay?.c || null,
        };

        console.log(`[quote] ${symbol} -> ${price} (real-time via snapshot)`);
        return out;
      }
    } catch (error) {
      console.warn(
        `Snapshot failed for ${symbol}, falling back to previous day:`,
        error,
      );
    }

    // Fallback to previous day if snapshot fails
    const prevUrl =
      `${this.polygonBase}/v2/aggs/ticker/${symbol}/prev?` +
      qs.stringify({ adjusted: 'true', apiKey: this.polygonKey });

    const r = await this.safeGet<any>(prevUrl);
    const row = r?.results?.[0] ?? null;

    const price = row ? row.c : null;
    const ts = row ? row.t : Date.now();

    const out = {
      symbol,
      price,
      currency: 'USD',
      asOf: new Date(ts).toISOString(),
      provider: 'polygon',
      change: 0,
      changePercent: 0,
      dayOpen: row?.o || null,
      dayHigh: row?.h || null,
      dayLow: row?.l || null,
      dayVolume: row?.v || null,
      prevClose: null,
    };

    console.log(`[quote] ${symbol} -> ${price} (previous day fallback)`);
    return out;
  }

  private async fetchBarsPolygon(
    symbol: string,
    interval: BarsInterval,
    range: BarsRange,
    tz?: string,
  ) {
    const { mult, span } = toPolygonSpan(interval);
    const { fromISO, toISO } = toDateWindow(range);

    const url =
      `${this.polygonBase}/v2/aggs/ticker/${symbol}/range/${mult}/${span}/${fromISO}/${toISO}?` +
      qs.stringify({
        adjusted: 'true',
        sort: 'asc',
        limit: 50000,
        apiKey: this.polygonKey,
      });

    const agg = await this.safeGet<any>(url);
    const results = Array.isArray(agg?.results) ? agg.results : [];

    const points = results.map((r: any) => ({
      t: new Date(r.t).toISOString(),
      o: r.o,
      h: r.h,
      l: r.l,
      c: r.c,
      v: r.v,
    }));

    console.log(
      `[bars] ${symbol} ${interval} ${range} -> ${points.length} points via polygon`,
    );
    return {
      symbol,
      interval,
      range,
      timezone: tz ?? 'America/New_York',
      provider: 'polygon',
      points,
    };
  }

  /* ------------------------------- Helpers ------------------------------ */

  private async safeGet<T = any>(url: string): Promise<T> {
    try {
      const res = await firstValueFrom(this.http.get<T>(url));
      return res.data as T;
    } catch (e: any) {
      const status = e?.response?.status ?? 500;
      const data = e?.response?.data ?? { message: 'Provider error' };
      console.error('[HTTP GET failed]', { url, status, data });
      throw new HttpException(data, status);
    }
  }
}

/* Map UI interval to Polygon multiplier/span */
function toPolygonSpan(i: BarsInterval): {
  mult: number;
  span: 'minute' | 'hour' | 'day';
} {
  if (i === '1d') return { mult: 1, span: 'day' };
  if (i === '1h') return { mult: 1, span: 'hour' };
  if (i.endsWith('m')) return { mult: parseInt(i, 10), span: 'minute' };
  throw new Error(`Unsupported interval: ${i}`);
}

/* Build a date window for Polygon (YYYY-MM-DD ranges) */
function toDateWindow(r: BarsRange): { fromISO: string; toISO: string } {
  const end = new Date();
  const start = new Date(end);

  switch (r) {
    case '1d':
      start.setDate(end.getDate() - 1);
      break;
    case '5d':
      start.setDate(end.getDate() - 5);
      break;
    case '1mo':
      start.setMonth(end.getMonth() - 1);
      break;
    case '3mo':
      start.setMonth(end.getMonth() - 3);
      break;
    case '6mo':
      start.setMonth(end.getMonth() - 6);
      break;
    case '1y':
      start.setFullYear(end.getFullYear() - 1);
      break;
    default:
      throw new Error(`Unsupported range: ${r}`);
  }

  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { fromISO: fmt(start), toISO: fmt(end) };
}
