// src/app/core/shared/utils/time.utils.ts

/**
 * Parse an ISO timestamp (UTC) into a Date.
 */
export function parseUTC(ts: string): Date {
  return new Date(ts);
}

/**
 * Return ISO string in UTC without milliseconds.
 */
export function toISOUTC(d: Date): string {
  // Ensure Z-terminated ISO without ms
  return new Date(d.getTime() - d.getMilliseconds()).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Floor a UTC Date to the nearest N minutes.
 * e.g., floorToNMinutes(new Date('...10:07Z'), 15) => 10:00Z
 */
export function floorToNMinutesUTC(d: Date, n: number): Date {
  const ms = d.getTime();
  const nMs = n * 60_000;
  const floored = Math.floor(ms / nMs) * nMs;
  return new Date(floored);
}

/**
 * Add minutes in UTC.
 */
export function addMinutesUTC(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 60_000);
}

/**
 * Difference in minutes between two ISO strings (b - a).
 */
export function diffMinutesUTC(aISO: string, bISO: string): number {
  return Math.round((parseUTC(bISO).getTime() - parseUTC(aISO).getTime()) / 60_000);
}
