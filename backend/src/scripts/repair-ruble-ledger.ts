import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { UsersService } from '../users/users.service';

type CountRow = { count: number | string };

async function getMissingSucceededPaymentCount(dataSource: DataSource): Promise<number> {
  const rows = await dataSource.query(
    `SELECT COUNT(*)::int AS count
     FROM payment p
     WHERE p.status = 'succeeded'
       AND NOT EXISTS (
         SELECT 1
         FROM "transaction" t
         WHERE t."userId" = p."userId"
           AND t.category = 'topup'
           AND (
             t.description = $1
             OR t.description = $2
             OR t.description LIKE 'Пополнение через платёжного провайдера (%'
           )
           AND ABS(CAST(t.amount AS numeric) - CAST(p.amount AS numeric)) < 0.01
           AND t."createdAt" >= p."createdAt" - interval '1 day'
           AND t."createdAt" <= p."createdAt" + interval '1 day'
       )`,
    ['Пополнение через ЮKassa', 'Пополнение через Robokassa'],
  ) as CountRow[];
  return Number(rows[0]?.count ?? 0);
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  try {
    const dataSource = app.get(DataSource);
    const usersService = app.get(UsersService);

    const adminCreditBefore = await dataSource.query(
      `SELECT id, "userId", amount, category, description, "tournamentId"
       FROM "transaction"
       WHERE category = 'admin_credit'
       ORDER BY id ASC`,
    );
    const missingPaymentsBefore = await getMissingSucceededPaymentCount(dataSource);

    console.log('[repair-ruble-ledger] admin_credit rows before:', adminCreditBefore.length);
    console.log('[repair-ruble-ledger] succeeded payments without topup tx before:', missingPaymentsBefore);
    if (adminCreditBefore.length > 0) {
      console.log(JSON.stringify(adminCreditBefore, null, 2));
    }

    const adminCreditResult = await usersService.normalizeLegacyAdminCreditTransactions();
    const paymentRepairResult = await usersService.repairPaymentTopupTransactions();

    const adminCreditAfter = await dataSource.query(
      `SELECT id, "userId", amount, category, description, "tournamentId"
       FROM "transaction"
       WHERE category = 'admin_credit'
       ORDER BY id ASC`,
    );
    const missingPaymentsAfter = await getMissingSucceededPaymentCount(dataSource);

    console.log('[repair-ruble-ledger] updated admin_credit rows:', adminCreditResult.updatedCount);
    console.log('[repair-ruble-ledger] inserted payment topups:', paymentRepairResult.insertedCount);
    console.log('[repair-ruble-ledger] normalized payment topups:', paymentRepairResult.normalizedCount);
    console.log('[repair-ruble-ledger] affected users:', [
      ...new Set([
        ...adminCreditResult.affectedUserIds,
        ...paymentRepairResult.affectedUserIds,
      ]),
    ].join(', ') || 'none');
    console.log('[repair-ruble-ledger] admin_credit rows after:', adminCreditAfter.length);
    console.log('[repair-ruble-ledger] succeeded payments without topup tx after:', missingPaymentsAfter);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error('[repair-ruble-ledger] failed:', error);
  process.exit(1);
});
