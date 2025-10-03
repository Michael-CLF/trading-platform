// trader/src/app/core/services/predictor.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, of } from 'rxjs';
import { catchError, map, retry, timeout } from 'rxjs/operators';

import { environment } from '../../../environments/environment.development';
import { FeatureVector } from '../shared/models/feature-vector.model';

/**
 * Central place to get per-bar probabilities (Pr(up) in next bar).
 * - Tries your backend first (POST /ai/predict)
 * - Falls back to a local heuristic model (same weights we prototyped)
 *
 * Swap the server endpoint to a real model later without touching components.
 */
@Injectable({ providedIn: 'root' })
export class PredictorService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiBaseUrl; // e.g. http://localhost:4000/api/v1

  /**
   * Batch predict probabilities for a symbol.
   * @param symbol Ticker (e.g., 'AAPL')
   * @param fvs    Engineered feature vectors (from buildFeatures)
   * @returns      Array of probabilities in [0,1] (length === fvs.length)
   */
  async predictBatch(symbol: string, fvs: FeatureVector[]): Promise<number[]> {
    if (!fvs?.length) return [];

    // ---- Try backend first (optional but recommended) ----
    // Adjust path if your backend expects a different route
    // POST body only sends the raw feature maps to keep payload compact
    const body = {
      symbol,
      features: fvs.map((fv) => fv.feats),
      // you can add metadata if helpful: timestamps, bar size, etc.
    };

    try {
      const probs = await firstValueFrom(
        this.http.post<{ probs: number[] }>(`${this.baseUrl}/ai/predict`, body).pipe(
          timeout(8_000),
          retry({ count: 1 }),
          map((res) => {
            const arr = Array.isArray(res?.probs) ? res.probs : [];
            // Validate & clamp
            return arr.map((p) => (Number.isFinite(p) ? Math.min(1, Math.max(0, Number(p))) : 0.5));
          }),
          catchError((_err: HttpErrorResponse) => of(this.localPredict(fvs))),
        ),
      );

      // If server returned wrong length, fall back locally to keep alignment perfect
      if (probs.length === fvs.length) return probs;
      return this.localPredict(fvs);
    } catch {
      // Network/timeout/etc. -> local fallback
      return this.localPredict(fvs);
    }
  }

  // ---------- Local fallback model (same heuristic as prototype) ----------

  /** logistic σ(x) */
  private sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x));
  }

  /**
   * Hand-tuned linear score. Keep in sync with your prototype until you swap to a real model.
   * You can move weights to environment/settings if you want to tweak from the UI later.
   */
  private score(feats: Record<string, number>): number {
    const r1 = feats['r1'] ?? 0;
    const r5 = feats['r5'] ?? 0;
    const r15 = feats['r15'] ?? 0;
    const r60 = feats['r60'] ?? 0;
    const rsi14 = feats['rsi14'] ?? 50;
    const gap9 = feats['emaGap9'] ?? 0;
    const gap21 = feats['emaGap21'] ?? 0;
    const atr14 = feats['atr14'] ?? 0;
    const spy15 = feats['spy15m'] ?? 0;

    // same weights you used in the component earlier
    return (
      0.8 * r5 +
      0.55 * r15 +
      0.25 * r60 +
      0.2 * spy15 +
      0.1 * ((rsi14 - 50) / 50) +
      0.08 * gap9 +
      0.04 * gap21 -
      0.02 * atr14 +
      0.15 * r1
    );
  }

  /** Local probabilities for each feature vector. */
  private localPredict(fvs: FeatureVector[]): number[] {
    return fvs.map((fv) => this.sigmoid(this.score(fv.feats)));
  }
}
