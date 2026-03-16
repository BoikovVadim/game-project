import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { DataSource, In } from 'typeorm';
import { AppModule } from '../app.module';
import { TournamentsService } from '../tournaments/tournaments.service';
import { Tournament } from '../tournaments/tournament.entity';
import { TournamentProgress } from '../tournaments/tournament-progress.entity';
import { Question } from '../tournaments/question.entity';
import {
  computeCorrectCountsFromQuestions,
  hasReliableChosenAnswers,
  normalizeChosenAnswers,
} from '../tournaments/domain/progress-correct-counts';

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

    const finishedUnderfilled = (await dataSource.query(
      `SELECT t.id AS "tournamentId",
              t.status AS status,
              t."gameType" AS "gameType",
              t."leagueAmount" AS "leagueAmount",
              COALESCE(json_array_length(COALESCE(t."playerOrder"::json, '[]'::json)), 0) AS "playerOrderCount",
              COUNT(DISTINCT p.id) AS "progressCount",
              COUNT(DISTINCT r.id) AS "resultCount"
       FROM tournament t
       LEFT JOIN tournament_progress p ON p."tournamentId" = t.id
       LEFT JOIN tournament_result r ON r."tournamentId" = t.id
       WHERE t.status = 'finished'
       GROUP BY t.id, t.status, t."gameType", t."leagueAmount", t."playerOrder"
       HAVING COALESCE(json_array_length(COALESCE(t."playerOrder"::json, '[]'::json)), 0) < 4
       ORDER BY t.id ASC`,
    )) as Array<{
      tournamentId: number;
      status: string;
      gameType: string | null;
      leagueAmount: number | null;
      playerOrderCount: number;
      progressCount: number;
      resultCount: number;
    }>;
    for (const row of finishedUnderfilled) {
      pushIssue(deterministicIssues, 'finished_underfilled_tournaments', row);
    }

    const missingPlayersJoinRows = (await dataSource.query(
      `SELECT src."tournamentId", src."userId"
       FROM (
         SELECT te."tournamentId", te."userId"
         FROM tournament_entry te
         UNION
         SELECT p."tournamentId", p."userId"
         FROM tournament_progress p
         UNION
         SELECT t.id AS "tournamentId", (ord.value)::int AS "userId"
         FROM tournament t
         CROSS JOIN LATERAL json_array_elements_text(
           CASE
             WHEN t."playerOrder" IS NULL OR t."playerOrder" IN ('', 'null') THEN '[]'::json
             ELSE t."playerOrder"::json
           END
         ) AS ord(value)
         WHERE (ord.value)::int > 0
       ) src
       LEFT JOIN tournament_players_user tpu
         ON tpu."tournamentId" = src."tournamentId"
        AND tpu."userId" = src."userId"
       WHERE tpu."userId" IS NULL
       ORDER BY src."tournamentId" ASC, src."userId" ASC`,
    )) as Array<{
      tournamentId: number;
      userId: number;
    }>;
    for (const row of missingPlayersJoinRows) {
      pushIssue(deterministicIssues, 'missing_players_join_rows', row);
    }

    const missingEntryRows = (await dataSource.query(
      `SELECT t.id AS "tournamentId", (ord.value)::int AS "userId"
       FROM tournament t
       CROSS JOIN LATERAL json_array_elements_text(
         CASE
           WHEN t."playerOrder" IS NULL OR t."playerOrder" IN ('', 'null') THEN '[]'::json
           ELSE t."playerOrder"::json
         END
       ) AS ord(value)
       LEFT JOIN tournament_entry te
         ON te."tournamentId" = t.id
        AND te."userId" = (ord.value)::int
       WHERE (ord.value)::int > 0
         AND te.id IS NULL
       ORDER BY t.id ASC, (ord.value)::int ASC`,
    )) as Array<{
      tournamentId: number;
      userId: number;
    }>;
    for (const row of missingEntryRows) {
      pushIssue(deterministicIssues, 'missing_entry_rows_for_player_order', row);
    }

    const moneyTournamentRows = (await dataSource.query(
      `SELECT t.id AS "tournamentId",
              t.status AS status,
              t."leagueAmount" AS "leagueAmount",
              COUNT(DISTINCT e.id) AS "escrowCount",
              COUNT(DISTINCT e.id) FILTER (WHERE e.status IN ('held', 'processing')) AS "pendingEscrowCount",
              COUNT(DISTINCT e.id) FILTER (WHERE e.status IN ('paid_to_winner', 'forfeited')) AS "settledEscrowCount"
       FROM tournament t
       LEFT JOIN tournament_escrow e ON e."tournamentId" = t.id
       WHERE t."gameType" = 'money' OR t."leagueAmount" IS NOT NULL
       GROUP BY t.id, t.status
       ORDER BY t.id ASC`,
    )) as Array<{
      tournamentId: number;
      status: string;
      leagueAmount: number | null;
      escrowCount: number;
      pendingEscrowCount: number;
      settledEscrowCount: number;
    }>;
    for (const row of moneyTournamentRows) {
      const pendingEscrowCount = Number(row.pendingEscrowCount ?? 0);
      const settledEscrowCount = Number(row.settledEscrowCount ?? 0);
      const settlement =
        await tournamentsService.getMoneyTournamentSettlementResolution(
          row.tournamentId,
        );
      if (row.leagueAmount == null) {
        pushIssue(deterministicIssues, 'money_missing_league_amount', {
          ...row,
          pendingEscrowCount,
          settledEscrowCount,
          settlementType: settlement.settlementType,
          winnerId: settlement.winnerId,
        });
      }
      if (
        row.status === 'finished' &&
        settlement.settlementType !== 'unresolved' &&
        pendingEscrowCount > 0
      ) {
        pushIssue(deterministicIssues, 'money_finished_unsettled_escrow', {
          ...row,
          pendingEscrowCount,
          settledEscrowCount,
          settlementType: settlement.settlementType,
          winnerId: settlement.winnerId,
        });
      }
      if (row.status !== 'finished' && settledEscrowCount > 0) {
        pushIssue(deterministicIssues, 'money_unfinished_settled_escrow', {
          ...row,
          pendingEscrowCount,
          settledEscrowCount,
          settlementType: settlement.settlementType,
          winnerId: settlement.winnerId,
        });
      }
      if (
        settlement.settlementType === 'unresolved' &&
        settledEscrowCount > 0
      ) {
        pushIssue(deterministicIssues, 'money_unresolved_settlement_artifacts', {
          ...row,
          pendingEscrowCount,
          settledEscrowCount,
          settlementType: settlement.settlementType,
          winnerId: settlement.winnerId,
        });
      }
    }

    const progressRepo = dataSource.getRepository(TournamentProgress);
    const tournamentRepo = dataSource.getRepository(Tournament);
    const questionRepo = dataSource.getRepository(Question);
    const allProgress = await progressRepo.find();
    const progressTournamentIds = [
      ...new Set(allProgress.map((progress) => progress.tournamentId)),
    ];
    if (progressTournamentIds.length > 0) {
      const tournaments = await tournamentRepo.find({
        where: { id: In(progressTournamentIds) },
        relations: ['players'],
      });
      const questions = await questionRepo.find({
        where: { tournament: { id: In(progressTournamentIds) } },
        order: { roundIndex: 'ASC', id: 'ASC' },
      });
      const tournamentById = new Map(
        tournaments.map((tournament) => [tournament.id, tournament]),
      );
      const questionsByTournamentId = new Map<number, Question[]>();
      for (const question of questions) {
        const tournamentId = question.tournament?.id;
        if (!tournamentId) continue;
        const bucket = questionsByTournamentId.get(tournamentId) ?? [];
        bucket.push(question);
        questionsByTournamentId.set(tournamentId, bucket);
      }

      for (const progress of allProgress) {
        const answersChosen = normalizeChosenAnswers(progress.answersChosen);
        if (answersChosen.length === 0) continue;
        if (!hasReliableChosenAnswers(answersChosen)) continue;

        const tournament = tournamentById.get(progress.tournamentId);
        const tournamentQuestions =
          questionsByTournamentId.get(progress.tournamentId) ?? [];
        if (!tournament || tournamentQuestions.length === 0) continue;

        const effectivePlayerOrder =
          Array.isArray(tournament.playerOrder) && tournament.playerOrder.length > 0
            ? tournament.playerOrder
            : (tournament.players?.map((player) => player.id) ?? []);
        const playerSlot = effectivePlayerOrder.indexOf(progress.userId);
        const semiRoundIndex = playerSlot >= 0 && playerSlot < 2 ? 0 : 1;
        const recomputed = computeCorrectCountsFromQuestions({
          answersChosen,
          semiRoundIndex,
          questionsAnsweredCount:
            progress.questionsAnsweredCount ?? answersChosen.length,
          semiTiebreakerRoundCount:
            progress.tiebreakerRoundsCorrect?.length ?? 0,
          finalTiebreakerRoundCount:
            progress.finalTiebreakerRoundsCorrect?.length ?? 0,
          questions: tournamentQuestions.map((question) => ({
            roundIndex: question.roundIndex,
            correctAnswer: question.correctAnswer,
          })),
        });

        const shouldCheckSemi =
          Math.max(answersChosen.length, progress.questionsAnsweredCount ?? 0) >= 10;
        if (
          progress.correctAnswersCount !== recomputed.total ||
          (shouldCheckSemi && progress.semiFinalCorrectCount !== recomputed.semi)
        ) {
          pushIssue(deterministicIssues, 'stored_correct_count_mismatch', {
            tournamentId: progress.tournamentId,
            userId: progress.userId,
            storedCorrectAnswersCount: progress.correctAnswersCount,
            recomputedCorrectAnswersCount: recomputed.total,
            storedSemiFinalCorrectCount: progress.semiFinalCorrectCount,
            recomputedSemiFinalCorrectCount: shouldCheckSemi
              ? recomputed.semi
              : null,
            answersChosenLength: answersChosen.length,
          });
        }
      }
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
