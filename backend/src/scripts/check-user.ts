/**
 * Проверить пользователя в БД и совпадение пароля (для отладки входа).
 * Использование: npm run check-user [userId]
 */
import * as path from 'path';
import * as fs from 'fs';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';

async function run() {
  const userId = parseInt(process.argv[2] || '1', 10);
  const testPassword = process.argv[3] || 'password123';

  const possiblePaths = [
    path.resolve(path.join(__dirname, '..', '..', 'db.sqlite')),
    path.resolve(path.join(process.cwd(), 'db.sqlite')),
    path.resolve(path.join(process.cwd(), 'backend', 'db.sqlite')),
  ];
  const dbPath = possiblePaths.find((p) => fs.existsSync(p));
  if (!dbPath) {
    console.error('База не найдена. Проверены:', possiblePaths);
    process.exit(1);
  }
  console.log('БД:', dbPath);

  const ds = new DataSource({
    type: 'sqlite',
    database: dbPath,
    synchronize: false,
  });
  await ds.initialize();

  try {
    const rows = await ds.query('SELECT id, email, password, emailVerified, emailVerificationToken FROM user WHERE id = ?', [userId]);
    if (rows.length === 0) {
      console.error('Пользователь с ID', userId, 'не найден');
      process.exit(1);
    }
    const u = rows[0] as { id: number; email: string; password: string; emailVerified: number; emailVerificationToken: string | null };
    console.log('ID:', u.id);
    console.log('Email:', JSON.stringify(u.email));
    console.log('emailVerified:', u.emailVerified);
    console.log('emailVerificationToken:', u.emailVerificationToken);
    const match = await bcrypt.compare(testPassword, u.password);
    console.log('Пароль "' + testPassword + '" совпадает:', match);
  } finally {
    await ds.destroy();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
