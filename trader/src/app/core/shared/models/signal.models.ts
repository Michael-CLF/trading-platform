export type SignalAction = 'buy' | 'sell' | 'hold';

export interface Signal {
  symbol: string;
  action: SignalAction;
  price: number;
  note?: string;
}
