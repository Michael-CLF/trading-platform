export type Ticker = string;

export interface Candle {
  t: string; // ISO date/time
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface QuoteBarResponse {
  symbol: Ticker;
  candles: Candle[];
}
