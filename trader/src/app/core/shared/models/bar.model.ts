// src/app/core/shared/models/bar.model.ts

/**
 * Base 1-minute bar as ingested from your vendor (UTC timestamps).
 */
export interface Bar1m {
  ts: string; // ISO 8601 UTC, e.g. "2025-10-03T14:30:00Z"
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/**
 * 15-minute bar aligned to the 15m close time.
 * ts15 is the close timestamp of the 15-minute window in UTC.
 */
export interface Bar15m {
  ts15: string; // ISO 8601 UTC, aligned to the 15-minute close
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}
