/**
 * Меняет местами пользователей с ID 1 и 4.
 * Пользователь 4 станет 1 (родоначальник), пользователь 1 станет 4.
 * Запуск из папки backend: npx ts-node -r tsconfig-paths/register src/scripts/swap-user-ids.ts
 */
import { DataSource } from 'typeorm';

const TEMP_ID = 999999;

async function run() {
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

  const qr = ds.createQueryRunner();
  await qr.connect();

  try {
    // PostgreSQL does not need PRAGMA foreign_keys = OFF; constraints are handled per-transaction
    await qr.startTransaction();

    const tablesWithUserId = [
      { table: '"transaction"', col: 'userId' },
      { table: 'tournament_progress', col: 'userId' },
      { table: 'tournament_escrow', col: 'userId' },
      { table: 'tournament_result', col: 'userId' },
      { table: 'tournament_entry', col: 'userId' },
      { table: 'tournament_players_user', col: 'userId' },
    ];

    const updateFk = async (table: string, col: string, fromId: number, toId: number) => {
      const quotedCol = `"${col}"`;
      const rows = await qr.query(`SELECT id FROM ${table} WHERE ${quotedCol} = $1`, [fromId]);
      if (rows.length > 0) {
        await qr.query(`UPDATE ${table} SET ${quotedCol} = $1 WHERE ${quotedCol} = $2`, [toId, fromId]);
      }
    };

    const user1 = await qr.query('SELECT id, username FROM "user" WHERE id = 1');
    const user4 = await qr.query('SELECT id, username FROM "user" WHERE id = 4');

    if (user1.length === 0 || user4.length === 0) {
      console.error('Оба пользователя (id=1 и id=4) должны существовать в БД');
      await qr.rollbackTransaction();
      process.exit(1);
    }

    console.log('Шаг 1: user 1 → temp', TEMP_ID);
    await qr.query('UPDATE "user" SET id = $1 WHERE id = 1', [TEMP_ID]);
    for (const { table, col } of tablesWithUserId) {
      try {
        await updateFk(table, col, 1, TEMP_ID);
      } catch (e) {
        console.warn(`  ${table}.${col}:`, (e as Error).message);
      }
    }
    await qr.query('UPDATE "user" SET "referrerId" = $1 WHERE "referrerId" = 1', [TEMP_ID]);

    console.log('Шаг 2: user 4 → 1');
    await qr.query('UPDATE "user" SET id = 1 WHERE id = 4');
    for (const { table, col } of tablesWithUserId) {
      try {
        await updateFk(table, col, 4, 1);
      } catch (e) {
        console.warn(`  ${table}.${col}:`, (e as Error).message);
      }
    }
    await qr.query('UPDATE "user" SET "referrerId" = 1 WHERE "referrerId" = 4');

    console.log('Шаг 3: temp → 4');
    await qr.query('UPDATE "user" SET id = 4 WHERE id = $1', [TEMP_ID]);
    for (const { table, col } of tablesWithUserId) {
      try {
        await updateFk(table, col, TEMP_ID, 4);
      } catch (e) {
        console.warn(`  ${table}.${col}:`, (e as Error).message);
      }
    }
    await qr.query('UPDATE "user" SET "referrerId" = 4 WHERE "referrerId" = $1', [TEMP_ID]);

    await qr.commitTransaction();
    // PostgreSQL does not need PRAGMA foreign_keys = ON

    console.log('Готово. Пользователь 4 теперь id=1, пользователь 1 теперь id=4.');
  } catch (e) {
    await qr.rollbackTransaction();
    console.error('Ошибка:', e);
    process.exit(1);
  } finally {
    await qr.release();
    await ds.destroy();
  }
}

run();
