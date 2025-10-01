import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import configuration from './config/configuration';
import { AppController } from './app.controller';
import { MarketModule } from './market/market.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      expandVariables: true,
    }),
    CacheModule.register({ isGlobal: true }),
    MarketModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
