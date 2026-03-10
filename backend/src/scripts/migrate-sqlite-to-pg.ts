/**
 * Скрипт миграции данных из SQLite в PostgreSQL.
 *
 * Требования:
 *   1. PostgreSQL должен быть запущен, БД legendgames создана.
 *   2. Бэкенд должен быть хотя бы раз запущен с PostgreSQL (чтобы TypeORM создал таблицы через synchronize).
 *   3. Указать путь к SQLite-файлу как аргумент: npx ts-node src/scripts/migrate-sqlite-to-pg.ts ../db.sqlite
 *
 * Использование:
 *   cd backend
 *   npx ts-node src/scripts/migrate-sqlite-to-pg.ts ./db.sqlite
 */

import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '..', '..', '.env') });

import Database from 'better-sqlite3';
import { Client } from 'pg';

const SQLITE_PATH = process.argv[2];
if (!SQLITE_PATH) {
  console.error('Usage: npx ts-node src/scripts/migrate-sqlite-to-pg.ts <path-to-sqlite-db>');
  process.exit(1);
}

const TABLES_ORDERED = [
  'user',
  'tournament',
  'question',
  'tournament_entry',
  'tournament_players_user',
  'tournament_result',
  'tournament_progress',
  'tournament_escrow',
  'transaction',
  'payment',
  'withdrawal_request',
  'support_ticket',
  'support_message',
  'news',
];

async function migrate() {
  console.log(`[migrate] SQLite: ${SQLITE_PATH}`);
  const sqlite = new Database(SQLITE_PATH, { readonly: true });

  const pg = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'legend',
    password: process.env.DB_PASS || 'legend',
    database: process.env.DB_NAME || 'legendgames',
  });
  await pg.connect();
  console.log('[migrate] Connected to PostgreSQL');

  for (const table of TABLES_ORDERED) {
    const existsInSqlite = sqlite.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    ).get(table);
    if (!existsInSqlite) {
      console.log(`[migrate] Skipping "${table}" — not found in SQLite`);
      continue;
    }

    const rows = sqlite.prepare(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[];
    if (rows.length === 0) {
      console.log(`[migrate] "${table}" — 0 rows, skipping`);
      continue;
    }

    const columns = Object.keys(rows[0]!);
    const quotedCols = columns.map((c) => `"${c}"`).join(', ');

    await pg.query(`DELETE FROM "${table}"`);

    const BATCH = 100;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const values: unknown[] = [];
      const valueClauses: string[] = [];

      for (const row of batch) {
        const placeholders: string[] = [];
        for (const col of columns) {
          values.push(row[col] ?? null);
          placeholders.push(`$${values.length}`);
        }
        valueClauses.push(`(${placeholders.join(', ')})`);
      }

      await pg.query(
        `INSERT INTO "${table}" (${quotedCols}) VALUES ${valueClauses.join(', ')}`,
        values,
      );
      inserted += batch.length;
    }

    console.log(`[migrate] "${table}" — ${inserted} rows inserted`);

    if (columns.includes('id')) {
      try {
        const seqName = `${table}_id_seq`;
        await pg.query(`SELECT setval('"${seqName}"', (SELECT COALESCE(MAX(id), 0) FROM "${table}") + 1, false)`);
      } catch {
        // sequence may not exist for junction tables
      }
    }
  }

  sqlite.close();
  await pg.end();
  console.log('[migrate] Done!');
}

migrate().catch((err) => {
  console.error('[migrate] FATAL:', err);
  process.exit(1);
});
