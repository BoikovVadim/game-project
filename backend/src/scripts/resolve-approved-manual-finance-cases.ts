import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { UsersService } from '../users/users.service';

const USER1_CREATED_AT_TARGET = '2026-03-05T18:31:11.000Z';
const USER1_OPENING_L_DESCRIPTION =
  'Manual recovery: legacy opening balance before tx #2';
const USER1_RACE_DRIFT_DESCRIPTION =
  'Manual recovery: reconcile 5 L drift before tx #25';
const USER2_TX232_DESCRIPTION =
  'Legacy ruble topup, manual review approved';

type ExistingTxRow = {
  id: number;
  userId: number;
  amount: number | string;
  category: string;
  description: string | null;
  createdAt: string | Date;
};

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  try {
    const dataSource = app.get(DataSource);
    const usersService = app.get(UsersService);

    const existingRecoveryRows = (await dataSource.query(
      `SELECT id, "userId", amount, category, description, "createdAt"
       FROM "transaction"
       WHERE ("userId" = 1 AND description IN ($1, $2))
          OR id = 232
       ORDER BY id ASC`,
      [
        USER1_OPENING_L_DESCRIPTION,
        USER1_RACE_DRIFT_DESCRIPTION,
      ],
    )) as ExistingTxRow[];

    const openingTxExists = existingRecoveryRows.some(
      (row) =>
        Number(row.userId) === 1 &&
        row.category === 'other' &&
        Number(row.amount) === 100 &&
        String(row.description ?? '') === USER1_OPENING_L_DESCRIPTION,
    );
    const raceTxExists = existingRecoveryRows.some(
      (row) =>
        Number(row.userId) === 1 &&
        row.category === 'other' &&
        Number(row.amount) === 5 &&
        String(row.description ?? '') === USER1_RACE_DRIFT_DESCRIPTION,
    );

    const tx232Before = (await dataSource.query(
      `SELECT id, "userId", amount, category, description, "tournamentId", "createdAt"
       FROM "transaction"
       WHERE id = 232`,
    )) as Array<{
      id: number;
      userId: number;
      amount: number | string;
      category: string;
      description: string | null;
      tournamentId: number | null;
      createdAt: string | Date;
    }>;

    const user1Before = (await dataSource.query(
      `SELECT id, username, "createdAt", balance, "balanceRubles"
       FROM "user"
       WHERE id = 1`,
    )) as Array<{
      id: number;
      username: string;
      createdAt: string | Date;
      balance: number | string;
      balanceRubles: number | string;
    }>;

    await dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE "user"
         SET "createdAt" = $1
         WHERE id = 1
           AND "createdAt" > $1`,
        [USER1_CREATED_AT_TARGET],
      );

      if (!openingTxExists) {
        await manager.query(
          `INSERT INTO "transaction"
             ("userId", amount, description, "tournamentId", category, "createdAt")
           VALUES ($1, $2, $3, NULL, 'other', $4)`,
          [1, 100, USER1_OPENING_L_DESCRIPTION, '2026-03-07T05:28:58.000Z'],
        );
      }

      if (!raceTxExists) {
        await manager.query(
          `INSERT INTO "transaction"
             ("userId", amount, description, "tournamentId", category, "createdAt")
           VALUES ($1, $2, $3, NULL, 'other', $4)`,
          [1, 5, USER1_RACE_DRIFT_DESCRIPTION, '2026-03-09T09:59:38.000Z'],
        );
      }

      await manager.query(
        `UPDATE "transaction"
         SET description = $1,
             "tournamentId" = NULL
         WHERE id = 232
           AND "userId" = 2`,
        [USER2_TX232_DESCRIPTION],
      );
    });

    const reconcileResult = await usersService.reconcileAllStoredBalances([1, 2]);

    const userAfter = await dataSource.query(
      `SELECT id, username, "createdAt", balance, "balanceRubles"
       FROM "user"
       WHERE id IN (1, 2)
       ORDER BY id ASC`,
    );
    const recoveryAfter = await dataSource.query(
      `SELECT id, "userId", amount, category, description, "tournamentId", "createdAt"
       FROM "transaction"
       WHERE ("userId" = 1 AND description IN ($1, $2))
          OR id = 232
       ORDER BY id ASC`,
      [
        USER1_OPENING_L_DESCRIPTION,
        USER1_RACE_DRIFT_DESCRIPTION,
      ],
    );

    console.log(
      '[resolve-approved-manual-finance-cases] user1 before:',
      JSON.stringify(user1Before, null, 2),
    );
    console.log(
      '[resolve-approved-manual-finance-cases] tx232 before:',
      JSON.stringify(tx232Before, null, 2),
    );
    console.log(
      '[resolve-approved-manual-finance-cases] reconciled users:',
      reconcileResult.affectedUserIds.join(', ') || 'none',
    );
    console.log(
      '[resolve-approved-manual-finance-cases] relevant transactions after:',
      JSON.stringify(recoveryAfter, null, 2),
    );
    console.log(
      '[resolve-approved-manual-finance-cases] users after:',
      JSON.stringify(userAfter, null, 2),
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error('[resolve-approved-manual-finance-cases] failed:', error);
  process.exit(1);
});
