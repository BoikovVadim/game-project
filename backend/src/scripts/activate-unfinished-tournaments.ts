import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { TournamentsService } from '../tournaments/tournaments.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const tournamentsService = app.get(TournamentsService);
    const result = await tournamentsService.backfillWaitingTournamentsToActive();
    console.log(
      JSON.stringify(
        {
          updatedCount: result.updatedTournamentIds.length,
          updatedTournamentIds: result.updatedTournamentIds,
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
