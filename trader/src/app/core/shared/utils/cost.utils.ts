/**
 * Basis points helper: 1 bp = 0.01% = 0.0001 in fraction.
 */
export function bps(n: number): number {
  return n / 10_000;
}

/**
 * Apply round-trip costs (entry + exit) in basis points to a fractional return.
 * Example: raw 0.004 (40 bps); costBps 6 -> net ≈ 0.0034 (34 bps).
 */
export function applyRoundTripCosts(rawReturn: number, costBps: number): number {
  const cost = bps(costBps);
  return rawReturn - cost;
}

/**
 * Apply separate entry/exit costs (bps) to a fractional return.
 */
export function applyPerSideCosts(rawReturn: number, entryBps: number, exitBps: number): number {
  const cost = bps(entryBps) + bps(exitBps);
  return rawReturn - cost;
}

/**
 * Rough helper to convert an average quoted spread (bps) into expected slippage (bps).
 * You can tweak the fillFraction based on your order type and liquidity.
 */
export function expectedSlippageBps(quotedSpreadBps: number, fillFraction = 0.5): number {
  return Math.max(0, quotedSpreadBps * fillFraction);
}
export function addBorrowCostBps(
  netReturn: number,
  borrowBpsPerYear: number,
  minutesHeld: number,
): number {
  const perMinute = borrowBpsPerYear / (365 * 24 * 60); // bps per minute
  const borrow = (perMinute * minutesHeld) / 10_000;
  return netReturn - borrow;
}
