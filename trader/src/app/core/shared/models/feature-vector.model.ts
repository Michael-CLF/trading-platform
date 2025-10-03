export interface FeatureVector {
  r1: number;
  r5: number;
  r15: number;
  r60: number;
  rsi14: number;
  emaGap9: number;
  emaGap21: number;
  atr14: number;
  spy15m: number;
}
export interface BuiltFeatureRow {
  ts15: string;
  symbol: string;
  feats: FeatureVector;
}
