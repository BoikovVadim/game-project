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
    const result = await tournamentsService.repairTournamentConsistency();
    console.log(
      JSON.stringify(
        {
          backfilledTimeoutResolutionRows:
            result.backfilledTimeoutResolutionRows,
          backfilledParticipantRows: result.backfilledParticipantRows,
          recomputedCorrectCountRows:
            result.recomputedCorrectCountRows,
          skippedUnreliableCorrectCountRows:
            result.skippedUnreliableCorrectCountRows,
          backfilledResolvedResultRows:
            result.backfilledResolvedResultRows,
          finalizedTournamentStatuses:
            result.finalizedTournamentStatuses,
          deletedUnfinishedResultRows:
            result.deletedUnfinishedResultRows,
          activatedWaitingCount: result.activatedWaitingTournamentIds.length,
          activatedWaitingTournamentIds: result.activatedWaitingTournamentIds,
          reactivatedFinishedCount:
            result.reactivatedFinishedTournamentIds.length,
          reactivatedFinishedTournamentIds:
            result.reactivatedFinishedTournamentIds,
          deletedResultRows: result.deletedResultRows,
          convertedLegacyMoneyCount:
            result.convertedLegacyMoneyTournamentIds.length,
          convertedLegacyMoneyTournamentIds:
            result.convertedLegacyMoneyTournamentIds,
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
