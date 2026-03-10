/**
 * Установить новый пароль пользователю по ID (для восстановления доступа).
 * Использование: npm run set-password [userId] [новый_пароль]
 * По умолчанию: userId=1, пароль=password123
 */
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';

async function run() {
  const userId = parseInt(process.argv[2] || '1', 10);
  const newPassword = process.argv[3] || 'password123';

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
    const hash = await bcrypt.hash(newPassword, 10);
    await ds.query('UPDATE "user" SET password = $1 WHERE id = $2', [hash, userId]);
    console.log('Готово: для пользователя ID', userId, '(', (rows[0] as { email: string }).email, ') установлен новый пароль.');
    console.log('Войдите с этим паролем:', newPassword);
  } finally {
    await ds.destroy();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
