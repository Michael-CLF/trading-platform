// src/app/core/shared/utils/cost.utils.ts

/**
 * Apply round-trip costs in basis points to a raw PnL (fractional return).
 * Example: raw 0.004 (40 bps); costBps=6 -> net ≈ 0.0034 (34 bps).
 */
export function applyRoundTripCosts(rawReturn: number, costBps: number): number {
  const cost = costBps / 10_000;
  return rawReturn - cost;
}

/**
 * Convert bps to fractional cost.
 */
export function bps(n: number): number {
  return n / 10_000;
}
