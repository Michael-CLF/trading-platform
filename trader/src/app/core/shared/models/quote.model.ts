export interface Quote {
  symbol: string;
  price: number;
  open?: number;
  high?: number;
  low?: number;
  prevClose?: number;
  change?: number; // absolute change
  changePct?: number; // percent change
  asOf: string; // ISO timestamp
}
