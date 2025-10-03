import {
  IsArray,
  IsNumber,
  IsObject,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Individual feature vector DTO for one symbol
 */
export class FeatureVectorDto {
  @IsNumber()
  r1: number;

  @IsNumber()
  r5: number;

  @IsNumber()
  r15: number;

  @IsNumber()
  r60: number;

  @IsNumber()
  rsi14: number;

  @IsNumber()
  emaGap9: number;

  @IsNumber()
  emaGap21: number;

  @IsNumber()
  atr14: number;

  @IsNumber()
  spy15m: number;

  @IsNumber()
  mod?: number;
}

/**
 * Top-level DTO for a prediction request
 */
export class PredictRequestDto {
  @IsString()
  symbol: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FeatureVectorDto)
  feats: FeatureVectorDto[];
}

/**
 * DTO for response
 */
export class PredictResponseDto {
  @IsArray()
  probs: number[];
}
