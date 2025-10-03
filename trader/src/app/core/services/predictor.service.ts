// src/app/services/predictor.service.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, retry, timeout } from 'rxjs/operators';
import { FeatureVector } from '../shared/models/feature-vector.model';

/**
 * Feature vector structure expected by the API
 */
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
  mod: number;
}

/**
 * Prediction request payload
 */
export interface PredictRequest {
  symbol: string;
  feats: (FeatureVector | FeatureVectorApi | any)[];
}

/**
 * Prediction response from API
 */
export interface PredictResponse {
  probs: number[];
}

@Injectable({ providedIn: 'root' })
export class PredictorService {
  // Angular 18 pattern: Use inject() for DI
  private readonly http = inject(HttpClient);

  // Use relative URL to work with proxy in development
  private readonly baseUrl = '/api/v1/ai';

  // Configuration
  private readonly RETRY_COUNT = 2;
  private readonly TIMEOUT_MS = 10000;
  private readonly DEFAULT_MOD = 540; // Based on your working Postman example

  /**
   * Sanitizes and transforms feature data for API consumption
   * @param feature - Raw feature data from component
   * @returns Sanitized feature vector matching API requirements
   */
  sanitizeForApi(feature: FeatureVector | any): FeatureVectorApi {
    // Handle both nested {feats: {...}} and flat objects
    const source = feature?.feats ?? feature ?? {};

    // Helper to safely convert to number with fallback
    const toNumber = (value: any, defaultValue = 0): number => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : defaultValue;
    };

    // Build the API-compliant object
    return {
      r1: toNumber(source.r1),
      r5: toNumber(source.r5),
      r15: toNumber(source.r15),
      r60: toNumber(source.r60),
      rsi14: toNumber(source.rsi14),
      emaGap9: toNumber(source.emaGap9),
      emaGap21: toNumber(source.emaGap21),
      atr14: toNumber(source.atr14),
      spy15m: toNumber(source.spy15m),
      // Use mod from source if valid, otherwise use default
      mod:
        source.mod !== undefined && Number.isFinite(Number(source.mod))
          ? Math.floor(Math.max(0, Number(source.mod)))
          : this.DEFAULT_MOD,
    };
  }

  /**
   * Sends prediction request to ML API
   * @param request - Prediction request with symbol and features
   * @returns Observable stream of prediction probabilities
   */
  predict(request: PredictRequest): Observable<PredictResponse> {
    // Ensure all features are properly sanitized
    const sanitizedRequest: PredictRequest = {
      symbol: request.symbol,
      feats: request.feats.map((feat) => this.sanitizeForApi(feat)),
    };

    return this.http
      .post<PredictResponse>(`${this.baseUrl}/predict`, sanitizedRequest)
      .pipe(
        timeout(this.TIMEOUT_MS),
        retry(this.RETRY_COUNT),
        catchError(this.handleError.bind(this)),
      );
  }

  /**
   * Convenience method for single feature prediction
   * @param symbol - Stock symbol
   * @param feature - Single feature vector
   * @returns Observable stream of prediction probability
   */
  predictSingle(symbol: string, feature: FeatureVector | any): Observable<number> {
    const request: PredictRequest = {
      symbol,
      feats: [this.sanitizeForApi(feature)],
    };

    return new Observable((observer) => {
      this.predict(request).subscribe({
        next: (response) => {
          if (response.probs && response.probs.length > 0) {
            observer.next(response.probs[0]);
            observer.complete();
          } else {
            observer.error(new Error('No probability returned from prediction'));
          }
        },
        error: (error) => observer.error(error),
      });
    });
  }

  /**
   * Handles HTTP errors with appropriate logging and user messages
   */
  private handleError(error: HttpErrorResponse): Observable<never> {
    let errorMessage = 'Prediction service error';

    if (error.status === 0) {
      // Network or CORS error
      errorMessage =
        'Unable to connect to prediction service. Please check if the backend is running.';
      console.error('Network error:', error);
    } else if (error.status === 400) {
      // Validation error
      errorMessage = 'Invalid prediction data';
      if (error.error?.message) {
        errorMessage = Array.isArray(error.error.message)
          ? error.error.message[0]
          : error.error.message;
      }
      console.error('Validation error:', error.error);
    } else if (error.status === 500) {
      // Server error
      errorMessage = 'Prediction service error. Please try again.';
      console.error('Server error:', error);
    } else {
      // Other errors
      errorMessage = `Error: ${error.message}`;
      console.error('Unexpected error:', error);
    }

    return throwError(() => new Error(errorMessage));
  }
}
