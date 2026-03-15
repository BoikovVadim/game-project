import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { TournamentsService } from '../tournaments/tournaments.service';
import { LEAGUE_AMOUNTS } from '../tournaments/domain/constants';

function getArgValue(flag: string): string | null {
  const arg = process.argv.find((entry) => entry.startsWith(`${flag}=`));
  if (!arg) return null;
  return arg.slice(flag.length + 1);
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const tournamentsService = app.get(TournamentsService);
    const modeArg = getArgValue('--mode');
    const userIdArg = getArgValue('--user-id');
    const leagueAmountArg = getArgValue('--league-amount');
    const userId =
      userIdArg != null && userIdArg !== ''
        ? Number.parseInt(userIdArg, 10)
        : undefined;
    const leagueAmount =
      leagueAmountArg != null && leagueAmountArg !== ''
        ? Number.parseInt(leagueAmountArg, 10)
        : undefined;

    if (
      modeArg != null &&
      modeArg !== 'training' &&
      modeArg !== 'money'
    ) {
      throw new Error(`Unsupported mode: ${modeArg}`);
    }

    if (
      (userIdArg != null && Number.isNaN(userId)) ||
      (leagueAmountArg != null && Number.isNaN(leagueAmount))
    ) {
      throw new Error('Invalid numeric argument.');
    }

    const previews =
      modeArg === 'training'
        ? [
            await tournamentsService.previewReusableTournamentSelection({
              mode: 'training',
              userId,
            }),
          ]
        : modeArg === 'money'
          ? leagueAmount != null
            ? [
                await tournamentsService.previewReusableTournamentSelection({
                  mode: 'money',
                  userId,
                  leagueAmount,
                }),
              ]
            : await Promise.all(
                LEAGUE_AMOUNTS.map((amount) =>
                  tournamentsService.previewReusableTournamentSelection({
                    mode: 'money',
                    userId,
                    leagueAmount: amount,
                  }),
                ),
              )
          : [
              await tournamentsService.previewReusableTournamentSelection({
                mode: 'training',
                userId,
              }),
              ...(await Promise.all(
                LEAGUE_AMOUNTS.map((amount) =>
                  tournamentsService.previewReusableTournamentSelection({
                    mode: 'money',
                    userId,
                    leagueAmount: amount,
                  }),
                ),
              )),
            ];

    console.log(
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          userId: userId ?? null,
          previews,
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
