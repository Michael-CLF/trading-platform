export type TradeSide = 'BUY' | 'SELL';

export interface TradeEntry {
  id: string; // uuid
  symbol: string; // e.g., 'NVDA'
  side: TradeSide; // BUY or SELL
  quantity: number; // positive integers/decimals
  price: number; // your actual fill price
  timestamp: number; // ms since epoch
  notes?: string;
}

export interface PositionLot {
  symbol: string;
  quantity: number; // net qty (can be 0 after sells)
  avgPrice: number; // weighted average cost
  costBasis: number; // quantity * avgPrice
}

export interface PositionWithLive extends PositionLot {
  last?: number; // live price
  marketValue?: number; // quantity * last
  unrealizedPL?: number; // (last - avgPrice) * quantity
  unrealizedPLPct?: number; // unrealizedPL / costBasis
}

export interface Trade {
  id: string; // UUID or timestamp+symbol key
  symbol: string;
  side: 'long' | 'short' | 'flat';
  size: number; // Position size (e.g. shares or notional %)
  entryTs: string;
  entryPx: number;
  exitTs?: string;
  exitPx?: number;
  pnl?: number; // Realized PnL after costs
  reason: 'signal' | 'stop' | 'tp' | 'timeout'; // Why the trade closed
  vendor?: 'polygon' | 'providerB'; // Data vendor used
}
