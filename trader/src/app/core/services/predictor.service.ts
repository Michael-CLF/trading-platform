// src/app/services/predictor.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { FeatureVector } from '../shared/models/feature-vector.model';

export interface PredictRequest {
  symbol: string;
  feats: FeatureVector[];
}

export interface PredictResponse {
  probs: number[];
}

@Injectable({ providedIn: 'root' })
export class PredictorService {
  private readonly baseUrl = 'http://localhost:4000/api/v1/ai';

  constructor(private http: HttpClient) {}

  /**
   * Send features to backend AI and return predicted probabilities
   */
  async predict(symbol: string, feats: FeatureVector[]): Promise<PredictResponse> {
    const req: PredictRequest = { symbol, feats };
    return await firstValueFrom(this.http.post<PredictResponse>(`${this.baseUrl}/predict`, req));
  }
}
