// src/app/core/shared/utils/labeler.utils.ts

import { Bar15m } from '../models/bar.model';
import { LabeledBar15m } from '../models/label.model';
import { isConsecutive15m } from './bars.utils';

/**
 * Build labels y_t for "next 15m return > 0".
 * Drops the final bar or any non-consecutive gaps.
 */
export function makeNext15mLabels(bars15: Bar15m[]): LabeledBar15m[] {
  const out: LabeledBar15m[] = [];
  for (let i = 0; i < bars15.length - 1; i++) {
    const cur = bars15[i];
    const nxt = bars15[i + 1];
    if (!isConsecutive15m(cur, nxt)) continue;
    const y: 0 | 1 = nxt.c > cur.c ? 1 : 0;
    out.push({ ...cur, y });
  }
  return out;
}
