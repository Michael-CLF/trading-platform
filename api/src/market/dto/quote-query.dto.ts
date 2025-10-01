import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

export class QuoteQueryDto {
  @IsString()
  @Matches(/^[A-Z.\-]{1,10}$/, { message: 'symbol must be uppercase ticker' })
  symbol!: string;
}

export class BarsQueryDto {
  @IsString()
  @Matches(/^[A-Z.\-]{1,10}$/)
  symbol!: string;

  @IsIn(['1m', '5m', '15m', '30m', '1h', '1d'])
  interval!: '1m' | '5m' | '15m' | '30m' | '1h' | '1d';

  @IsIn(['1d', '5d', '1mo', '3mo', '6mo', '1y'])
  range!: '1d' | '5d' | '1mo' | '3mo' | '6mo' | '1y';

  @IsOptional()
  @IsString()
  timezone?: string; // e.g., 'America/New_York'
}
