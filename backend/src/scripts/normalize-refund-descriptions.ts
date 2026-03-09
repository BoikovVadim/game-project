/**
 * Переписывает описания возвратов за турниры в единый формат:
 * "Возврат за турнир, {название лиги}, ID {tournamentId}"
 *
 * Запуск: npx ts-node -r tsconfig-paths/register src/scripts/normalize-refund-descriptions.ts
 */
import * as path from 'path';
import * as fs from 'fs';
import { DataSource } from 'typeorm';

const LEAGUE_NAMES: Record<number, string> = {
  5: 'Янтарная лига', 10: 'Коралловая лига', 20: 'Нефритовая лига', 50: 'Агатовая лига',
  100: 'Аметистовая лига', 200: 'Топазовая лига', 500: 'Гранатовая лига', 1000: 'Изумрудовая лига',
  2000: 'Рубиновая лига', 5000: 'Сапфировая лига', 10000: 'Опаловая лига', 20000: 'Жемчужная лига',
  50000: 'Александритовая лига', 100000: 'Бриллиантовая лига', 200000: 'Лазуритовая лига',
  500000: 'Лига чёрного опала', 1000000: 'Алмазная лига',
};

function getLeagueName(amount: number | null): string {
  if (amount == null) return 'Лига';
  return LEAGUE_NAMES[amount] ?? `Лига ${amount} L`;
}

function isTournamentRefundToNormalize(description: string): boolean {
  const d = description.toLowerCase();
  return d.includes('возврат взноса') && (d.includes('турнир') || d.includes('№'));
}

function extractTournamentId(description: string, tournamentIdFromRow: number | null): number | null {
  if (tournamentIdFromRow != null) return tournamentIdFromRow;
  const match = description.match(/турнир\s*№?\s*(\d+)|ID\s*(\d+)/i);
  if (match) return parseInt(match[1] ?? match[2] ?? '', 10) || null;
  return null;
}

async function run() {
  const possiblePaths = [
    path.resolve(path.join(__dirname, '..', '..', 'db.sqlite')),
    path.resolve(path.join(__dirname, '..', '..', '..', 'db.sqlite')),
  ];
  const dbPath = possiblePaths.find((p) => fs.existsSync(p));
  if (!dbPath) {
    console.error('База данных не найдена. Проверены пути:', possiblePaths);
    process.exit(1);
  }

  const ds = new DataSource({
    type: 'sqlite',
    database: dbPath,
    synchronize: false,
  });
  await ds.initialize();

  try {
    const refunds = await ds.query(
      `SELECT id, userId, amount, description, tournamentId FROM "transaction"
       WHERE category = 'refund' AND description IS NOT NULL AND description != ''`
    ) as { id: number; userId: number; amount: number; description: string; tournamentId: number | null }[];

    let updated = 0;
    for (const row of refunds) {
      if (!isTournamentRefundToNormalize(row.description)) continue;

      const tournamentId = extractTournamentId(row.description, row.tournamentId);
      if (tournamentId == null) {
        console.log(`Пропуск id=${row.id}: не удалось извлечь ID турнира из "${row.description}"`);
        continue;
      }

      const tournaments = await ds.query(
        'SELECT id, leagueAmount FROM tournament WHERE id = ?',
        [tournamentId]
      ) as { id: number; leagueAmount: number | null }[];
      const leagueAmount = tournaments[0]?.leagueAmount ?? null;
      const leagueName = getLeagueName(leagueAmount);
      const newDescription = `${leagueName}, ID ${tournamentId}`;

      await ds.query(
        'UPDATE "transaction" SET description = ? WHERE id = ?',
        [newDescription, row.id]
      );
      console.log(`id=${row.id}: "${row.description}" → "${newDescription}"`);
      updated++;
    }

    console.log(`\nГотово: обновлено записей ${updated}.`);
  } finally {
    await ds.destroy();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
