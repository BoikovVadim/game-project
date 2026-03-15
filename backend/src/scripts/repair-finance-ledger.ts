import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { UsersService } from '../users/users.service';
import { TournamentsService } from '../tournaments/tournaments.service';
import { getLeagueName, getLeaguePrize } from '../tournaments/domain/constants';
import { parseAnyWithdrawalDescription } from '../users/ruble-ledger-descriptions';

type ApprovedWithdrawalRow = {
  id: number;
  userId: number;
  amount: number | string;
};

type WithdrawTxRow = {
  id: number;
  userId: number;
  description: string | null;
};

type RefundedEscrowRow = {
  id: number;
  userId: number;
  tournamentId: number;
  amount: number | string;
  leagueAmount: number | null;
};

type MissingWinRow = {
  tournamentId: number;
  userId: number;
  leagueAmount: number;
};

type FinishedTournamentSettlementRow = {
  tournamentId: number;
  settlementType: 'paid_to_winner' | 'refunded';
};

type FinishedMoneyTournamentRow = {
  id: number;
};

type WaitingSinglePlayerArtifactRow = {
  tournamentId: number;
};

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const dataSource = app.get(DataSource);
    const usersService = app.get(UsersService);
    const tournamentsService = app.get(TournamentsService);

    await usersService.normalizeRefundDescriptions();
    const adminCreditResult =
      await usersService.normalizeLegacyAdminCreditTransactions();
    const paymentRepairResult = await usersService.repairPaymentTopupTransactions();

    const approvedWithdrawals = (await dataSource.query(
      `SELECT id, "userId", amount
       FROM withdrawal_request
       WHERE status = 'approved'
       ORDER BY id ASC`,
    )) as ApprovedWithdrawalRow[];
    const withdrawTxRows = (await dataSource.query(
      `SELECT id, "userId", description
       FROM "transaction"
       WHERE category = 'withdraw'
       ORDER BY id ASC`,
    )) as WithdrawTxRow[];
    const withdrawTxByRequestId = new Map<number, WithdrawTxRow[]>();
    for (const row of withdrawTxRows) {
      const requestId = parseAnyWithdrawalDescription(row.description).requestId;
      if (requestId == null) continue;
      const list = withdrawTxByRequestId.get(requestId) ?? [];
      list.push(row);
      withdrawTxByRequestId.set(requestId, list);
    }
    const missingApprovedWithdrawals = approvedWithdrawals.filter(
      (row) => (withdrawTxByRequestId.get(Number(row.id)) ?? []).length === 0,
    );
    const legacyWithdrawalTxToNormalize = approvedWithdrawals.flatMap((row) => {
      const requestId = Number(row.id);
      const expectedDescription =
        UsersService.buildApprovedWithdrawalDescription(requestId);
      return (withdrawTxByRequestId.get(requestId) ?? [])
        .filter(
          (tx) => String(tx.description ?? '').trim() !== expectedDescription,
        )
        .map((tx) => ({
          requestId,
          transactionId: Number(tx.id),
          expectedDescription,
        }));
    });

    const finishedMoneyTournaments = (await dataSource.query(
      `SELECT id
       FROM tournament
       WHERE status = 'finished'
         AND "gameType" = 'money'
       ORDER BY id ASC`,
    )) as FinishedMoneyTournamentRow[];
    const settlementByTournamentId = new Map<
      number,
      Awaited<ReturnType<TournamentsService['getMoneyTournamentSettlementResolution']>>
    >();
    for (const tournament of finishedMoneyTournaments) {
      settlementByTournamentId.set(
        Number(tournament.id),
        await tournamentsService.getMoneyTournamentSettlementResolution(
          Number(tournament.id),
        ),
      );
    }

    const refundedEscrowsWithoutTx = ((await dataSource.query(
      `SELECT e.id, e."userId", e."tournamentId", e.amount, t."leagueAmount"
       FROM tournament_escrow e
       INNER JOIN tournament t ON t.id = e."tournamentId"
       LEFT JOIN "transaction" tx
         ON tx."userId" = e."userId"
        AND tx."tournamentId" = e."tournamentId"
        AND tx.category = 'refund'
       WHERE e.status = 'refunded'
         AND tx.id IS NULL
       ORDER BY e.id ASC`,
    )) as RefundedEscrowRow[]).filter(
      (row) =>
        settlementByTournamentId.get(Number(row.tournamentId))?.settlementType ===
        'refunded',
    );

    const missingWins = ((await dataSource.query(
      `SELECT r."tournamentId" AS "tournamentId",
              r."userId" AS "userId",
              t."leagueAmount" AS "leagueAmount"
       FROM tournament_result r
       INNER JOIN tournament t ON t.id = r."tournamentId"
       WHERE t.status = 'finished'
         AND t."gameType" = 'money'
         AND t."leagueAmount" IS NOT NULL
         AND r.passed = 1
         AND NOT EXISTS (
           SELECT 1
           FROM "transaction" tx
           WHERE tx."userId" = r."userId"
             AND tx."tournamentId" = r."tournamentId"
             AND tx.category = 'win'
         )
         AND 1 = (
           SELECT COUNT(*)
           FROM tournament_result r2
           WHERE r2."tournamentId" = r."tournamentId" AND r2.passed = 1
         )
       ORDER BY r."tournamentId" ASC`,
    )) as MissingWinRow[]).filter((row) => {
      const settlement = settlementByTournamentId.get(Number(row.tournamentId));
      return (
        settlement?.settlementType === 'paid_to_winner' &&
        Number(settlement.winnerId) === Number(row.userId)
      );
    });

    const unresolvedFinishedTournaments = finishedMoneyTournaments
      .map((row) => Number(row.id))
      .filter(
        (tournamentId) =>
          settlementByTournamentId.get(tournamentId)?.settlementType ===
          'unresolved',
      );
    const waitingSinglePlayerArtifactTournaments = (
      await dataSource.query(
        `SELECT t.id AS "tournamentId"
         FROM tournament t
         LEFT JOIN tournament_escrow e ON e."tournamentId" = t.id
         LEFT JOIN "transaction" tx
           ON tx."tournamentId" = t.id
          AND tx.category IN ('refund', 'win')
         LEFT JOIN tournament_result r ON r."tournamentId" = t.id
         WHERE t.status = 'waiting'
           AND t."gameType" = 'money'
           AND json_array_length(t."playerOrder"::json) = 1
         GROUP BY t.id
         HAVING COUNT(*) FILTER (WHERE e.status IN ('refunded', 'paid_to_winner')) > 0
             OR COUNT(*) FILTER (WHERE tx.id IS NOT NULL) > 0
             OR COUNT(*) FILTER (WHERE r.id IS NOT NULL) > 0
         ORDER BY t.id ASC`,
      )
    ) as WaitingSinglePlayerArtifactRow[];

    const affectedUserIds = new Set<number>([
      ...adminCreditResult.affectedUserIds,
      ...paymentRepairResult.affectedUserIds,
    ]);
    const insertedWithdrawalTxIds: number[] = [];
    const normalizedWithdrawalTxIds: number[] = [];
    const insertedRefundTxRefs: Array<{ userId: number; tournamentId: number }> = [];
    const insertedWinTxRefs: Array<{ userId: number; tournamentId: number }> = [];
    const reopenedTournamentIds: number[] = [];
    const restoredEscrowTournamentIds: number[] = [];
    const deletedSettlementTxIds: number[] = [];
    const deletedWinnerResultIds: number[] = [];
    const restoredWaitingTournamentIds: number[] = [];
    const deletedWaitingResultIds: number[] = [];

    await dataSource.transaction(async (manager) => {
      for (const tx of legacyWithdrawalTxToNormalize) {
        await manager.query(
          `UPDATE "transaction"
           SET description = $1
           WHERE id = $2`,
          [tx.expectedDescription, tx.transactionId],
        );
        normalizedWithdrawalTxIds.push(tx.transactionId);
      }

      for (const request of missingApprovedWithdrawals) {
        const tx = await usersService.addTransactionWithManager(
          manager,
          Number(request.userId),
          -Number(request.amount),
          UsersService.buildApprovedWithdrawalDescription(Number(request.id)),
          'withdraw',
        );
        insertedWithdrawalTxIds.push(Number(tx.id));
        affectedUserIds.add(Number(request.userId));
      }

      for (const escrow of refundedEscrowsWithoutTx) {
        await usersService.addTransactionWithManager(
          manager,
          Number(escrow.userId),
          Number(escrow.amount),
          `${getLeagueName(escrow.leagueAmount)}, ID ${Number(escrow.tournamentId)}`,
          'refund',
          Number(escrow.tournamentId),
        );
        insertedRefundTxRefs.push({
          userId: Number(escrow.userId),
          tournamentId: Number(escrow.tournamentId),
        });
        affectedUserIds.add(Number(escrow.userId));
      }

      for (const winner of missingWins) {
        const leagueAmount = Number(winner.leagueAmount);
        if (!leagueAmount || leagueAmount <= 0) continue;
        await usersService.addTransactionWithManager(
          manager,
          Number(winner.userId),
          getLeaguePrize(leagueAmount),
          `Выигрыш за турнир, ${getLeagueName(leagueAmount)}, ID ${Number(winner.tournamentId)}`,
          'win',
          Number(winner.tournamentId),
        );
        insertedWinTxRefs.push({
          userId: Number(winner.userId),
          tournamentId: Number(winner.tournamentId),
        });
        affectedUserIds.add(Number(winner.userId));
      }

      for (const tournamentId of unresolvedFinishedTournaments) {
        const deletedTxRows = (await manager.query(
          `DELETE FROM "transaction"
           WHERE "tournamentId" = $1
             AND category IN ('refund', 'win')
           RETURNING id, "userId"`,
          [tournamentId],
        )) as Array<{ id: number; userId: number }>;
        for (const row of deletedTxRows) {
          deletedSettlementTxIds.push(Number(row.id));
          affectedUserIds.add(Number(row.userId));
        }

        const restoredEscrows = (await manager.query(
          `UPDATE tournament_escrow
           SET status = 'held'
           WHERE "tournamentId" = $1
             AND status IN ('refunded', 'paid_to_winner', 'processing')
           RETURNING id`,
          [tournamentId],
        )) as Array<{ id: number }>;
        if (restoredEscrows.length > 0) {
          restoredEscrowTournamentIds.push(tournamentId);
        }

        const deletedWinnerRows = (await manager.query(
          `DELETE FROM tournament_result
           WHERE "tournamentId" = $1
             AND passed = 1
           RETURNING id`,
          [tournamentId],
        )) as Array<{ id: number }>;
        for (const row of deletedWinnerRows) {
          deletedWinnerResultIds.push(Number(row.id));
        }

        const reopened = (await manager.query(
          `UPDATE tournament
           SET status = 'active'
           WHERE id = $1
             AND status = 'finished'
           RETURNING id`,
          [tournamentId],
        )) as Array<{ id: number }>;
        if (reopened.length > 0) {
          reopenedTournamentIds.push(tournamentId);
        }
      }

      for (const row of waitingSinglePlayerArtifactTournaments) {
        const tournamentId = Number(row.tournamentId);
        const deletedTxRows = (await manager.query(
          `DELETE FROM "transaction"
           WHERE "tournamentId" = $1
             AND category IN ('refund', 'win')
           RETURNING id, "userId"`,
          [tournamentId],
        )) as Array<{ id: number; userId: number }>;
        for (const deletedTx of deletedTxRows) {
          deletedSettlementTxIds.push(Number(deletedTx.id));
          affectedUserIds.add(Number(deletedTx.userId));
        }

        const restoredEscrows = (await manager.query(
          `UPDATE tournament_escrow
           SET status = 'held'
           WHERE "tournamentId" = $1
             AND status IN ('refunded', 'paid_to_winner', 'processing')
           RETURNING "userId"`,
          [tournamentId],
        )) as Array<{ userId: number }>;
        if (restoredEscrows.length > 0) {
          restoredWaitingTournamentIds.push(tournamentId);
          for (const escrow of restoredEscrows) {
            affectedUserIds.add(Number(escrow.userId));
          }
        }

        const deletedResultRows = (await manager.query(
          `DELETE FROM tournament_result
           WHERE "tournamentId" = $1
           RETURNING id`,
          [tournamentId],
        )) as Array<{ id: number }>;
        for (const deletedRow of deletedResultRows) {
          deletedWaitingResultIds.push(Number(deletedRow.id));
        }
      }
    });

    const settlementRows = (await dataSource.query(
      `SELECT t.id AS "tournamentId",
              CASE
                WHEN EXISTS (
                  SELECT 1
                  FROM tournament_result r
                  WHERE r."tournamentId" = t.id AND r.passed = 1
                  GROUP BY r."tournamentId"
                  HAVING COUNT(*) = 1
                ) AND EXISTS (
                  SELECT 1
                  FROM "transaction" tx
                  WHERE tx."tournamentId" = t.id AND tx.category = 'win'
                ) THEN 'paid_to_winner'
                WHEN NOT EXISTS (
                  SELECT 1 FROM tournament_result r WHERE r."tournamentId" = t.id AND r.passed = 1
                ) AND NOT EXISTS (
                  SELECT 1
                  FROM tournament_escrow e
                  WHERE e."tournamentId" = t.id
                    AND NOT EXISTS (
                      SELECT 1
                      FROM "transaction" tx
                      WHERE tx."userId" = e."userId"
                        AND tx."tournamentId" = e."tournamentId"
                        AND tx.category = 'refund'
                    )
                ) THEN 'refunded'
                ELSE NULL
              END AS "settlementType"
       FROM tournament t
       WHERE t.status = 'finished'
         AND t."gameType" = 'money'
         AND EXISTS (
           SELECT 1
           FROM tournament_escrow e
           WHERE e."tournamentId" = t.id
             AND e.status IN ('held', 'processing')
         )
       ORDER BY t.id ASC`,
    )) as Array<FinishedTournamentSettlementRow & { settlementType: string | null }>;

    let settledEscrowRows = 0;
    await dataSource.transaction(async (manager) => {
      for (const row of settlementRows) {
        if (
          row.settlementType !== 'paid_to_winner' &&
          row.settlementType !== 'refunded'
        ) {
          continue;
        }
        const result = (await manager.query(
          `UPDATE tournament_escrow
           SET status = $1
           WHERE "tournamentId" = $2
             AND status IN ('held', 'processing')
           RETURNING id`,
          [row.settlementType, Number(row.tournamentId)],
        )) as unknown[];
        settledEscrowRows += Array.isArray(result) ? result.length : 0;
      }
    });

    const reconcileResult = await usersService.reconcileAllStoredBalances();

    console.log(
      '[repair-finance-ledger] normalized refund descriptions: completed',
    );
    console.log(
      '[repair-finance-ledger] normalized admin_credit rows:',
      adminCreditResult.updatedCount,
    );
    console.log(
      '[repair-finance-ledger] repaired payment topups:',
      paymentRepairResult.insertedCount,
    );
    console.log(
      '[repair-finance-ledger] normalized payment topup descriptions:',
      paymentRepairResult.normalizedCount,
    );
    console.log(
      '[repair-finance-ledger] normalized legacy withdrawal tx:',
      normalizedWithdrawalTxIds.length,
    );
    console.log(
      '[repair-finance-ledger] inserted approved withdrawal tx:',
      insertedWithdrawalTxIds.length,
    );
    console.log(
      '[repair-finance-ledger] inserted refunded escrow tx:',
      insertedRefundTxRefs.length,
    );
    console.log(
      '[repair-finance-ledger] inserted missing win tx:',
      insertedWinTxRefs.length,
    );
    console.log(
      '[repair-finance-ledger] reopened unresolved tournaments:',
      reopenedTournamentIds.length,
    );
    console.log(
      '[repair-finance-ledger] restored escrow rows for unresolved tournaments:',
      restoredEscrowTournamentIds.length,
    );
    console.log(
      '[repair-finance-ledger] deleted erroneous settlement tx:',
      deletedSettlementTxIds.length,
    );
    console.log(
      '[repair-finance-ledger] deleted premature winner rows:',
      deletedWinnerResultIds.length,
    );
    console.log(
      '[repair-finance-ledger] restored waiting single-player tournaments:',
      restoredWaitingTournamentIds.length,
    );
    console.log(
      '[repair-finance-ledger] deleted waiting tournament result rows:',
      deletedWaitingResultIds.length,
    );
    console.log(
      '[repair-finance-ledger] updated finished escrow rows:',
      settledEscrowRows,
    );
    console.log(
      '[repair-finance-ledger] reconciled stored balances:',
      reconcileResult.updatedCount,
    );
    console.log(
      '[repair-finance-ledger] affected users:',
      Array.from(
        new Set([
          ...Array.from(affectedUserIds),
          ...reconcileResult.affectedUserIds,
        ]),
      )
        .filter((value) => Number.isFinite(value) && value > 0)
        .sort((a, b) => a - b)
        .join(', ') || 'none',
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error('[repair-finance-ledger] failed:', error);
  process.exit(1);
});
