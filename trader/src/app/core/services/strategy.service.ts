// src/app/services/strategy.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, map } from 'rxjs';

export interface MLPrediction {
  symbol: string;
  probability: number;
  timestamp: Date;
  threshold: number;
}

export interface TechnicalIndicator {
  symbol: string;
  type: 'sma_cross' | 'rsi' | 'bollinger';
  signal: 'buy' | 'sell' | 'neutral';
  strength: number; // 0-1
  timestamp: Date;
  metadata?: any;
}

export interface UnifiedSignal {
  symbol: string;
  action: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';
  confidence: number; // 0-1
  mlProbability?: number;
  technicalSignal?: 'buy' | 'sell' | 'neutral';
  reason: string;
  timestamp: Date;
  priceTarget?: number;
  stopLoss?: number;
}

@Injectable({ providedIn: 'root' })
export class StrategyService {
  // Thresholds for ML predictions
  private readonly ML_STRONG_BUY = 0.65;
  private readonly ML_BUY = 0.55;
  private readonly ML_SELL = 0.45;
  private readonly ML_STRONG_SELL = 0.35;

  // Store latest signals by symbol
  private mlPredictions = new BehaviorSubject<Map<string, MLPrediction>>(new Map());
  private technicalIndicators = new BehaviorSubject<Map<string, TechnicalIndicator>>(new Map());
  private unifiedSignals = new BehaviorSubject<Map<string, UnifiedSignal>>(new Map());

  // Track positions for context
  private activePositions = new Set<string>();

  /**
   * Update ML prediction from Tracker component
   */
  updateMLPrediction(symbol: string, probability: number, threshold: number = 0.55): void {
    const prediction: MLPrediction = {
      symbol,
      probability,
      threshold,
      timestamp: new Date(),
    };

    const predictions = this.mlPredictions.value;
    predictions.set(symbol, prediction);
    this.mlPredictions.next(predictions);

    // Recalculate unified signal
    this.calculateUnifiedSignal(symbol);
  }

  /**
   * Update technical indicator from Signals component or other sources
   */
  updateTechnicalIndicator(
    symbol: string,
    type: 'sma_cross' | 'rsi' | 'bollinger',
    signal: 'buy' | 'sell' | 'neutral',
    strength: number = 0.5,
  ): void {
    const indicator: TechnicalIndicator = {
      symbol,
      type,
      signal,
      strength,
      timestamp: new Date(),
    };

    const indicators = this.technicalIndicators.value;
    indicators.set(symbol, indicator);
    this.technicalIndicators.next(indicators);

    // Recalculate unified signal
    this.calculateUnifiedSignal(symbol);
  }

  /**
   * Get unified signal for a symbol
   */
  getUnifiedSignal(symbol: string): Observable<UnifiedSignal | undefined> {
    return this.unifiedSignals.pipe(map((signals) => signals.get(symbol)));
  }

  /**
   * Get all active unified signals
   */
  getAllUnifiedSignals(): Observable<UnifiedSignal[]> {
    return this.unifiedSignals.pipe(
      map((signals) => Array.from(signals.values())),
      map((signals) => signals.sort((a, b) => b.confidence - a.confidence)),
    );
  }

  /**
   * Get signals filtered by action type
   */
  getSignalsByAction(actions: string[]): Observable<UnifiedSignal[]> {
    return this.getAllUnifiedSignals().pipe(
      map((signals) => signals.filter((s) => actions.includes(s.action))),
    );
  }

  /**
   * Mark position as active/inactive
   */
  setPositionStatus(symbol: string, isActive: boolean): void {
    if (isActive) {
      this.activePositions.add(symbol);
    } else {
      this.activePositions.delete(symbol);
    }
    // Recalculate to adjust for position context
    this.calculateUnifiedSignal(symbol);
  }

