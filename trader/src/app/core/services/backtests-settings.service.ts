import { Injectable } from '@angular/core';

export interface BacktestsSettings {
  entryBps: number;
  exitBps: number;
  longTh: number;
  symbols: string[];
  _v?: number; // schema version
}

@Injectable({ providedIn: 'root' })
export class BacktestsSettingsService {
  private readonly KEY = 'backtests:settings:v1';

  load(): BacktestsSettings | null {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);

      const out: BacktestsSettings = {
        entryBps: Number.isFinite(parsed?.entryBps) ? parsed.entryBps : 5,
        exitBps: Number.isFinite(parsed?.exitBps) ? parsed.exitBps : 3,
        longTh: Number.isFinite(parsed?.longTh) ? parsed.longTh : 0.62,
        symbols: Array.isArray(parsed?.symbols) ? parsed.symbols.slice(0, 128) : [],
        _v: 1,
      };
      return out;
    } catch {
      return null;
    }
  }

  save(s: BacktestsSettings): void {
    try {
      const payload: BacktestsSettings = { ...s, _v: 1 };
      localStorage.setItem(this.KEY, JSON.stringify(payload));
    } catch {
      // ignore quota/serialization errors
    }
  }

  clear(): void {
    try {
      localStorage.removeItem(this.KEY);
    } catch {}
  }
}
