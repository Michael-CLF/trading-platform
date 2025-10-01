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

  // ---- Public API used by the controller ----
  async getQuote(symbol: string) {
    const key = `quote:${symbol}`;
    const ttl = this.config.get<number>('cache.quoteTtl') ?? 15;
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
    const ttl = this.config.get<number>('cache.intradayTtl') ?? 60;
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

  // ---- Provider adapter (mock for now) ----
  private async fetchProviderQuote(symbol: string) {
    // Later: switch on this.config.get('vendor.provider') and call real API.
    // For now, return a deterministic mock.
    return {
      symbol,
      price: 123.45,
      currency: 'USD',
      asOf: new Date().toISOString(),
      provider: this.config.get('vendor.provider'),
    };
  }

  private async fetchProviderBars(
    symbol: string,
    interval: string,
    range: string,
    timezone?: string,
  ) {
    // Mock bars; replace with real provider soon.
    const now = Date.now();
    const points = Array.from({ length: 20 }).map((_, i) => ({
      t: new Date(now - i * 60_000).toISOString(),
      o: 100 + i * 0.5,
      h: 100 + i * 0.7,
      l: 100 + i * 0.3,
      c: 100 + i * 0.6,
      v: 1000 + i * 10,
    }));
    return {
      symbol,
      interval,
      range,
      timezone: timezone ?? 'local',
      provider: this.config.get('vendor.provider'),
      points: points.reverse(),
    };
  }
}
