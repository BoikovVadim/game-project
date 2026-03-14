/**
 * Заполняет таблицу question_pool вопросами из всех генераторов.
 * Запуск: cd backend && npx ts-node -r tsconfig-paths/register src/scripts/seed-questions.ts
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QuestionPoolItem } from '../tournaments/question-pool.entity';
import type { RawQuestion } from '../tournaments/question-generators/types';
import { getQuestionGeneratorGroups } from '../tournaments/question-generators/catalog';

async function run() {
  console.log('Инициализация приложения...');
  const app = await NestFactory.createApplicationContext(AppModule);
  const repo = app.get<Repository<QuestionPoolItem>>(getRepositoryToken(QuestionPoolItem));

  console.log('Генерация вопросов...');
  const generators: { name: string; fn: () => RawQuestion[] }[] = getQuestionGeneratorGroups().map((group) => ({
    name: group.name,
    fn: group.generate,
  }));

  const allQuestions: RawQuestion[] = [];
  for (const g of generators) {
    try {
      const qs = g.fn();
      console.log(`  ${g.name}: ${qs.length} вопросов`);
      allQuestions.push(...qs);
    } catch (e: any) {
      console.error(`  ОШИБКА в ${g.name}: ${e.message}`);
    }
  }

  const seen = new Set<string>();
  const unique = allQuestions.filter((q) => {
    if (seen.has(q.question)) return false;
    seen.add(q.question);
    return true;
  });
  console.log(`\nВсего уникальных вопросов (до балансировки): ${unique.length}`);

  // --- Балансировка ---
  // 1) Объединяем math_* и logic_* в один топик «math_logic»
  for (const q of unique) {
    if (q.topic.startsWith('math_') || q.topic.startsWith('logic_')) {
      q.topic = 'math_logic';
    }
  }

  // 2) Считаем сколько вопросов в english_translation — это наш лимит
  const byTopic = new Map<string, RawQuestion[]>();
  for (const q of unique) {
    const arr = byTopic.get(q.topic) || [];
    arr.push(q);
    byTopic.set(q.topic, arr);
  }
  const englishCount = (byTopic.get('english_translation') || []).length;
  const cap = englishCount || 2400;
  console.log(`Лимит (по уровню english_translation): ${cap}`);

  // 3) Обрезаем math_logic и english_translation до cap
  const shuffle = (arr: RawQuestion[]) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  };

  const balanced: RawQuestion[] = [];
  for (const [topic, qs] of byTopic) {
    if ((topic === 'math_logic' || topic === 'english_translation') && qs.length > cap) {
      shuffle(qs);
      const trimmed = qs.slice(0, cap);
      console.log(`  ${topic}: ${qs.length} → ${trimmed.length}`);
      balanced.push(...trimmed);
    } else {
      balanced.push(...qs);
    }
  }
  console.log(`Всего после балансировки: ${balanced.length}`);

  console.log('Очистка таблицы question_pool...');
  await repo.clear();

  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < balanced.length; i += BATCH) {
    const batch = balanced.slice(i, i + BATCH).map((q) =>
      repo.create({ topic: q.topic, question: q.question, options: q.options, correctAnswer: q.correctAnswer }),
    );
    await repo.save(batch);
    inserted += batch.length;
    if (inserted % 5000 === 0 || i + BATCH >= balanced.length) {
      console.log(`  Вставлено: ${inserted}/${balanced.length}`);
    }
  }

  const stats = await repo
    .createQueryBuilder('q')
    .select('q.topic', 'topic')
    .addSelect('COUNT(*)', 'cnt')
    .groupBy('q.topic')
    .orderBy('cnt', 'DESC')
    .getRawMany();
  console.log('\n=== Статистика по темам ===');
  let total = 0;
  for (const s of stats) {
    console.log(`  ${s.topic}: ${s.cnt}`);
    total += parseInt(s.cnt, 10);
  }
  console.log(`  ИТОГО: ${total} вопросов, ${stats.length} тем\n`);

  await app.close();
  process.exit(0);
}

run().catch((err) => {
  console.error('Фатальная ошибка:', err);
  process.exit(1);
});
