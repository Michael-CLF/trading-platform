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
      this.probFromFeatures(fv),
    );
    return { probs };
  }

  /** logistic helper */
  private sigmoid(x: number): number {
    return 1 / (1 + Math.exp(-x));
  }

  /**
   * Apply a simple linear model to a single feature vector
   */
  private probFromFeatures(fv: FeatureVectorDto): number {
    const x =
      0.8 * fv.r5 +
      0.55 * fv.r15 +
      0.25 * fv.r60 +
      0.2 * fv.spy15m +
      0.1 * ((fv.rsi14 - 50) / 50) +
      0.08 * fv.emaGap9 +
      0.04 * fv.emaGap21 -
      0.02 * fv.atr14 +
      0.15 * fv.r1;

    return this.sigmoid(x);
  }
}
