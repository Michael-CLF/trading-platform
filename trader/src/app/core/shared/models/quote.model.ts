// src/app/core/shared/models/quote.model.ts
export interface Quote {
  symbol: string;
  price: number;
  change?: number;
  changePct?: number;
  previousClose?: number;
  asOf: string;
  provider?: string;
}
