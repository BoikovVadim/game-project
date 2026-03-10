/**
 * Пометить пользователя как подтвердившего почту (для входа без письма).
 * Использование: npm run verify-email [userId]
 * По умолчанию: userId=1
 */
import { DataSource } from 'typeorm';

async function run() {
  const userId = parseInt(process.argv[2] || '1', 10);

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
    const rows = await ds.query('SELECT id, email FROM "user" WHERE id = $1', [userId]);
    if (rows.length === 0) {
      console.error('Пользователь с ID', userId, 'не найден');
      process.exit(1);
    }
    await ds.query('UPDATE "user" SET "emailVerified" = true, "emailVerificationToken" = NULL WHERE id = $1', [userId]);
    console.log('Готово: пользователь ID', userId, '(', (rows[0] as { email: string }).email, ') — почта считается подтверждённой. Можно входить.');
  } finally {
    await ds.destroy();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
