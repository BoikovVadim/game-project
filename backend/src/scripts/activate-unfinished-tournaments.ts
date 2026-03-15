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
    const waitingResult = await tournamentsService.backfillWaitingTournamentsToActive();
    const finishedResult =
      await tournamentsService.reactivateStructurallyUnfinishedFinishedTournaments();
    console.log(
      JSON.stringify(
        {
          activatedWaitingCount: waitingResult.updatedTournamentIds.length,
          activatedWaitingTournamentIds: waitingResult.updatedTournamentIds,
          reactivatedFinishedCount: finishedResult.reactivatedTournamentIds.length,
          reactivatedFinishedTournamentIds:
            finishedResult.reactivatedTournamentIds,
          deletedResultRows: finishedResult.deletedResultRows,
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
