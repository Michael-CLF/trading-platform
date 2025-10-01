import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Controller()
export class AppController {
  constructor(private readonly config: ConfigService) {}

  @Get('health')
  health() {
    return {
      ok: true,
      env: this.config.get<string>('nodeEnv'),
      version: 'v1',
    };
  }
}
