// Keep this tiny and provider-agnostic
export interface Quote {
  symbol: string; // e.g. "AAPL"
  price: number; // last trade or latest close/agg price
  change?: number; // price - previousClose
  changePct?: number; // (change / previousClose) * 100
  previousClose?: number;
  asOf: string; // ISO timestamp for when price was observed
  provider?: string; // "polygon" | "alpha_vantage" | etc. (optional)
}
