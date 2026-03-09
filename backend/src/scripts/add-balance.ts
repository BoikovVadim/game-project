/**
 * Добавляет сумму на рублёвый баланс пользователя по ID.
 * Использование: npx ts-node -r tsconfig-paths/register src/scripts/add-balance.ts [userId] [amount]
 * По умолчанию: userId=1, amount=100
 */
import * as path from 'path';
import * as fs from 'fs';
import { DataSource } from 'typeorm';

async function run() {
  const userId = parseInt(process.argv[2] || '1', 10);
  const amount = parseInt(process.argv[3] || '100', 10);

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
    const userRows = await ds.query('SELECT id, balanceRubles FROM user WHERE id = ?', [userId]);
    if (userRows.length === 0) {
      console.error('Пользователь с ID', userId, 'не найден');
      process.exit(1);
    }
    const current = Number(userRows[0].balanceRubles ?? 0);
    const newBalance = current + amount;

    await ds.query('UPDATE user SET balanceRubles = ? WHERE id = ?', [newBalance, userId]);
    await ds.query(
      'INSERT INTO "transaction" (userId, amount, description, category, createdAt) VALUES (?, ?, ?, ?, ?)',
      [userId, amount, 'Пополнение баланса', 'topup', new Date().toISOString()]
    );

    console.log(`Готово: пользователь ID ${userId}: было ${current} ₽, добавлено ${amount} ₽, стало ${newBalance} ₽`);
  } finally {
    await ds.destroy();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
