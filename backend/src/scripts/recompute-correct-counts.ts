import { DataSource } from 'typeorm';
import { Tournament } from '../tournaments/tournament.entity';
import { Question } from '../tournaments/question.entity';
import { User } from '../users/user.entity';
import { TournamentEntry } from '../tournaments/tournament-entry.entity';
import { TournamentResult } from '../tournaments/tournament-result.entity';
import { TournamentProgress } from '../tournaments/tournament-progress.entity';
import * as dotenv from 'dotenv';
dotenv.config();

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

  const progressRepo = ds.getRepository(TournamentProgress);
  const questionRepo = ds.getRepository(Question);
  const tournamentRepo = ds.getRepository(Tournament);

  const allProgress = await progressRepo.find();
  let fixed = 0;

  for (const p of allProgress) {
    const ac: number[] = Array.isArray(p.answersChosen) ? p.answersChosen : [];
    if (ac.length === 0) continue;

    const tournament = await tournamentRepo.findOne({
      where: { id: p.tournamentId },
      relations: ['players'],
    });
    if (!tournament) continue;

    const playerOrder: number[] = Array.isArray(tournament.playerOrder) ? tournament.playerOrder : [];
    const playerSlot = playerOrder.indexOf(p.userId);
    const semiRoundIndex = playerSlot >= 0 && playerSlot < 2 ? 0 : 1;

    const questions = await questionRepo.find({
      where: { tournament: { id: p.tournamentId } },
      order: { roundIndex: 'ASC', id: 'ASC' },
    });

    const semiQuestions = questions.filter((q) => q.roundIndex === semiRoundIndex);
    const postSemiQuestions = questions
      .filter((q) => q.roundIndex >= 2)
      .sort((a, b) => a.roundIndex - b.roundIndex || a.id - b.id);
    const playerQuestions = [...semiQuestions, ...postSemiQuestions];

    let total = 0;
    let semi = 0;
    for (let i = 0; i < ac.length && i < playerQuestions.length; i++) {
      if (ac[i] >= 0 && ac[i] === playerQuestions[i].correctAnswer) {
        total++;
        if (i < semiQuestions.length) semi++;
      }
    }

    const oldCorrect = p.correctAnswersCount;
    const oldSemi = p.semiFinalCorrectCount;
    let changed = false;

    if (oldCorrect !== total) {
      p.correctAnswersCount = total;
      changed = true;
    }
    if (ac.length >= 10 && oldSemi !== semi) {
      p.semiFinalCorrectCount = semi;
      changed = true;
    }

    if (changed) {
      await progressRepo.save(p);
      fixed++;
      console.log(
        `T${p.tournamentId} user=${p.userId}: correct ${oldCorrect}->${total}, semi ${oldSemi}->${semi}`,
      );
    }
  }

  console.log(`\nDone. Fixed ${fixed} of ${allProgress.length} progress records.`);
  await ds.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
