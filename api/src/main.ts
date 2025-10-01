import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import helmet from 'helmet';
import compression from 'compression';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Security + performance
  app.use(helmet());
  app.use(compression());

  // Global URL prefix and versioning (e.g., /api/v1/...)
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // CORS (lock down later to your domain)
  app.enableCors({
    origin: true, // dev: allow all; prod: set your domain(s)
    credentials: true,
  });

  // Strict request validation everywhere
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip unknown props
      forbidNonWhitelisted: true,
      transform: true, // auto-transform DTO primitives
    }),
  );

  const port = process.env.PORT ? Number(process.env.PORT) : 4000;
  await app.listen(port);
  console.log(`API listening on http://localhost:${port}/api/v1`);
}
bootstrap();
