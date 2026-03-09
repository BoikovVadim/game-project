import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '..', '.env') });
process.env.TZ = 'Europe/Moscow';

// Предотвращение падения при необработанных ошибках (код 5 — V8 FATAL)
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err?.message || err);
  process.exitCode = 1;
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] unhandledRejection:', reason);
  process.exitCode = 1;
});

import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { StatsExceptionFilter } from './common/stats-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, new ExpressAdapter());
  app.useGlobalFilters(new StatsExceptionFilter());
  app.enableCors({
    origin: (origin, callback) => callback(null, origin || true),
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type,Authorization',
  });
  const port = parseInt(process.env.PORT || '3000', 10);
  await app.listen(port, '0.0.0.0');
}

bootstrap().catch((err) => {
  console.error('[FATAL] Bootstrap failed:', err?.message || err);
  process.exit(1);
});