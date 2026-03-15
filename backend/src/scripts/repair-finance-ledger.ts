import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { UsersService } from '../users/users.service';
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

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const dataSource = app.get(DataSource);
    const usersService = app.get(UsersService);

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

    const refundedEscrowsWithoutTx = (await dataSource.query(
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
    )) as RefundedEscrowRow[];

    const missingWins = (await dataSource.query(
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
    )) as MissingWinRow[];

    const affectedUserIds = new Set<number>([
      ...adminCreditResult.affectedUserIds,
      ...paymentRepairResult.affectedUserIds,
    ]);
    const insertedWithdrawalTxIds: number[] = [];
    const normalizedWithdrawalTxIds: number[] = [];
    const insertedRefundTxRefs: Array<{ userId: number; tournamentId: number }> = [];
    const insertedWinTxRefs: Array<{ userId: number; tournamentId: number }> = [];

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
