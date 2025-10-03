import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment.development';
import { FeatureVector } from '../shared/models/feature-vector.model';

interface PredictRequest {
  symbol: string;
  features: Array<Record<string, number>>;
  version?: string;
}
interface PredictResponse {
  probs: number[];
}

@Injectable({ providedIn: 'root' })
export class PredictorService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiBaseUrl; // e.g. http://localhost:4000/api/v1

  /**
   * Convert FeatureVector[] to DTO and call /ai/predict
   */
  async predictBatch(symbol: string, feats: FeatureVector[]): Promise<number[]> {
    const payload: PredictRequest = {
      symbol,
      features: feats.map((f) => f.feats), // send plain feature objects
    };
    const res = await firstValueFrom(
      this.http.post<PredictResponse>(`${this.baseUrl}/ai/predict`, payload),
    );
    return Array.isArray(res?.probs) ? res.probs : [];
  }
}
