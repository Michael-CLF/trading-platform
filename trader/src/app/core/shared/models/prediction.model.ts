/**
 * Model prediction output for a specific 15-minute bar.
 */
export interface Prediction {
  ts15: string; // Timestamp of the bar predicted
  symbol: string;
  prob: number; // P(up) predicted by the model
  modelId: string; // Identifier for versioning models
  latencyMs?: number; // Optional: for monitoring inference latency
}
