export interface Bar {
  t: string; // ISO timestamp
  o: number; // open
  h: number; // high
  l: number; // low
  c: number; // close
  v?: number; // volume (if provider supports it)
}

export interface BarsResponse {
  symbol: string;
  interval: string; // e.g., '1d', '15m'
  range: string; // e.g., '1mo', '5d'
  timezone: string;
  bars: Bar[];
}
