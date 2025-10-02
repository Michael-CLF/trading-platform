import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * DTO for stock quote query parameters
 * Validates ticker symbols and ensures uppercase format
 */
export class QuoteQueryDto {
  @IsString()
  @Transform(({ value }) => value?.toUpperCase()) // Auto-uppercase for consistency
  @Matches(/^[A-Z.\-]{1,10}$/, {
    message:
      'Symbol must be 1-10 characters, uppercase letters, dots, or hyphens',
  })
  symbol!: string;
}

/**
 * DTO for market bars/candles query parameters
 * Validates all parameters for historical price data
 */
export class BarsQueryDto {
  @IsString()
  @Transform(({ value }) => value?.toUpperCase()) // Auto-uppercase for consistency
  @Matches(/^[A-Z.\-]{1,10}$/, {
    message:
      'Symbol must be 1-10 characters, uppercase letters, dots, or hyphens',
  })
  symbol!: string;

  @IsEnum(['1m', '5m', '15m', '30m', '1h', '1d'], {
    message: 'Interval must be one of: 1m, 5m, 15m, 30m, 1h, 1d',
  })
  interval!: '1m' | '5m' | '15m' | '30m' | '1h' | '1d';

  @IsEnum(['1d', '5d', '1mo', '3mo', '6mo', '1y'], {
    message: 'Range must be one of: 1d, 5d, 1mo, 3mo, 6mo, 1y',
  })
  range!: '1d' | '5d' | '1mo' | '3mo' | '6mo' | '1y';

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z_]+\/[A-Za-z_]+$/, {
    message: 'Timezone must be in format like America/New_York',
  })
  timezone?: string;
}

/**
 * Type definitions for better type safety across the application
 */
export type BarsInterval = '1m' | '5m' | '15m' | '30m' | '1h' | '1d';
export type BarsRange = '1d' | '5d' | '1mo' | '3mo' | '6mo' | '1y';
