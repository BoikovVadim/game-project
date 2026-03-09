/**
 * Пометить пользователя как подтвердившего почту (для входа без письма).
 * Использование: npm run verify-email [userId]
 * По умолчанию: userId=1
 */
import * as path from 'path';
import * as fs from 'fs';
import { DataSource } from 'typeorm';

async function run() {
  const userId = parseInt(process.argv[2] || '1', 10);

  const possiblePaths = [
    path.resolve(path.join(__dirname, '..', '..', 'db.sqlite')),
    path.resolve(path.join(process.cwd(), 'db.sqlite')),
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
    const rows = await ds.query('SELECT id, email FROM user WHERE id = ?', [userId]);
    if (rows.length === 0) {
      console.error('Пользователь с ID', userId, 'не найден');
      process.exit(1);
    }
    await ds.query('UPDATE user SET emailVerified = 1, emailVerificationToken = NULL WHERE id = ?', [userId]);
    console.log('Готово: пользователь ID', userId, '(', (rows[0] as { email: string }).email, ') — почта считается подтверждённой. Можно входить.');
  } finally {
    await ds.destroy();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
