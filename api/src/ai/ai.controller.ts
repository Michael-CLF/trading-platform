// api/src/ai/ai.controller.ts
import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { AiService } from './ai.service';
import { PredictRequestDto, PredictResponseDto } from './dto/predict.dto';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  /**
   * POST /ai/predict
   * Body: { symbol: string, feats: FeatureVectorDto[] }
   * Returns: { probs: number[] }
   */
  @Post('predict')
  @HttpCode(200)
  async predict(@Body() body: PredictRequestDto): Promise<PredictResponseDto> {
    if (!body?.feats?.length) {
      return { probs: [] };
    }
    return this.aiService.predict(body);
  }
}
