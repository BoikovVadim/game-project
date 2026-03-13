/**
 * Исправляет кодировку в question_pool и question: перекодирует текст из Latin-1 в UTF-8, если он был сохранён с неправильной интерпретацией.
 * Запуск: cd backend && npx ts-node -r tsconfig-paths/register src/scripts/fix-question-encoding.ts
 */
function sanitizeUtf8(s: string): string {
  if (typeof s !== 'string' || !s) return s;
  try {
    const decoded = Buffer.from(s, 'latin1').toString('utf8');
    const cyrillicDecoded = (decoded.match(/[\u0400-\u04FF]/g) || []).length;
    const cyrillicOriginal = (s.match(/[\u0400-\u04FF]/g) || []).length;
    if (cyrillicDecoded > cyrillicOriginal || (decoded !== s && cyrillicDecoded > 0 && cyrillicOriginal === 0))
      return decoded;
  } catch {
    // ignore
  }
  return s;
}

async function run() {
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../app.module');
  const { getRepositoryToken } = await import('@nestjs/typeorm');
  const { Repository } = await import('typeorm');
  const { QuestionPoolItem } = await import('../tournaments/question-pool.entity');
  const { Question } = await import('../tournaments/question.entity');

  console.log('Инициализация приложения...');
  const app = await NestFactory.createApplicationContext(AppModule);

  const poolRepo = app.get<Repository<QuestionPoolItem>>(getRepositoryToken(QuestionPoolItem));
  const questionRepo = app.get<Repository<Question>>(getRepositoryToken(Question));

  let poolUpdated = 0;
  const poolRows = await poolRepo.find();
  for (const r of poolRows) {
    const qFixed = sanitizeUtf8(r.question);
    const optsFixed = Array.isArray(r.options) ? r.options.map((o) => sanitizeUtf8(String(o))) : r.options;
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
    const optsFixed = Array.isArray(r.options) ? r.options.map((o) => sanitizeUtf8(String(o))) : r.options;
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
