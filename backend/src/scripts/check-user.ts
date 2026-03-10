/**
 * Проверить пользователя в БД и совпадение пароля (для отладки входа).
 * Использование: npm run check-user [userId]
 */
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';

async function run() {
  const userId = parseInt(process.argv[2] || '1', 10);
  const testPassword = process.argv[3] || 'password123';

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
    const rows = await ds.query(
      'SELECT id, email, password, "emailVerified", "emailVerificationToken" FROM "user" WHERE id = $1',
      [userId]
    );
    if (rows.length === 0) {
      console.error('Пользователь с ID', userId, 'не найден');
      process.exit(1);
    }
    const u = rows[0] as { id: number; email: string; password: string; emailVerified: boolean; emailVerificationToken: string | null };
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
