/**
 * Исправляет кодировку в question_pool и question: перекодирует текст из Latin-1 в UTF-8, если он был сохранён с неправильной интерпретацией.
 * Запуск: cd backend && npx ts-node -r tsconfig-paths/register src/scripts/fix-question-encoding.ts
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QuestionPoolItem } from '../tournaments/question-pool.entity';
import { Question } from '../tournaments/question.entity';

/** Одинарная и двойная перекодировка latin1→utf8; возвращает вариант с большим количеством кириллицы. */
function sanitizeUtf8(s: string): string {
  if (typeof s !== 'string' || !s) return s;
  let best = s;
  let bestCyrillic = (s.match(/[\u0400-\u04FF]/g) || []).length;
  try {
    const decoded1 = Buffer.from(s, 'latin1').toString('utf8');
    const c1 = (decoded1.match(/[\u0400-\u04FF]/g) || []).length;
    if (c1 > bestCyrillic || (c1 > 0 && bestCyrillic === 0)) {
      best = decoded1;
      bestCyrillic = c1;
    }
    const decoded2 = Buffer.from(decoded1, 'latin1').toString('utf8');
    const c2 = (decoded2.match(/[\u0400-\u04FF]/g) || []).length;
    if (c2 > bestCyrillic || (c2 > 0 && bestCyrillic === 0)) best = decoded2;
  } catch {
    // ignore
  }
  return best;
}

async function run() {
  console.log('Инициализация приложения...');
  const app = await NestFactory.createApplicationContext(AppModule);

  const poolRepo = app.get<Repository<QuestionPoolItem>>(getRepositoryToken(QuestionPoolItem));
  const questionRepo = app.get<Repository<Question>>(getRepositoryToken(Question));

  let poolUpdated = 0;
  const poolRows = await poolRepo.find();
  for (const r of poolRows) {
    const qFixed = sanitizeUtf8(r.question);
    const optsFixed = Array.isArray(r.options) ? r.options.map((o: unknown) => sanitizeUtf8(String(o))) : r.options;
    if (qFixed !== r.question || JSON.stringify(optsFixed) !== JSON.stringify(r.options)) {
      await poolRepo.update(r.id, { question: qFixed, options: optsFixed });
      poolUpdated++;
    }
  }
  console.log(`question_pool: проверено ${poolRows.length}, обновлено ${poolUpdated}`);

  let questionUpdated = 0;
  const questionRows = await questionRepo.find();
  for (const r of questionRows) {
    const qFixed = sanitizeUtf8(r.question);
    const optsFixed = Array.isArray(r.options) ? r.options.map((o: unknown) => sanitizeUtf8(String(o))) : r.options;
    if (qFixed !== r.question || JSON.stringify(optsFixed) !== JSON.stringify(r.options)) {
      await questionRepo.update(r.id, { question: qFixed, options: optsFixed });
      questionUpdated++;
    }
  }
  console.log(`question: проверено ${questionRows.length}, обновлено ${questionUpdated}`);

  await app.close();
  process.exit(0);
}

run().catch((err) => {
  console.error('Ошибка:', err);
  process.exit(1);
});
