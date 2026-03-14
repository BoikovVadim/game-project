import * as dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { UsersService } from '../users/users.service';
import { DataSource } from 'typeorm';

dotenv.config();

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  try {
    const usersService = app.get(UsersService);
    const dataSource = app.get(DataSource);

    const before = await dataSource.query(
      `SELECT id, "userId", amount, category, description, "tournamentId"
       FROM "transaction"
       WHERE category = 'admin_credit'
       ORDER BY id ASC`,
    );

    console.log('Legacy admin_credit rows before fix:', before.length);
    if (before.length > 0) {
      console.log(JSON.stringify(before, null, 2));
    }

    const result = await usersService.normalizeLegacyAdminCreditTransactions();

    const after = await dataSource.query(
      `SELECT id, "userId", amount, category, description, "tournamentId"
       FROM "transaction"
       WHERE id = ANY($1::int[])
       ORDER BY id ASC`,
      [before.map((row: { id: number }) => row.id)],
    );

    console.log('Updated rows:', result.updatedCount);
    console.log('Affected users:', result.affectedUserIds.join(', ') || 'none');
    if (after.length > 0) {
      console.log(JSON.stringify(after, null, 2));
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
