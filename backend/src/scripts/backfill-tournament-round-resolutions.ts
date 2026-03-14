import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '..', '..', '.env') });

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { TournamentsService } from '../tournaments/tournaments.service';

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const tournamentsService = app.get(TournamentsService);
    const result = await tournamentsService.backfillTimeoutRoundResolutions();
    console.log(`[backfill:tournament-resolutions] inserted ${result.inserted} rows`);
  } finally {
    await app.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
