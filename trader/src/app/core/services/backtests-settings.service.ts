import { Injectable } from '@angular/core';

export interface BacktestsSettings {
  entryBps: number;
  exitBps: number;
  longTh: number;
  symbols: string[];
}

const KEY = 'bt.settings.v1';

@Injectable({ providedIn: 'root' })
export class BacktestsSettingsService {
  load(): BacktestsSettings | null {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as BacktestsSettings) : null;
    } catch {
      return null;
    }
  }

  save(s: BacktestsSettings): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* ignore */
    }
  }
}