  /**
   * Calculate unified signal from all available data
   */
  private calculateUnifiedSignal(symbol: string): void {
    const ml = this.mlPredictions.value.get(symbol);
    const technical = this.technicalIndicators.value.get(symbol);
    const hasPosition = this.activePositions.has(symbol);

    if (!ml && !technical) return;

    let action: UnifiedSignal['action'] = 'hold';
    let confidence = 0;
    let reason = '';

    // ML-only logic
    if (ml && !technical) {
      if (ml.probability >= this.ML_STRONG_BUY) {
        action = 'strong_buy';
        confidence = 0.8 + (ml.probability - this.ML_STRONG_BUY) * 0.5;
        reason = `Strong ML buy signal (${(ml.probability * 100).toFixed(1)}%)`;
      } else if (ml.probability >= this.ML_BUY) {
        action = 'buy';
        confidence = 0.6 + (ml.probability - this.ML_BUY) * 0.5;
        reason = `ML buy signal (${(ml.probability * 100).toFixed(1)}%)`;
      } else if (ml.probability <= this.ML_STRONG_SELL) {
        action = 'strong_sell';
        confidence = 0.8 + (this.ML_STRONG_SELL - ml.probability) * 0.5;
        reason = `Strong ML sell signal (${(ml.probability * 100).toFixed(1)}%)`;
      } else if (ml.probability <= this.ML_SELL) {
        action = 'sell';
        confidence = 0.6 + (this.ML_SELL - ml.probability) * 0.5;
        reason = `ML sell signal (${(ml.probability * 100).toFixed(1)}%)`;
      } else {
        action = 'hold';
        confidence = 0.3;
        reason = `ML neutral (${(ml.probability * 100).toFixed(1)}%)`;
      }
    }

    // Technical-only logic
    else if (technical && !ml) {
      if (technical.signal === 'buy') {
        action = technical.strength > 0.7 ? 'buy' : 'hold';
        confidence = technical.strength * 0.7;
        reason = `Technical buy signal (${technical.type})`;
      } else if (technical.signal === 'sell') {
        action = technical.strength > 0.7 ? 'sell' : 'hold';
        confidence = technical.strength * 0.7;
        reason = `Technical sell signal (${technical.type})`;
      } else {
        action = 'hold';
        confidence = 0.2;
        reason = 'Technical neutral';
      }
    }

    // Combined ML + Technical
    else if (ml && technical) {
      const mlAction = this.getMLAction(ml.probability);

      // Strong agreement
      if (mlAction === 'buy' && technical.signal === 'buy') {
        action = ml.probability >= this.ML_STRONG_BUY ? 'strong_buy' : 'buy';
        confidence = Math.min(0.95, (ml.probability + technical.strength) / 2 + 0.2);
        reason = `Confirmed buy: ML (${(ml.probability * 100).toFixed(1)}%) + Technical`;
      } else if (mlAction === 'sell' && technical.signal === 'sell') {
        action = ml.probability <= this.ML_STRONG_SELL ? 'strong_sell' : 'sell';
        confidence = Math.min(0.95, (1 - ml.probability + technical.strength) / 2 + 0.2);
        reason = `Confirmed sell: ML (${(ml.probability * 100).toFixed(1)}%) + Technical`;
      }
      // Disagreement
      else if (mlAction === 'buy' && technical.signal === 'sell') {
        action = 'hold';
        confidence = 0.2;
        reason = 'Conflicting signals - ML buy vs Technical sell';
      } else if (mlAction === 'sell' && technical.signal === 'buy') {
        action = 'hold';
        confidence = 0.2;
        reason = 'Conflicting signals - ML sell vs Technical buy';
      }
      // Partial agreement
      else if (mlAction === 'buy' && technical.signal === 'neutral') {
        action = ml.probability >= this.ML_STRONG_BUY ? 'buy' : 'hold';
        confidence = ml.probability * 0.6;
        reason = `ML buy (${(ml.probability * 100).toFixed(1)}%), technical neutral`;
      } else if (mlAction === 'sell' && technical.signal === 'neutral') {
        action = ml.probability <= this.ML_STRONG_SELL ? 'sell' : 'hold';
        confidence = (1 - ml.probability) * 0.6;
        reason = `ML sell (${(ml.probability * 100).toFixed(1)}%), technical neutral`;
      } else {
        action = 'hold';
        confidence = 0.3;
        reason = 'Both signals neutral';
      }
    }

    // Adjust for existing positions
    if (hasPosition) {
      // More conservative when already in position
      if (action === 'buy' || action === 'strong_buy') {
        action = 'hold';
        reason += ' (already in position)';
      }
      // Quicker to exit on sell signals
      if (action === 'sell') {
        confidence = Math.min(0.95, confidence + 0.1);
        reason = 'Exit signal: ' + reason;
      }
    }

    const unified: UnifiedSignal = {
      symbol,
      action,
      confidence,
      mlProbability: ml?.probability,
      technicalSignal: technical?.signal,
      reason,
      timestamp: new Date(),
    };

    const signals = this.unifiedSignals.value;
    signals.set(symbol, unified);
    this.unifiedSignals.next(signals);
  }

  private getMLAction(probability: number): 'buy' | 'sell' | 'hold' {
    if (probability >= this.ML_BUY) return 'buy';
    if (probability <= this.ML_SELL) return 'sell';
    return 'hold';
  }
}
