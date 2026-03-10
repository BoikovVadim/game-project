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
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import compression from 'compression';
import * as express from 'express';
import { AppModule } from './app.module';
import { StatsExceptionFilter } from './common/stats-exception.filter';

async function bootstrap() {
  const server = express.default();
  server.use(express.json({ limit: '1mb' }));
  server.use(express.urlencoded({ extended: true, limit: '1mb' }));
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server));
  app.useGlobalFilters(new StatsExceptionFilter());

  app.use(compression());
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));

  const isProd = process.env.NODE_ENV === 'production';
  const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
    : [];

  app.enableCors({
    origin: isProd
      ? (origin, callback) => {
          if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
          } else {
            callback(new Error('CORS blocked'));
          }
        }
      : (origin, callback) => callback(null, origin || true),
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type,Authorization',
  });

  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: false,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  }));

  const port = parseInt(process.env.PORT || '3000', 10);
  await app.listen(port, '0.0.0.0');
}

bootstrap().catch((err) => {
  console.error('[FATAL] Bootstrap failed:', err?.message || err);
  process.exit(1);
});