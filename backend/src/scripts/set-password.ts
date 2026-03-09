/**
 * Установить новый пароль пользователю по ID (для восстановления доступа).
 * Использование: npm run set-password [userId] [новый_пароль]
 * По умолчанию: userId=1, пароль=password123
 */
import * as path from 'path';
import * as fs from 'fs';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';

async function run() {
  const userId = parseInt(process.argv[2] || '1', 10);
  const newPassword = process.argv[3] || 'password123';

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
    const hash = await bcrypt.hash(newPassword, 10);
    await ds.query('UPDATE user SET password = ? WHERE id = ?', [hash, userId]);
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
