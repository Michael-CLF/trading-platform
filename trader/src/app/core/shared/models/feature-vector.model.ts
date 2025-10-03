/**
 * Feature vector structure for model inputs.
 * Each 15-minute bar gets transformed into a feature vector for prediction.
 */
export interface FeatureVector {
  ts15: string; // ISO UTC timestamp aligned to 15m bar close
  symbol: string; // e.g. "AAPL", "SPY", "^DJI"
  feats: Record<string, number>; // r1, r5, r15, rsi14, atr14, etc.
}
