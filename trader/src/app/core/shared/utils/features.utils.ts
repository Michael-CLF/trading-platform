// src/app/core/shared/utils/features.utils.ts

import { LabeledBar15m } from '../models/label.model';
import { FeatureVector } from '../models/feature-vector.model';

/** ---------- math helpers ---------- */
function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function rsi(values: number[], period = 14): number | null {
  if (values.length < period + 1) return null;
  let gains = 0,
    losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgG = gains / period;
  const avgL = losses / period;
  if (avgL === 0) return 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

function atr(highs: number[], lows: number[], closes: number[], period = 14): number | null {
  const n = highs.length;
  if (n < period + 1) return null;
  const trs: number[] = [];
  for (let i = n - period; i < n; i++) {
    const h = highs[i],
      l = lows[i];
    const prevClose = closes[i - 1];
    const tr = Math.max(h - l, Math.abs(h - prevClose), Math.abs(l - prevClose));
    trs.push(tr);
  }
  const sum = trs.reduce((a, b) => a + b, 0);
  return sum / trs.length;
}

function pctChange(a: number, b: number): number {
  return b === 0 ? 0 : a / b - 1;
}

/** ---------- feature builder ---------- */

/**
 * Build feature vectors for each labeled bar (uses ONLY history ≤ t).
 * Assumes input is sorted ascending by ts15.
 */
export function buildFeatures(
  labeled: LabeledBar15m[],
  symbol: string,
  spyContext?: Array<{ ts15: string; c: number }>,
): FeatureVector[] {
  const feats: FeatureVector[] = [];

  const closes: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];

  // optional context map (e.g., SPY 15m close for market context)
  const spyMap = spyContext ? new Map(spyContext.map((x) => [x.ts15, x.c])) : undefined;

  for (let i = 0; i < labeled.length; i++) {
    const row = labeled[i];
    closes.push(row.c);
    highs.push(row.h);
    lows.push(row.l);

    // rolling features must use history up to i (inclusive)
    const r1 = i >= 1 ? pctChange(closes[i], closes[i - 1]) : 0;
    const r5 = i >= 5 ? pctChange(closes[i], closes[i - 5]) : 0;
    const r15 = i >= 15 ? pctChange(closes[i], closes[i - 15]) : 0;
    const r60 = i >= 60 ? pctChange(closes[i], closes[i - 60]) : 0;

    const ema9 = ema(closes.slice(0, i + 1), 9);
    const ema21 = ema(closes.slice(0, i + 1), 21);
    const rsi14 = rsi(closes.slice(0, i + 1), 14);
    const atr14 = atr(highs.slice(0, i + 1), lows.slice(0, i + 1), closes.slice(0, i + 1), 14);

    // gaps from EMA (if undefined, set 0)
    const emaGap9 = ema9 != null ? closes[i] - ema9 : 0;
    const emaGap21 = ema21 != null ? closes[i] - ema21 : 0;

    // market context (SPY 15m return)
    let spy15m = 0;
    if (spyMap) {
      const spyC = spyMap.get(row.ts15);
      const prevSpy = spyMap.get(labeled[i - 1]?.ts15 ?? '');
      if (spyC != null && prevSpy != null) {
        spy15m = pctChange(spyC, prevSpy);
      }
    }

    // minute-of-day (0..389 for 6.5h RTH), rough using UTC minutes
    const d = new Date(row.ts15);
    const mod = d.getUTCHours() * 60 + d.getUTCMinutes();

    feats.push({
      ts15: row.ts15,
      symbol,
      feats: {
        r1,
        r5,
        r15,
        r60,
        rsi14: rsi14 ?? 50,
        emaGap9,
        emaGap21,
        atr14: atr14 ?? 0,
        spy15m,
        mod,
      },
    });
  }

  return feats;
}
