// src/app/core/shared/utils/bars.utils.ts

import { Bar1m, Bar15m } from '../models/bar.model';
import { floorToNMinutesUTC, toISOUTC, parseUTC } from './time.utils';

/**
 * Aggregate 1-minute bars into deterministic 15-minute bars.
 * Assumes input minute bars are gapless per minute for the periods you care about.
 */
export function aggregateTo15m(minBars: Bar1m[]): Bar15m[] {
  if (!minBars?.length) return [];

  // group by 15m bucket keyed by CLOSE time of the 15m window
  const buckets = new Map<string, Bar1m[]>();

  for (const mb of minBars) {
    const d = parseUTC(mb.ts);
    // bucket close = floor(ts to 15m) + 15m
    const floor = floorToNMinutesUTC(d, 15);
    const close = new Date(floor.getTime() + 15 * 60_000);
    const key = toISOUTC(close);
    const arr = buckets.get(key);
    if (arr) arr.push(mb);
    else buckets.set(key, [mb]);
  }

  // produce bars sorted by key
  const out: Bar15m[] = [];
  const keys = Array.from(buckets.keys()).sort();
  for (const k of keys) {
    const arr = buckets.get(k)!;
    // sort minutes within bucket just in case
    arr.sort((a, b) => a.ts.localeCompare(b.ts));
    const o = arr[0].o;
    const c = arr[arr.length - 1].c;
    let h = -Infinity,
      l = Infinity,
      v = 0;
    for (const m of arr) {
      if (m.h > h) h = m.h;
      if (m.l < l) l = m.l;
      v += m.v;
    }
    out.push({ ts15: k, o, h, l, c, v });
  }
  return out;
}

/**
 * Detect if two 15m bars are consecutive (exactly 15 minutes apart).
 */
export function isConsecutive15m(a: Bar15m, b: Bar15m): boolean {
  const da = Date.parse(a.ts15);
  const db = Date.parse(b.ts15);
  return db - da === 15 * 60_000;
}
