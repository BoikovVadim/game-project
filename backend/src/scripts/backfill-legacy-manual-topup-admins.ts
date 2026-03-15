import { DataSource } from 'typeorm';
import {
  buildAdminTopupDescription,
  parseAdminTopupDescription,
} from '../users/ruble-ledger-descriptions';

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
    targetCategory: 'topup',
    reason:
      'transaction audit confirmed tx #1 is a ruble admin topup and must contribute to ruble balance',
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

function isRejectedWithdrawalRefund(
  description: string | null,
  category: string,
): boolean {
  if (category !== 'refund' || !description) return false;
  const d = description.toLowerCase().replace(/ё/g, 'е');
  return (
    (d.includes('отклонен') && (d.includes('заявк') || d.includes('вывод'))) ||
    d.includes('возврат по отклонен') ||
    (d.includes('возврат') &&
      d.includes('заявк') &&
      (d.includes('вывод') || d.includes('отклонен')))
  );
}

function isNonRublesRefund(
  description: string | null,
  category: string,
  tournamentId?: number | null,
): boolean {
  if (category !== 'refund') return false;
  if (tournamentId != null) return true;
  if (!description) return false;
  const d = description.toLowerCase().replace(/ё/g, 'е');
  return (
    d.includes('турнир') ||
    d.includes('возврат за турнир') ||
    d.includes('возврат взноса') ||
    d.includes('лига')
  );
}

function isLegacyRublesOtherAdminTopup(
  category: string,
  description: string | null,
): boolean {
  return (
    category === 'other' && parseAdminTopupDescription(description).adminId != null
  );
}

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
    const affectedUserIds = Array.from(
      new Set(before.map((row) => Number(row.userId))),
    );

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

      for (const userId of affectedUserIds) {
        const txRows = (await manager.query(
          `SELECT category, amount, description, "tournamentId"
           FROM "transaction"
           WHERE "userId" = $1
             AND category IN ('topup','admin_credit','withdraw','refund','convert','other','win','loss','referral')`,
          [userId],
        )) as Array<{
          category: string;
          amount: string;
          description: string | null;
          tournamentId: number | null;
        }>;

        let rubles = 0;
        let balanceL = 0;
        for (const row of txRows) {
          const amount = Number(row.amount);
          if (
            ['topup', 'admin_credit', 'withdraw', 'refund', 'convert', 'other'].includes(
              row.category,
            )
          ) {
            if (row.category === 'other' && !isLegacyRublesOtherAdminTopup(row.category, row.description)) {
              // Skip non-ruble "other" rows in ruble balance.
            } else if (!isRejectedWithdrawalRefund(row.description, row.category)) {
              if (
                !isNonRublesRefund(
                  row.description,
                  row.category,
                  row.tournamentId,
                )
              ) {
                rubles += row.category === 'convert' ? -amount : amount;
              }
            }
          }

          if (['win', 'loss', 'referral', 'other', 'convert', 'refund'].includes(row.category)) {
            if (row.category === 'other' && isLegacyRublesOtherAdminTopup(row.category, row.description)) {
              continue;
            }
            if (isRejectedWithdrawalRefund(row.description, row.category)) continue;
            if (
              row.category === 'refund' &&
              !isNonRublesRefund(
                row.description,
                row.category,
                row.tournamentId,
              )
            ) {
              continue;
            }
            balanceL += amount;
          }
        }

        const pendingRows = await manager.query(
          `SELECT COALESCE(SUM(amount), 0) AS total
           FROM withdrawal_request
           WHERE "userId" = $1 AND status = 'pending'`,
          [userId],
        );
        const pending = Number(pendingRows?.[0]?.total ?? 0);
        const nextRubles = Math.max(0, rubles - pending);
        const nextBalanceL = Math.max(0, balanceL);
        await manager.query(
          `UPDATE "user"
           SET "balanceRubles" = $1,
               balance = $2
           WHERE id = $3`,
          [nextRubles, nextBalanceL, userId],
        );
        console.log(
          `[backfill-legacy-manual-topup-admins] reconciled user=${userId} rubles=${nextRubles} balance=${nextBalanceL}`,
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
    const usersAfter = await ds.query(
      `SELECT id, balance, "balanceRubles"
       FROM "user"
       WHERE id = ANY($1::int[])
       ORDER BY id ASC`,
      [affectedUserIds],
    );
    console.log('[backfill-legacy-manual-topup-admins] affected users after:');
    console.log(JSON.stringify(usersAfter, null, 2));
  } finally {
    await ds.destroy();
  }
}

main().catch((error) => {
  console.error('[backfill-legacy-manual-topup-admins] failed:', error);
  process.exit(1);
});
