// api/src/ai/ai.service.ts
import { Injectable } from '@nestjs/common';
import {
  PredictRequestDto,
  PredictResponseDto,
  FeatureVectorDto,
} from './dto/predict.dto';

@Injectable()
export class AiService {
  async predict(req: PredictRequestDto): Promise<PredictResponseDto> {
    const probs = req.feats.map((fv: FeatureVectorDto) =>
      this.calculateSignalStrength(fv),
    );
    return { probs };
  }

  /**
   * Calculate buy/sell signal strength based on technical indicators
   * Returns 0-1 where:
   * > 0.6 = Buy signal
   * < 0.4 = Sell signal
   * 0.4-0.6 = Neutral/Hold
   */
  private calculateSignalStrength(fv: FeatureVectorDto): number {
    let score = 0.5; // Start neutral
    let signals = 0;
    let totalSignals = 0;

    // RSI Signal (most reliable)
    // Oversold < 30 = Buy, Overbought > 70 = Sell
    if (fv.rsi14 > 0) {
      totalSignals++;
      if (fv.rsi14 < 30) {
        score += 0.15; // Strong buy signal
        signals++;
      } else if (fv.rsi14 < 40) {
        score += 0.08; // Weak buy signal
        signals += 0.5;
      } else if (fv.rsi14 > 70) {
        score -= 0.15; // Strong sell signal
        signals--;
      } else if (fv.rsi14 > 60) {
        score -= 0.08; // Weak sell signal
        signals -= 0.5;
      }
    }

    // Momentum Signal (5-minute return)
    // Strong positive momentum = buy
    totalSignals++;
    if (fv.r5 > 0.002) {
      // > 0.2% in 5 min
      score += 0.1;
      signals++;
    } else if (fv.r5 > 0.001) {
      // > 0.1% in 5 min
      score += 0.05;
      signals += 0.5;
    } else if (fv.r5 < -0.002) {
      // < -0.2% in 5 min
      score -= 0.1;
      signals--;
    } else if (fv.r5 < -0.001) {
      // < -0.1% in 5 min
      score -= 0.05;
      signals -= 0.5;
    }

    // EMA Gap Signal (9 vs 21)
    // Positive gap = uptrend, Negative = downtrend
    if (fv.emaGap9 !== 0 || fv.emaGap21 !== 0) {
      totalSignals++;
      const avgGap = (fv.emaGap9 + fv.emaGap21) / 2;

      if (avgGap > 0.001) {
        // Strong uptrend
        score += 0.08;
        signals++;
      } else if (avgGap > 0) {
        // Weak uptrend
        score += 0.04;
        signals += 0.5;
      } else if (avgGap < -0.001) {
        // Strong downtrend
        score -= 0.08;
        signals--;
      } else if (avgGap < 0) {
        // Weak downtrend
        score -= 0.04;
        signals -= 0.5;
      }
    }

    // SPY Correlation (market following)
    // If SPY is up, individual stocks likely to follow
    if (fv.spy15m !== 0) {
      totalSignals++;
      if (fv.spy15m > 0.001) {
        // SPY up > 0.1%
        score += 0.05;
        signals += 0.3;
      } else if (fv.spy15m < -0.001) {
        // SPY down < -0.1%
        score -= 0.05;
        signals -= 0.3;
      }
    }

    // Volatility adjustment (ATR)
    // High volatility = less confident signals
    if (fv.atr14 > 0.02) {
      // > 2% ATR is high volatility
      score = 0.5 + (score - 0.5) * 0.7; // Reduce signal strength by 30%
    }

    // Ensure score stays within bounds [0, 1]
    score = Math.max(0.05, Math.min(0.95, score));

    // Add confidence adjustment based on signal agreement
    // If multiple indicators agree, increase confidence
    const signalAgreement =
      totalSignals > 0 ? Math.abs(signals) / totalSignals : 0;
    if (signalAgreement > 0.7) {
      // Strong agreement - push score further from 0.5
      if (score > 0.5) {
        score = Math.min(0.95, score + 0.1);
      } else {
        score = Math.max(0.05, score - 0.1);
      }
    }

    return score;
  }

  /**
   * Helper: Simple sigmoid (keeping for backwards compatibility)
   * Not used in new calculation
   */
  private sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x));
  }
}
