import { DataSource } from 'typeorm';
import { buildAdminTopupDescription } from '../users/ruble-ledger-descriptions';

type LegacyManualTopupFix = {
  transactionId: number;
  adminId: number;
  targetCategory: 'topup' | 'other';
  comment?: string | null;
  reason: string;
};

const FIXES: LegacyManualTopupFix[] = [
  {
    transactionId: 1,
    adminId: 1,
    targetCategory: 'other',
    reason: 'user-verified: all legacy credits for current user 1 were issued by admin 1',
  },
  {
    transactionId: 13,
    adminId: 1,
    targetCategory: 'topup',
    comment: 'скрипт',
    reason: 'user-verified: script topup for current user 1 was issued by admin 1',
  },
  {
    transactionId: 21,
    adminId: 1,
    targetCategory: 'topup',
    reason: 'user-verified: all legacy credits for current user 1 were issued by admin 1',
  },
  {
    transactionId: 23,
    adminId: 1,
    targetCategory: 'topup',
    reason: 'user-verified: all legacy credits for current user 1 were issued by admin 1',
  },
  {
    transactionId: 37,
    adminId: 1,
    targetCategory: 'topup',
    reason: 'user-verified: all legacy credits for current user 1 were issued by admin 1',
  },
  {
    transactionId: 48,
    adminId: 3,
    targetCategory: 'topup',
    reason:
      'legacy admin-panel topup recovered from production audit and user-provided attribution for user 3',
  },
  {
    transactionId: 72,
    adminId: 3,
    targetCategory: 'topup',
    reason:
      'legacy admin-panel topup recovered from production audit and user-provided attribution for user 5',
  },
  {
    transactionId: 74,
    adminId: 3,
    targetCategory: 'topup',
    reason:
      'legacy admin-panel topup recovered from production audit and user-provided attribution for user 6',
  },
];

async function main() {
  const ds = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USER || 'legend',
    password: process.env.DB_PASS || 'legend',
    database: process.env.DB_NAME || 'legendgames',
    synchronize: false,
  });

  await ds.initialize();

  try {
    const ids = FIXES.map((item) => item.transactionId);
    const before = (await ds.query(
      `SELECT id, "userId", amount, category, description, "tournamentId", "createdAt"
       FROM "transaction"
       WHERE id = ANY($1::int[])
       ORDER BY id ASC`,
      [ids],
    )) as Array<{
      id: number;
      userId: number;
      amount: string;
      category: string;
      description: string | null;
      tournamentId: number | null;
      createdAt: string;
    }>;

    console.log('[backfill-legacy-manual-topup-admins] before rows:', before.length);
    console.log(JSON.stringify(before, null, 2));

    const foundIds = new Set(before.map((row) => Number(row.id)));
    for (const fix of FIXES) {
      if (!foundIds.has(fix.transactionId)) {
        throw new Error(`Transaction ${fix.transactionId} not found`);
      }
    }

    await ds.transaction(async (manager) => {
      for (const fix of FIXES) {
        const description = buildAdminTopupDescription(fix.adminId, fix.comment);
        await manager.query(
          `UPDATE "transaction"
           SET category = $1,
               description = $2,
               "tournamentId" = NULL
           WHERE id = $3`,
          [fix.targetCategory, description, fix.transactionId],
        );
        console.log(
          `[backfill-legacy-manual-topup-admins] updated tx=${fix.transactionId} admin=${fix.adminId} category=${fix.targetCategory} reason=${fix.reason}`,
        );
      }
    });

    const after = await ds.query(
      `SELECT id, "userId", amount, category, description, "tournamentId", "createdAt"
       FROM "transaction"
       WHERE id = ANY($1::int[])
       ORDER BY id ASC`,
      [ids],
    );

    console.log('[backfill-legacy-manual-topup-admins] after rows:', after.length);
    console.log(JSON.stringify(after, null, 2));
  } finally {
    await ds.destroy();
  }
}

main().catch((error) => {
  console.error('[backfill-legacy-manual-topup-admins] failed:', error);
  process.exit(1);
});
