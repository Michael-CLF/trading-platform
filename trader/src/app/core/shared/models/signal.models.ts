// Actions are lowercase to match your template/usage
export type SignalAction = 'buy' | 'sell' | 'hold';

// What your template expects each row to have
export interface Signal {
  symbol: string;
  action: SignalAction;
  price: number;

  // 👇 fields used in signals.html
  confidence: number; // 0..1
  timestamp: string; // ISO datetime string
  reason?: string; // optional explanation
}

// Keep this so `signals.service.ts` can import it
export interface SignalResponse {
  signals: Signal[];
}
