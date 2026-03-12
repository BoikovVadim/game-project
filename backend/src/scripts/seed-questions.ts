/**
 * Заполняет таблицу question_pool вопросами из всех генераторов.
 * Запуск: cd backend && npx ts-node -r tsconfig-paths/register src/scripts/seed-questions.ts
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QuestionPoolItem } from '../tournaments/question-pool.entity';
import { RawQuestion } from '../tournaments/question-generators/types';

import { generateMath } from '../tournaments/question-generators/math';
import { generateLogic } from '../tournaments/question-generators/logic';
import { generateGeoSpace } from '../tournaments/question-generators/geo-space';
import { generateEnglish } from '../tournaments/question-generators/english-words';
import { generateLiterature } from '../tournaments/question-generators/literature';
import { generateMusicFilm } from '../tournaments/question-generators/music-film';
import { generateHistoryScience } from '../tournaments/question-generators/history-science';
import { generateNatureTechCulture } from '../tournaments/question-generators/nature-tech-culture';
import { generateGeo500 } from '../tournaments/question-generators/expand-geo-500';
import { generateCulture500 } from '../tournaments/question-generators/expand-culture-500';
import { generateHistory500 } from '../tournaments/question-generators/expand-history-500';
import { generateNatureTech500 } from '../tournaments/question-generators/expand-nature-tech-500';

async function run() {
  console.log('Инициализация приложения...');
  const app = await NestFactory.createApplicationContext(AppModule);
  const repo = app.get<Repository<QuestionPoolItem>>(getRepositoryToken(QuestionPoolItem));

  console.log('Генерация вопросов...');
  const generators: { name: string; fn: () => RawQuestion[] }[] = [
    { name: 'Math', fn: generateMath },
    { name: 'Logic', fn: generateLogic },
    { name: 'GeoSpace', fn: generateGeoSpace },
    { name: 'English', fn: generateEnglish },
    { name: 'Literature', fn: generateLiterature },
    { name: 'MusicFilm', fn: generateMusicFilm },
    { name: 'HistoryScience', fn: generateHistoryScience },
    { name: 'NatureTechCulture', fn: generateNatureTechCulture },
    { name: 'Culture500', fn: generateCulture500 },
    { name: 'Geo500', fn: generateGeo500 },
    { name: 'History500', fn: generateHistory500 },
    { name: 'NatureTech500', fn: generateNatureTech500 },
  ];

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

  // --- Балансировка: ограничить раздутые категории до фиксированного лимита ---
  const CATEGORY_CAP = 200;
  const BLOATED_PREFIXES = ['math_', 'logic_', 'english_'];
  const isBloated = (topic: string) => BLOATED_PREFIXES.some((p) => topic.startsWith(p));

  const byTopic = new Map<string, RawQuestion[]>();
  for (const q of unique) {
    const arr = byTopic.get(q.topic) || [];
    arr.push(q);
    byTopic.set(q.topic, arr);
  }

  console.log(`Лимит для раздутых категорий: ${CATEGORY_CAP}`);

  const balanced: RawQuestion[] = [];
  for (const [topic, qs] of byTopic) {
    if (isBloated(topic) && qs.length > CATEGORY_CAP) {
      for (let i = qs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [qs[i], qs[j]] = [qs[j], qs[i]];
      }
      const trimmed = qs.slice(0, CATEGORY_CAP);
      console.log(`  ${topic}: ${qs.length} → ${trimmed.length} (ограничено)`);
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
