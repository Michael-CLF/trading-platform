import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class MarketService {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  // ==== Public API (unchanged) =================================================

  async getQuote(symbol: string) {
    const key = `quote:${symbol}`;
    const ttl = this.config.get<number>('cache.quoteTtl') ?? 15; // seconds
    const cached = await this.cache.get(key);
    if (cached) return cached;

    const data = await this.fetchProviderQuote(symbol);
    await this.cache.set(key, data, ttl);
    return data;
  }

  async getBars(
    symbol: string,
    interval: string,
    range: string,
    timezone?: string,
  ) {
    const key = `bars:${symbol}:${interval}:${range}:${timezone ?? 'local'}`;
    const ttl = this.config.get<number>('cache.intradayTtl') ?? 60; // seconds
    const cached = await this.cache.get(key);
    if (cached) return cached;

    const data = await this.fetchProviderBars(
      symbol,
      interval,
      range,
      timezone,
    );
    await this.cache.set(key, data, ttl);
    return data;
  }

  // ==== Provider adapter: Polygon.io ===========================================

  private get polygonKey(): string {
    const k = this.config.get<string>('POLYGON_API_KEY');
    if (!k) throw new Error('POLYGON_API_KEY not set');
    return k;
  }
  // in market.service.ts
  private async safeGet<T = any>(url: string) {
    try {
      const res = await firstValueFrom(this.http.get<T>(url));
      return res.data as any;
    } catch (e: any) {
      console.error('[Polygon GET failed]', {
        url,
        status: e?.response?.status,
        data: e?.response?.data,
      });
      throw e;
    }
  }

  private get polygonBase(): string {
    return (
      this.config.get<string>('MARKET_BASE_URL') || 'https://api.polygon.io'
    );
  }

  /** Quote = latest 15m bar close (or previous close if market is closed) */
  private async fetchProviderQuote(symbol: string) {
    const base = this.polygonBase;
    const key = this.polygonKey;

    // 1) Previous close
    const prevUrl = `${base}/v2/aggs/ticker/${encodeURIComponent(
      symbol,
    )}/prev?adjusted=true&apiKey=${key}`;
    const prevRes = await firstValueFrom(this.http.get(prevUrl));
    const prev = prevRes.data?.results?.[0];
    const previousClose: number | undefined = prev?.c;

    // 2) Latest 15m bar today (proxy for "current price")
    const today = new Date();
    const dateStr = isoDateOnly(today); // YYYY-MM-DD
    const lastBarUrl =
      `${base}/v2/aggs/ticker/${encodeURIComponent(symbol)}` +
      `/range/15/minute/${dateStr}/${dateStr}?adjusted=true&sort=desc&limit=1&apiKey=${key}`;

    const barRes = await firstValueFrom(this.http.get(lastBarUrl));
    const lastBar = barRes.data?.results?.[0];

    const price: number | undefined = lastBar?.c ?? previousClose ?? undefined;
    const asOfTs: number | undefined = lastBar?.t ?? prev?.t;
    const asOf = asOfTs
      ? new Date(asOfTs).toISOString()
      : new Date().toISOString();

    let change: number | undefined;
    let changePct: number | undefined;
    if (price != null && previousClose != null && previousClose !== 0) {
      change = price - previousClose;
      changePct = (change / previousClose) * 100;
    }

    return {
      symbol,
      price: price ?? 0,
      previousClose,
      change,
      changePct,
      asOf,
      provider: this.config.get('vendor.provider') ?? 'polygon',
      currency: 'USD',
    };
  }

  /** Bars for the given interval & range, mapped to { t,o,h,l,c,v } points */
  private async fetchProviderBars(
    symbol: string,
    interval: string, // "15m" | "5m" | "1h" | "1d" ...
    range: string, // "5d" | "1mo" | "3mo" | "6mo" | "1y" | "ytd" | "max"
    timezone?: string,
  ) {
    const base = this.polygonBase;
    const key = this.polygonKey;

    // Parse interval into Polygon (multiplier + timespan)
    const { multiplier, timespan } = parseInterval(interval);

    // Compute date window from "range"
    const { from, to } = computeFromTo(range);

    const url =
      `${base}/v2/aggs/ticker/${encodeURIComponent(symbol)}` +
      `/range/${multiplier}/${timespan}/${from}/${to}` +
      `?adjusted=true&sort=asc&limit=50000&apiKey=${key}`;

    const resp = await firstValueFrom(this.http.get(url));
    const results: Array<any> = resp.data?.results ?? [];

    const points = results.map((r) => ({
      t: new Date(r.t).toISOString(), // Polygon returns epoch ms
      o: r.o,
      h: r.h,
      l: r.l,
      c: r.c,
      v: r.v,
    }));

    return {
      symbol,
      interval,
      range,
      timezone: timezone ?? 'America/New_York',
      provider: this.config.get('vendor.provider') ?? 'polygon',
      points,
    };
  }
}

/* ------------------------------ Helpers ----------------------------------- */

function isoDateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Convert UI interval strings into Polygon's (multiplier, timespan)
 * Examples:
 *  "15m" -> { 15, "minute" }
 *  "5m"  -> { 5,  "minute" }
 *  "1h"  -> { 1,  "hour" }
 *  "1d"  -> { 1,  "day" }
 */
function parseInterval(interval: string): {
  multiplier: number;
  timespan: 'minute' | 'hour' | 'day';
} {
  const m = interval.match(/^(\d+)([mhd])$/i);
  if (!m) return { multiplier: 15, timespan: 'minute' }; // default
  const mult = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (unit === 'm') return { multiplier: mult, timespan: 'minute' };
  if (unit === 'h') return { multiplier: mult, timespan: 'hour' };
  return { multiplier: mult, timespan: 'day' };
}

/**
 * Compute from/to dates for Polygon from simple ranges.
 * Supports: "5d", "1mo", "3mo", "6mo", "1y", "ytd", "max"
 * Default: last 5 days.
 */
function computeFromTo(range: string): { from: string; to: string } {
  const toDate = new Date();
  const to = isoDateOnly(toDate);

  const fromDate = new Date(toDate);
  const lower = (range || '').toLowerCase();

  switch (lower) {
    case '5d':
      fromDate.setDate(fromDate.getDate() - 7); // 5d + buffer
      break;
    case '1mo':
      fromDate.setMonth(fromDate.getMonth() - 1);
      break;
    case '3mo':
      fromDate.setMonth(fromDate.getMonth() - 3);
      break;
    case '6mo':
      fromDate.setMonth(fromDate.getMonth() - 6);
      break;
    case '1y':
      fromDate.setFullYear(fromDate.getFullYear() - 1);
      break;
    case 'ytd':
      fromDate.setMonth(0, 1);
      fromDate.setHours(0, 0, 0, 0);
      break;
    case 'max':
      fromDate.setFullYear(fromDate.getFullYear() - 20); // a big window
      break;
    default:
      fromDate.setDate(fromDate.getDate() - 7); // sensible default
      break;
  }

  const from = isoDateOnly(fromDate);
  return { from, to };
}
