import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MarketController } from './market.controller';
import { MarketService } from './market.service';

@Module({
  imports: [HttpModule],
  controllers: [MarketController],
  providers: [MarketService],
})
export class MarketModule {}
