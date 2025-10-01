import { Controller, Get, Query } from '@nestjs/common';
import { MarketService } from './market.service';
import { QuoteQueryDto, BarsQueryDto } from './dto/quote-query.dto';

@Controller('market')
export class MarketController {
  constructor(private readonly market: MarketService) {}

  @Get('quote')
  getQuote(@Query() q: QuoteQueryDto) {
    return this.market.getQuote(q.symbol);
  }

  @Get('bars')
  getBars(@Query() q: BarsQueryDto) {
    return this.market.getBars(q.symbol, q.interval, q.range, q.timezone);
  }
}
