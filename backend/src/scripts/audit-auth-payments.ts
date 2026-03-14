import { config } from 'dotenv';
import { existsSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';

const envCandidates = [
  join(__dirname, '..', '..', '.env'),
  join(__dirname, '..', '..', `.env.${process.env.NODE_ENV || 'development'}`),
];

for (const envPath of envCandidates) {
  if (existsSync(envPath)) {
    config({ path: envPath, override: false });
  }
}

type CountRow = { count: number | string };

async function getCount(client: Client, sql: string): Promise<number> {
  const result = await client.query<CountRow>(sql);
  return Number(result.rows[0]?.count || 0);
}

async function main() {
  const shouldFix = process.argv.includes('--fix');
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
  });

  await client.connect();

  try {
    const verifiedWithTokenBefore = await getCount(
      client,
      `
        SELECT COUNT(*)::int AS count
        FROM "user"
        WHERE "emailVerified" = true
          AND ("emailVerificationToken" IS NOT NULL OR "emailVerificationExpiresAt" IS NOT NULL)
      `,
    );

    let fixedVerifiedUsers = 0;
    if (shouldFix && verifiedWithTokenBefore > 0) {
      const fixResult = await client.query(
        `
          UPDATE "user"
          SET "emailVerificationToken" = NULL,
              "emailVerificationExpiresAt" = NULL
          WHERE "emailVerified" = true
            AND ("emailVerificationToken" IS NOT NULL OR "emailVerificationExpiresAt" IS NOT NULL)
        `,
      );
      fixedVerifiedUsers = fixResult.rowCount || 0;
    }

    const verifiedWithTokenAfter = await getCount(
      client,
      `
        SELECT COUNT(*)::int AS count
        FROM "user"
        WHERE "emailVerified" = true
          AND ("emailVerificationToken" IS NOT NULL OR "emailVerificationExpiresAt" IS NOT NULL)
      `,
    );

    const unverifiedWithoutToken = await getCount(
      client,
      `
        SELECT COUNT(*)::int AS count
        FROM "user"
        WHERE COALESCE("emailVerified", false) = false
          AND "emailVerificationToken" IS NULL
      `,
    );

    const succeededPaymentsWithoutTopupTxn = await getCount(
      client,
      `
        SELECT COUNT(*)::int AS count
        FROM payment p
        WHERE p.status = 'succeeded'
          AND NOT EXISTS (
            SELECT 1
            FROM transaction t
            WHERE t."userId" = p."userId"
              AND t.category = 'topup'
              AND (
                t.description = 'Пополнение через ЮKassa'
                OR t.description = 'Пополнение через Robokassa'
                OR t.description LIKE 'Пополнение через платёжного провайдера (%'
              )
              AND ABS(CAST(t.amount AS numeric) - CAST(p.amount AS numeric)) < 0.01
              AND t."createdAt" >= p."createdAt" - interval '1 day'
          )
      `,
    );

    console.log(`[audit-auth-payments] verified users with stale token: ${verifiedWithTokenBefore}`);
    if (shouldFix) {
      console.log(`[audit-auth-payments] fixed verified users: ${fixedVerifiedUsers}`);
    }
    console.log(`[audit-auth-payments] verified users with stale token after fix: ${verifiedWithTokenAfter}`);
    console.log(`[audit-auth-payments] unverified users without verification token: ${unverifiedWithoutToken}`);
    console.log(`[audit-auth-payments] succeeded payments without topup transaction: ${succeededPaymentsWithoutTopupTxn}`);

    if (verifiedWithTokenAfter > 0 || unverifiedWithoutToken > 0 || succeededPaymentsWithoutTopupTxn > 0) {
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('[audit-auth-payments] failed:', error);
  process.exit(1);
});
