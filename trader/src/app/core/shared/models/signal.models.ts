export type SignalAction = 'buy' | 'sell' | 'hold';

export interface Signal {
  symbol: string;
  timestamp: string; // ISO
  action: SignalAction;
  confidence: number; // 0..1
  reason?: string;
}

export interface SignalResponse {
  signals: Signal[];
}
