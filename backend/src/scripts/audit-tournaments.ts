import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { TournamentsService } from '../tournaments/tournaments.service';

type AuditIssue = Record<string, unknown>;

function pushIssue(
  bucket: Record<string, AuditIssue[]>,
  kind: string,
  issue: AuditIssue,
): void {
  if (!bucket[kind]) bucket[kind] = [];
  bucket[kind]!.push(issue);
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const dataSource = app.get(DataSource);
    const tournamentsService = app.get(TournamentsService);

    const deterministicIssues: Record<string, AuditIssue[]> = {};

    const unfinishedWithResults = (await dataSource.query(
      `SELECT DISTINCT t.id AS "tournamentId", t.status
       FROM tournament t
       INNER JOIN tournament_result r ON r."tournamentId" = t.id
       WHERE t.status <> 'finished'
       ORDER BY t.id ASC`,
    )) as Array<{ tournamentId: number; status: string }>;
    for (const row of unfinishedWithResults) {
      pushIssue(deterministicIssues, 'unfinished_with_results', row);
    }

    const waitingArtifacts = (await dataSource.query(
      `SELECT t.id AS "tournamentId",
              t."gameType" AS "gameType",
              t.status AS status
       FROM tournament t
       LEFT JOIN tournament_result r ON r."tournamentId" = t.id
       LEFT JOIN tournament_round_resolution rr ON rr."tournamentId" = t.id
       LEFT JOIN tournament_escrow e ON e."tournamentId" = t.id
       WHERE t.status = 'waiting'
         AND COALESCE(json_array_length(COALESCE(t."playerOrder"::json, '[]'::json)), 0) <= 1
       GROUP BY t.id, t."gameType", t.status
       HAVING COUNT(*) FILTER (WHERE r.id IS NOT NULL) > 0
           OR COUNT(*) FILTER (WHERE rr.id IS NOT NULL) > 0
           OR COUNT(*) FILTER (WHERE e.status IN ('refunded', 'forfeited', 'paid_to_winner')) > 0
       ORDER BY t.id ASC`,
    )) as Array<{ tournamentId: number; gameType: string | null; status: string }>;
    for (const row of waitingArtifacts) {
      pushIssue(deterministicIssues, 'waiting_single_slot_artifacts', row);
    }

    const waitingNotActive = (await dataSource.query(
      `SELECT t.id AS "tournamentId",
              t.status AS status,
              t."gameType" AS "gameType",
              t."leagueAmount" AS "leagueAmount",
              COALESCE(json_array_length(COALESCE(t."playerOrder"::json, '[]'::json)), 0) AS "playerOrderCount",
              COUNT(DISTINCT p.id) AS "progressCount"
       FROM tournament t
       LEFT JOIN tournament_progress p ON p."tournamentId" = t.id
       WHERE t.status = 'waiting'
       GROUP BY t.id, t.status, t."gameType", t."leagueAmount", t."playerOrder"
       ORDER BY t.id ASC`,
    )) as Array<{
      tournamentId: number;
      status: string;
      gameType: string | null;
      leagueAmount: number | null;
      playerOrderCount: number;
      progressCount: number;
    }>;
    for (const row of waitingNotActive) {
      pushIssue(deterministicIssues, 'waiting_not_active', row);
    }

    const userRows = (await dataSource.query(
      `SELECT DISTINCT "userId" AS id
       FROM tournament_progress
       ORDER BY "userId" ASC`,
    )) as Array<{ id: number }>;
    const auditedUsers = userRows.map((row) => Number(row.id)).filter((id) => id > 0);

    for (const userId of auditedUsers) {
      for (const mode of ['training', 'money'] as const) {
        const { active, completed } = await tournamentsService.getMyTournaments(
          userId,
          mode,
        );
        for (const item of active) {
          if (!item.resultLabel || !item.roundForQuestions) {
            pushIssue(deterministicIssues, 'active_missing_machine_fields', {
              userId,
              mode,
              tournamentId: item.id,
              resultLabel: item.resultLabel ?? null,
              roundForQuestions: item.roundForQuestions ?? null,
            });
          }
          if (item.listBucket !== 'active') {
            pushIssue(deterministicIssues, 'active_bucket_mismatch', {
              userId,
              mode,
              tournamentId: item.id,
              listBucket: item.listBucket,
            });
          }
          if (item.questionsTotal < 0 || item.questionsAnswered < 0) {
            pushIssue(deterministicIssues, 'active_negative_question_stats', {
              userId,
              mode,
              tournamentId: item.id,
              questionsTotal: item.questionsTotal,
              questionsAnswered: item.questionsAnswered,
            });
          }
        }
        for (const item of completed) {
          if (!item.resultLabel || !item.roundForQuestions) {
            pushIssue(deterministicIssues, 'completed_missing_machine_fields', {
              userId,
              mode,
              tournamentId: item.id,
              resultLabel: item.resultLabel ?? null,
              roundForQuestions: item.roundForQuestions ?? null,
            });
          }
          if (item.listBucket !== 'completed') {
            pushIssue(deterministicIssues, 'completed_bucket_mismatch', {
              userId,
              mode,
              tournamentId: item.id,
              listBucket: item.listBucket,
            });
          }
          if (item.canContinue) {
            pushIssue(deterministicIssues, 'completed_can_continue', {
              userId,
              mode,
              tournamentId: item.id,
            });
          }
        }
      }
    }

    const summary = {
      generatedAt: new Date().toISOString(),
      usersAudited: auditedUsers.length,
      issueCounts: Object.fromEntries(
        Object.entries(deterministicIssues).map(([kind, items]) => [kind, items.length]),
      ),
      totalIssueCount: Object.values(deterministicIssues).reduce(
        (sum, items) => sum + items.length,
        0,
      ),
    };

    console.log(
      JSON.stringify(
        {
          summary,
          deterministicIssues,
        },
        null,
        2,
      ),
    );

    if (summary.totalIssueCount > 0) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
