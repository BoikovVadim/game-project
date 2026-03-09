/**
 * Однократное создание ~100 тестовых рефералов для первого пользователя в БД.
 * Запуск из папки backend: npx ts-node -r tsconfig-paths/register src/scripts/seed-referral-once.ts
 * Или: USER_ID=4 npx ts-node ...
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { UsersService } from '../users/users.service';

async function run() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const usersService = app.get(UsersService);
  const userId = process.env.USER_ID ? parseInt(process.env.USER_ID, 10) : null;
  const targetId = userId ?? (await usersService.findAll())[0]?.id;
  if (!targetId) {
    console.error('В БД нет пользователей. Создайте пользователя и запустите снова или задайте USER_ID.');
    await app.close();
    process.exit(1);
  }
  console.log('Создание тестовых рефералов для пользователя ID:', targetId);
  const result = await usersService.seedReferralModel(targetId);
  console.log(result.message);
  await app.close();
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
