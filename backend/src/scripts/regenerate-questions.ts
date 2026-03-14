import { DataSource } from 'typeorm';
import { Tournament } from '../tournaments/tournament.entity';
import { Question } from '../tournaments/question.entity';
import { User } from '../users/user.entity';
import { TournamentEntry } from '../tournaments/tournament-entry.entity';
import { TournamentResult } from '../tournaments/tournament-result.entity';
import { TournamentProgress } from '../tournaments/tournament-progress.entity';
import { generateQuestionCatalog } from '../tournaments/question-generators/catalog';
import type { RawQuestion } from '../tournaments/question-generators/types';
import * as dotenv from 'dotenv';
dotenv.config();

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function getCategory(question: RawQuestion): string {
  const [prefix] = question.topic.split('_');
  return prefix || 'misc';
}

function pickBalanced(n: number): RawQuestion[] {
  const catalog = generateQuestionCatalog();
  const categories = [...new Set(catalog.map(getCategory))];
  const byCategory = new Map<string, RawQuestion[]>();
  for (const category of categories) {
    byCategory.set(category, shuffle(catalog.filter((question) => getCategory(question) === category)));
  }
  const out: RawQuestion[] = [];
  let round = 0;
  while (out.length < n) {
    const cat = categories[round % categories.length]!;
    const pool = byCategory.get(cat) ?? [];
    if (pool.length > 0) out.push(pool.shift()!);
    round++;
    if (round > n * Math.max(categories.length, 1) + 100) break;
  }
  return out;
}

async function main() {
  const ds = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USER || 'legend',
    password: process.env.DB_PASS || 'legend',
    database: process.env.DB_NAME || 'legendgames',
    entities: [Tournament, Question, User, TournamentEntry, TournamentResult, TournamentProgress],
    synchronize: false,
  });
  await ds.initialize();

  const tournamentRepo = ds.getRepository(Tournament);
  const questionRepo = ds.getRepository(Question);

  const tournaments = await tournamentRepo.find();
  let regenerated = 0;

  for (const t of tournaments) {
    const existingCount = await questionRepo.count({ where: { tournament: { id: t.id } } });
    if (existingCount > 0) {
      console.log(`Tournament #${t.id}: already has ${existingCount} questions, skipping`);
      continue;
    }

    const semi1 = pickBalanced(10);
    const semi2 = shuffle([...semi1]);

    for (const q of semi1) {
      await questionRepo.save(questionRepo.create({
        question: q.question,
        options: q.options,
        correctAnswer: q.correctAnswer,
        roundIndex: 0,
        tournament: t,
      }));
    }
    for (const q of semi2) {
      await questionRepo.save(questionRepo.create({
        question: q.question,
        options: q.options,
        correctAnswer: q.correctAnswer,
        roundIndex: 1,
        tournament: t,
      }));
    }
    regenerated++;
    console.log(`Tournament #${t.id}: regenerated 20 questions (semi1 + semi2)`);
  }

  console.log(`\nDone. Regenerated questions for ${regenerated} tournaments.`);
  await ds.destroy();
}

main().catch((e) => { console.error(e); process.exit(1); });
