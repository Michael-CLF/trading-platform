import { Bar15m } from './bar.model';

/**
 * A 15-minute bar with a label indicating the direction of the next 15m return.
 */
export interface LabeledBar15m extends Bar15m {
  y: 0 | 1; // 1 = next 15m close > current close; 0 = otherwise
}
