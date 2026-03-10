/**
 * Добавляет сумму на рублёвый баланс пользователя по ID.
 * Использование: npx ts-node -r tsconfig-paths/register src/scripts/add-balance.ts [userId] [amount]
 * По умолчанию: userId=1, amount=100
 */
import { DataSource } from 'typeorm';

async function run() {
  const userId = parseInt(process.argv[2] || '1', 10);
  const amount = parseInt(process.argv[3] || '100', 10);

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
    const userRows = await ds.query('SELECT id, "balanceRubles" FROM "user" WHERE id = $1', [userId]);
    if (userRows.length === 0) {
      console.error('Пользователь с ID', userId, 'не найден');
      process.exit(1);
    }
    const current = Number(userRows[0].balanceRubles ?? 0);
    const newBalance = current + amount;

    await ds.query('UPDATE "user" SET "balanceRubles" = $1 WHERE id = $2', [newBalance, userId]);
    await ds.query(
      'INSERT INTO "transaction" ("userId", amount, description, category, "createdAt") VALUES ($1, $2, $3, $4, $5)',
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
