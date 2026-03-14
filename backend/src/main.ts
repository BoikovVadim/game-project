import { config } from 'dotenv';
import { existsSync } from 'fs';
import { join } from 'path';

const envCandidates = [
  join(__dirname, '..', `.env.${process.env.NODE_ENV || 'development'}`),
  join(__dirname, '..', '.env'),
];
for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    config({ path: envPath, override: false });
  }
}
process.env.TZ = 'Europe/Moscow';

// Предотвращение падения при необработанных ошибках (код 5 — V8 FATAL)
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err?.message || err);
  process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] unhandledRejection:', reason);
  process.exit(1);
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
  server.use(express.json({ limit: '15mb' }));
  server.use(express.urlencoded({ extended: true, limit: '15mb' }));
  const app = await NestFactory.create(AppModule, new ExpressAdapter(server));
  app.useGlobalFilters(new StatsExceptionFilter());

  app.use(compression());
  app.use((_req: express.Request, res: express.Response, next: express.NextFunction) => {
    const json = res.json.bind(res);
    res.json = (body: any) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return json(body);
    };
    next();
  });
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