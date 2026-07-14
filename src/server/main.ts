import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['log', 'error', 'warn'] });

  // CORS (optional; safe)
  app.enableCors({ origin: true });

  const port = Number(process.env.PORT || process.env.APP_PORT || 3000);
  await app.listen(port, '0.0.0.0');

  console.log(`[lyricstify-http] listening on ${port}`);
}

bootstrap();
