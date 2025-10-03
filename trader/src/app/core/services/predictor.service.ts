// src/app/services/predictor.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { FeatureVector } from '../shared/models/feature-vector.model';
import { Observable } from 'rxjs';

// Must match the Nest DTO exactly
export interface FeatureVectorApi {
  r1: number;
  r5: number;
  r15: number;
  r60: number;
  rsi14: number;
  emaGap9: number;
  emaGap21: number;
  atr14: number;
  spy15m: number;
  // If your DTO allows `mod`, keep it optional. If not allowed, remove it here.
  mod?: number;
}

export interface PredictRequest {
  symbol: string;
  feats: FeatureVector[];
}

export interface PredictResponse {
  probs: number[];
}

@Injectable({ providedIn: 'root' })
export class PredictorService {
  private baseUrl = 'http://localhost:4000/api/v1/ai';
  constructor(private http: HttpClient) {}

  // Keep this helper public so components can reuse it.
  sanitizeForApi(f: any): FeatureVectorApi {
    // Accept either {feats:{...}} or a flat feature object
    const v = f?.feats ?? f ?? {};

    const num = (x: any) => (Number.isFinite(x) ? Number(x) : 0);

    const out: FeatureVectorApi = {
      r1: num(v.r1),
      r5: num(v.r5),
      r15: num(v.r15),
      r60: num(v.r60),
      rsi14: num(v.rsi14),
      emaGap9: num(v.emaGap9),
      emaGap21: num(v.emaGap21),
      atr14: num(v.atr14),
      spy15m: num(v.spy15m),
    };

    // If your Nest DTO ALLOWS `mod`, sanitize it to a non-negative int.
    // If it does NOT allow `mod`, comment this out to exclude it.
    if (v.mod != null && Number.isFinite(+v.mod)) {
      out.mod = Math.max(0, Math.floor(+v.mod));
    }

    return out;
  }

  predict(req: PredictRequest): Observable<PredictResponse> {
    return this.http.post<PredictResponse>(`${this.baseUrl}/predict`, req);
  }
}
