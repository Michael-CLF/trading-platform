import {
  Controller,
  Get,
  Query,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { MarketService } from './market.service';
import { QuoteQueryDto, BarsQueryDto } from './dto/quote-query.dto';

/**
 * Market Controller
 * Handles all market data endpoints for stock quotes and historical bars
 */
@Controller('market')
export class MarketController {
  constructor(private readonly market: MarketService) {}

  /**
   * Get real-time quote for a stock symbol
   * @param q Query parameters containing the stock symbol
   * @returns Quote data with price, currency, and timestamp
   */
  @Get('quote')
  async getQuote(@Query() q: QuoteQueryDto) {
    try {
      return await this.market.getQuote(q.symbol);
    } catch (error) {
      // Log for debugging
      console.error(`Quote failed for ${q.symbol}:`, error);

      // Re-throw if it's already an HttpException
      if (error instanceof HttpException) {
        throw error;
      }

      // Otherwise, wrap in a proper HTTP exception
      throw new HttpException(
        {
          message: `Failed to fetch quote for ${q.symbol}`,
          symbol: q.symbol,
          error: 'Market data unavailable',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /**
   * Get historical price bars for a stock symbol
   * @param q Query parameters for bars request
   * @returns Array of OHLCV bars for the specified period
   */
  @Get('bars')
  async getBars(@Query() q: BarsQueryDto) {
    try {
      return await this.market.getBars(
        q.symbol,
        q.interval,
        q.range,
        q.timezone,
      );
    } catch (error) {
      // Log for debugging
      console.error(`Bars failed for ${q.symbol}:`, error);

      // Re-throw if it's already an HttpException
      if (error instanceof HttpException) {
        throw error;
      }

      // Otherwise, wrap in a proper HTTP exception
      throw new HttpException(
        {
          message: `Failed to fetch bars for ${q.symbol}`,
          symbol: q.symbol,
          interval: q.interval,
          range: q.range,
          error: 'Market data unavailable',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
