// src/app/core/shared/utils/calendar.utils.ts

import { parseUTC, toISOUTC, addMinutesUTC } from './time.utils';

/**
 * Simple RTH (Regular Trading Hours) helper for US equities:
 * 09:30–16:00 America/New_York. We work in UTC to avoid DST issues:
 * - In EST: 14:30–21:00 UTC
 * - In EDT: 13:30–20:00 UTC
 *
 * We approximate by checking minutes-from-midnight UTC in either range.
 * For intraday modeling this is sufficient; swap with an exchange-calendar later if needed.
 */

function minutesFromMidnightUTC(d: Date): number {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

// Accept either EDT(13:30–20:00) or EST(14:30–21:00) windows.
const RTH_WINDOWS_UTC = [
  { start: 13 * 60 + 30, end: 20 * 60 }, // 13:30–20:00 UTC (EDT)
  { start: 14 * 60 + 30, end: 21 * 60 }, // 14:30–21:00 UTC (EST)
];

export function isRTHCloseUTC(tsISO: string): boolean {
  const d = parseUTC(tsISO);
  const m = minutesFromMidnightUTC(d);
  return RTH_WINDOWS_UTC.some((w) => m >= w.start && m <= w.end);
}

/**
 * Next 15m close timestamp after a given 15m close.
 */
export function next15mClose(tsISO: string): string {
  return toISOUTC(addMinutesUTC(parseUTC(tsISO), 15));
}
