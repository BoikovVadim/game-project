import { BadRequestException, forwardRef, Inject, Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Tournament, TournamentStatus, ROUND_DEADLINE_HOURS, WAITING_DEADLINE_HOURS } from './tournament.entity';
import { Question } from './question.entity';
import { QuestionPoolItem } from './question-pool.entity';
import { TournamentEntry } from './tournament-entry.entity';
import { TournamentResult } from './tournament-result.entity';
import { TournamentProgress } from './tournament-progress.entity';
import { TournamentEscrow } from './tournament-escrow.entity';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';

/** Все лиги по возрастанию: 5, 10, 20, 50, …, до 1 млн. */
const LEAGUE_AMOUNTS: number[] = (() => {
  const base = [5, 10, 20, 50];
  const seen = new Set<number>();
  const result: number[] = [];
  let mult = 1;
  while (mult <= 1_000_000) {
    for (const b of base) {
      const v = b * mult;
      if (v <= 1_000_000 && !seen.has(v)) {
        seen.add(v);
        result.push(v);
      }
    }
    mult *= 10;
  }
  return result.sort((a, b) => a - b);
})();

/** Для первой лиги (5 L) мин. баланс = ставка; для остальных = 10 × ставка. Побед для перехода = 10. */
const LEAGUE_MIN_BALANCE_MULTIPLIER = 10;
const LEAGUE_WINS_TO_UNLOCK = 10;

const LEAGUE_NAMES: Record<number, string> = {
  5: 'Янтарная лига', 10: 'Коралловая лига', 20: 'Нефритовая лига', 50: 'Агатовая лига',
  100: 'Аметистовая лига', 200: 'Топазовая лига', 500: 'Гранатовая лига', 1000: 'Изумрудовая лига',
  2000: 'Рубиновая лига', 5000: 'Сапфировая лига', 10000: 'Опаловая лига', 20000: 'Жемчужная лига',
  50000: 'Александритовая лига', 100000: 'Бриллиантовая лига', 200000: 'Лазуритовая лига',
  500000: 'Лига чёрного опала', 1000000: 'Алмазная лига',
};

function getLeagueName(amount: number): string {
  return LEAGUE_NAMES[amount] ?? `Лига ${amount} L`;
}

/** Выигрыш победителя: 4 игрока × ставка − 20% с каждого из 3 проигравших = 3.4 × ставка L */
function getLeaguePrize(stake: number): number {
  return Math.round(3.4 * stake);
}

function getMinBalanceForLeague(leagueIndex: number, amount: number): number {
  return leagueIndex === 0 ? amount : amount * LEAGUE_MIN_BALANCE_MULTIPLIER;
}

@Injectable()
export class TournamentsService {
  constructor(
    @InjectRepository(Tournament)
    private readonly tournamentRepository: Repository<Tournament>,
    @InjectRepository(Question)
    private readonly questionRepository: Repository<Question>,
    @InjectRepository(QuestionPoolItem)
    private readonly questionPoolRepository: Repository<QuestionPoolItem>,
    @InjectRepository(TournamentEntry)
    private readonly tournamentEntryRepository: Repository<TournamentEntry>,
    @InjectRepository(TournamentResult)
    private readonly tournamentResultRepository: Repository<TournamentResult>,
    @InjectRepository(TournamentProgress)
    private readonly tournamentProgressRepository: Repository<TournamentProgress>,
    @InjectRepository(TournamentEscrow)
    private readonly tournamentEscrowRepository: Repository<TournamentEscrow>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @Inject(forwardRef(() => UsersService))
    private readonly usersService: UsersService,
  ) {}

  private readonly logger = new Logger(TournamentsService.name);

  private getRoundDeadline(from: Date): string {
    return new Date(from.getTime() + ROUND_DEADLINE_HOURS * 3600000).toISOString();
  }

  private getWaitingDeadline(from: Date): string {
    return new Date(from.getTime() + WAITING_DEADLINE_HOURS * 3600000).toISOString();
  }

  private isPlayerInFinalPhase(
    myProg: TournamentProgress | undefined | null,
    allProgress: TournamentProgress[],
    tournament: Tournament | undefined,
  ): boolean {
    if (!myProg || !tournament) return false;
    const myQ = myProg.questionsAnsweredCount ?? 0;
    if (myQ < this.QUESTIONS_PER_ROUND) return false;
    const mySemi = myProg.semiFinalCorrectCount;
    if (mySemi == null) return false;

    this.sortPlayersByOrder(tournament);
    const playerSlot = tournament.playerOrder?.indexOf(myProg.userId) ?? -1;
    if (playerSlot < 0) return false;
    const oppSlot = playerSlot % 2 === 0 ? playerSlot + 1 : playerSlot - 1;
    const oppId = tournament.playerOrder && oppSlot >= 0 && oppSlot < tournament.playerOrder.length
      ? tournament.playerOrder[oppSlot] : null;

    const myTBLen = (myProg.tiebreakerRoundsCorrect ?? []).length;
    const mySemiTotal = this.QUESTIONS_PER_ROUND + myTBLen * this.TIEBREAKER_QUESTIONS;

    if (oppId == null || oppId <= 0) {
      return myQ >= this.QUESTIONS_PER_ROUND;
    }

    const oppProg = allProgress.find((p) => p.tournamentId === myProg.tournamentId && p.userId === oppId);
    if (!oppProg || oppProg.semiFinalCorrectCount == null) {
      return myQ > mySemiTotal;
    }

    if (mySemi < oppProg.semiFinalCorrectCount) return false;
    if (mySemi === oppProg.semiFinalCorrectCount) {
      const myTB = myProg.tiebreakerRoundsCorrect ?? [];
      const oppTB = oppProg.tiebreakerRoundsCorrect ?? [];
      let won = false;
      for (let r = 0; r < Math.max(myTB.length, oppTB.length); r++) {
        if ((myTB[r] ?? 0) > (oppTB[r] ?? 0)) { won = true; break; }
        if ((myTB[r] ?? 0) < (oppTB[r] ?? 0)) return false;
      }
      if (!won) return false;
    }

    return myQ >= mySemiTotal;
  }

  private async getLastActivityDate(tournamentId: number, fallback: Date): Promise<Date> {
    const progressList = await this.tournamentProgressRepository.find({ where: { tournamentId } });
    const entries = await this.tournamentEntryRepository.find({ where: { tournament: { id: tournamentId } } as any });
    let latest = fallback;
    for (const p of progressList) {
      if (p.leftAt && p.leftAt > latest) latest = p.leftAt;
    }
    for (const e of entries) {
      if (e.joinedAt && e.joinedAt > latest) latest = e.joinedAt;
    }
    return latest;
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleExpiredEscrowsCron(): Promise<void> {
    try {
      await this.processAllExpiredEscrows();
    } catch (err) {
      this.logger.error('[Cron] processAllExpiredEscrows failed', err);
    }
    try {
      await this.cancelUnfilledTournaments();
    } catch (err) {
      this.logger.error('[Cron] cancelUnfilledTournaments failed', err);
    }
    try {
      await this.closeTimedOutRounds();
    } catch (err) {
      this.logger.error('[Cron] closeTimedOutRounds failed', err);
    }
  }

  /**
   * Отменяет турниры, в которых за 24ч от создания не набралось 4 игрока.
   */
  private async cancelUnfilledTournaments(): Promise<void> {
    const cutoff = new Date(Date.now() - WAITING_DEADLINE_HOURS * 3600000);
    const tournaments = await this.tournamentRepository
      .createQueryBuilder('t')
      .where('t.status IN (:...statuses)', { statuses: [TournamentStatus.WAITING, TournamentStatus.ACTIVE] })
      .andWhere('t."createdAt" < :cutoff', { cutoff })
      .leftJoinAndSelect('t.players', 'players')
      .getMany();

    for (const tournament of tournaments) {
      try {
        const order = tournament.playerOrder ?? [];
        const realCount = order.filter((id) => id > 0).length;
        if (realCount >= 4) continue;

        const allProg = await this.tournamentProgressRepository.find({ where: { tournamentId: tournament.id } });

        const anyoneStarted = allProg.some((p) => (p.questionsAnsweredCount ?? 0) > 0);
        if (anyoneStarted) continue;

        this.logger.log(`[cancelUnfilledTournaments] Tournament ${tournament.id}: only ${realCount} players and no progress, cancelling`);

        for (const prog of allProg) {
          let row = await this.tournamentResultRepository.findOne({ where: { userId: prog.userId, tournamentId: tournament.id } });
          if (row) { row.passed = 0; if (!row.completedAt) row.completedAt = new Date(); await this.tournamentResultRepository.save(row); }
          else { await this.tournamentResultRepository.save(this.tournamentResultRepository.create({ userId: prog.userId, tournamentId: tournament.id, passed: 0, completedAt: new Date() })); }
        }

        tournament.status = TournamentStatus.FINISHED;
        await this.tournamentRepository.save(tournament);

        if (tournament.gameType === 'money') {
          await this.processTournamentEscrow(tournament.id);
        }
      } catch (err) {
        this.logger.error(`[cancelUnfilledTournaments] Error for tournament ${tournament.id}`, err);
      }
    }
  }

  /**
   * Проверяет per-round 24ч дедлайны: если игрок не ответил за 24ч — соперник побеждает.
   */
  private async closeTimedOutRounds(): Promise<void> {
    const activeTournaments = await this.tournamentRepository
      .createQueryBuilder('t')
      .where('t.status IN (:...statuses)', { statuses: [TournamentStatus.WAITING, TournamentStatus.ACTIVE] })
      .leftJoinAndSelect('t.players', 'players')
      .getMany();

    const now = new Date();
    const roundCutoffMs = ROUND_DEADLINE_HOURS * 3600000;

    for (const tournament of activeTournaments) {
      try {
        const order = tournament.playerOrder ?? [];
        const realCount = order.filter((id) => id > 0).length;
        if (realCount < 2) continue;

        this.sortPlayersByOrder(tournament);
        const allProg = await this.tournamentProgressRepository.find({ where: { tournamentId: tournament.id } });
        const entries = await this.tournamentEntryRepository.find({ where: { tournament: { id: tournament.id } } as any });

        const getPlayerRoundStart = (uid: number): Date | null => {
          const prog = allProg.find((p) => p.userId === uid);
          if (prog?.roundStartedAt) return prog.roundStartedAt;
          const entry = entries.find((e: any) => (e.userId ?? e.user?.id) === uid);
          if (entry?.joinedAt) return entry.joinedAt;
          return null;
        };

        const isTimedOut = (uid: number): boolean => {
          const start = getPlayerRoundStart(uid);
          if (!start) return false;
          return now.getTime() - start.getTime() > roundCutoffMs;
        };

        const playerFinishedCurrentRound = (uid: number): boolean => {
          const prog = allProg.find((p) => p.userId === uid);
          if (!prog) return false;
          const q = prog.questionsAnsweredCount ?? 0;
          const tbLen = (prog.tiebreakerRoundsCorrect ?? []).length;
          const semiTotal = this.QUESTIONS_PER_ROUND + tbLen * this.TIEBREAKER_QUESTIONS;
          const inFinal = this.isPlayerInFinalPhase(prog, allProg, tournament);
          if (!inFinal) return q >= semiTotal && q % this.QUESTIONS_PER_ROUND === 0;
          return q >= semiTotal + this.QUESTIONS_PER_ROUND;
        };

        const saveResult = async (uid: number, passed: boolean) => {
          let row = await this.tournamentResultRepository.findOne({ where: { userId: uid, tournamentId: tournament.id } });
          if (row) { row.passed = passed ? 1 : 0; if (!row.completedAt) row.completedAt = new Date(); await this.tournamentResultRepository.save(row); }
          else { await this.tournamentResultRepository.save(this.tournamentResultRepository.create({ userId: uid, tournamentId: tournament.id, passed: passed ? 1 : 0, completedAt: new Date() })); }
        };

        let tournamentResolved = false;

        // Check each semi-final pair
        for (const pair of [[0, 1], [2, 3]] as const) {
          const id1 = pair[0] < order.length ? order[pair[0]] : -1;
          const id2 = pair[1] < order.length ? order[pair[1]] : -1;
          if (id1 <= 0 || id2 <= 0) continue;

          const p1Finished = playerFinishedCurrentRound(id1);
          const p2Finished = playerFinishedCurrentRound(id2);
          const p1Timeout = !p1Finished && isTimedOut(id1);
          const p2Timeout = !p2Finished && isTimedOut(id2);

          if (!p1Timeout && !p2Timeout) continue;

          if (p1Finished && p2Timeout) {
            this.logger.log(`[closeTimedOutRounds] T${tournament.id}: player ${id2} timed out, ${id1} wins`);
            await saveResult(id2, false);
          } else if (p2Finished && p1Timeout) {
            this.logger.log(`[closeTimedOutRounds] T${tournament.id}: player ${id1} timed out, ${id2} wins`);
            await saveResult(id1, false);
          } else if (p1Timeout && p2Timeout) {
            this.logger.log(`[closeTimedOutRounds] T${tournament.id}: both ${id1} and ${id2} timed out`);
            await saveResult(id1, false);
            await saveResult(id2, false);
          }
        }

        // Check if tournament can be fully resolved
        // Find finalists (players who won their semi-final)
        const finalists: number[] = [];
        for (const prog of allProg) {
          if (this.isPlayerInFinalPhase(prog, allProg, tournament)) {
            finalists.push(prog.userId);
          }
        }

        // Check final timeout between finalists
        if (finalists.length === 2) {
          const f1 = finalists[0], f2 = finalists[1];
          const f1Finished = playerFinishedCurrentRound(f1);
          const f2Finished = playerFinishedCurrentRound(f2);
          const f1Timeout = !f1Finished && isTimedOut(f1);
          const f2Timeout = !f2Finished && isTimedOut(f2);

          if (f1Finished && f2Timeout) {
            this.logger.log(`[closeTimedOutRounds] T${tournament.id} final: ${f2} timed out, ${f1} wins`);
            await saveResult(f1, true);
            await saveResult(f2, false);
            tournamentResolved = true;
          } else if (f2Finished && f1Timeout) {
            this.logger.log(`[closeTimedOutRounds] T${tournament.id} final: ${f1} timed out, ${f2} wins`);
            await saveResult(f2, true);
            await saveResult(f1, false);
            tournamentResolved = true;
          } else if (f1Timeout && f2Timeout) {
            this.logger.log(`[closeTimedOutRounds] T${tournament.id} final: both finalists timed out`);
            await saveResult(f1, false);
            await saveResult(f2, false);
            tournamentResolved = true;
          }
        } else if (finalists.length === 1) {
          // Only one finalist emerged (the other semi had both timeout or one timeout)
          const fId = finalists[0];
          const fFinished = playerFinishedCurrentRound(fId);
          const fTimeout = !fFinished && isTimedOut(fId);

          // Check if the other semi-final is fully resolved (both timed out or one lost)
          const fSlot = order.indexOf(fId);
          const otherPair: [number, number] = fSlot < 2 ? [2, 3] : [0, 1];
          const oid1 = otherPair[0] < order.length ? order[otherPair[0]] : -1;
          const oid2 = otherPair[1] < order.length ? order[otherPair[1]] : -1;
          const bothOtherTimedOut = (oid1 <= 0 || isTimedOut(oid1)) && (oid2 <= 0 || isTimedOut(oid2));

          if (bothOtherTimedOut && fFinished) {
            this.logger.log(`[closeTimedOutRounds] T${tournament.id}: sole finalist ${fId} wins (other semi timed out)`);
            await saveResult(fId, true);
            if (oid1 > 0) await saveResult(oid1, false);
            if (oid2 > 0) await saveResult(oid2, false);
            tournamentResolved = true;
          } else if (bothOtherTimedOut && fTimeout) {
            this.logger.log(`[closeTimedOutRounds] T${tournament.id}: sole finalist ${fId} also timed out, no winner`);
            await saveResult(fId, false);
            if (oid1 > 0) await saveResult(oid1, false);
            if (oid2 > 0) await saveResult(oid2, false);
            tournamentResolved = true;
          }
        }

        if (tournamentResolved) {
          tournament.status = TournamentStatus.FINISHED;
          await this.tournamentRepository.save(tournament);
          if (tournament.gameType === 'money') {
            await this.processTournamentEscrow(tournament.id);
          }
        }
      } catch (err) {
        this.logger.error(`[closeTimedOutRounds] Error for tournament ${tournament.id}`, err);
      }
    }
  }

  /** Находит все турниры за деньги с эскроу в статусе held и дедлайном в прошлом, обрабатывает их (возврат или выплата). */
  private async processAllExpiredEscrows(): Promise<void> {
    const held = await this.tournamentEscrowRepository.find({ where: { status: 'held' } });
    const tournamentIds = [...new Set(held.map((e) => e.tournamentId))];
    for (const tid of tournamentIds) {
      try {
        const tournament = await this.tournamentRepository.findOne({ where: { id: tid } });
        if (!tournament || tournament.gameType !== 'money') continue;
        if (tournament.status !== TournamentStatus.FINISHED) continue;
        await this.processTournamentEscrow(tid);
      } catch (err) {
        console.error('[processAllExpiredEscrows] tournament', tid, err);
      }
    }
  }

  /** Обрабатывает эскроу: выплата победителю или возврат при истечении времени. */
  private async processTournamentEscrow(tournamentId: number): Promise<void> {
    const tournament = await this.tournamentRepository.findOne({
      where: { id: tournamentId },
      relations: ['players'],
    });
    if (!tournament || tournament.gameType !== 'money') return;
    this.sortPlayersByOrder(tournament);

    // Atomic claim: only one cluster instance gets the rows
    const claimed: { id: number; userId: number; amount: number }[] =
      await this.tournamentEscrowRepository.query(
        'UPDATE tournament_escrow SET status = \'processing\' WHERE "tournamentId" = $1 AND status = \'held\' RETURNING id, "userId", amount',
        [tournamentId],
      );
    if (!claimed || claimed.length === 0) return;

    if (tournament.status !== TournamentStatus.FINISHED) {
      await this.tournamentEscrowRepository.query(
        'UPDATE tournament_escrow SET status = \'held\' WHERE "tournamentId" = $1 AND status = \'processing\'',
        [tournamentId],
      );
      return;
    }

    const results = await this.tournamentResultRepository.find({
      where: { tournamentId },
    });
    const winners = results.filter((r) => r.passed === 1).map((r) => r.userId);

    const leagueAmount = tournament.leagueAmount ?? 0;
    const prize = getLeaguePrize(leagueAmount);

    if (winners.length === 1) {
      const winnerId = winners[0]!;
      await this.usersService.addToBalanceL(
        winnerId,
        prize,
        `Выигрыш за турнир, ${getLeagueName(leagueAmount)}, ID ${tournamentId}`,
        'win',
        tournamentId,
      );
      await this.usersService.distributeReferralRewards(winnerId, leagueAmount, tournamentId);
      await this.tournamentEscrowRepository.query(
        'UPDATE tournament_escrow SET status = \'paid_to_winner\' WHERE "tournamentId" = $1 AND status = \'processing\'',
        [tournamentId],
      );
    } else {
      for (const row of claimed) {
        await this.usersService.addToBalanceL(
          row.userId,
          row.amount,
          `${getLeagueName(leagueAmount)}, ID ${tournamentId}`,
          'refund',
          tournamentId,
        );
      }
      await this.tournamentEscrowRepository.query(
        'UPDATE tournament_escrow SET status = \'refunded\' WHERE "tournamentId" = $1 AND status = \'processing\'',
        [tournamentId],
      );
    }
  }

  private shuffle<T>(arr: T[]): T[] {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  private async pickFromDB(n: number): Promise<{ question: string; options: string[]; correctAnswer: number }[]> {
    const rows = await this.questionPoolRepository
      .createQueryBuilder('q')
      .orderBy('RANDOM()')
      .limit(n * 3)
      .getMany();
    const seen = new Set<string>();
    const unique: typeof rows = [];
    for (const r of rows) {
      if (seen.has(r.question)) continue;
      seen.add(r.question);
      unique.push(r);
      if (unique.length >= n) break;
    }
    return this.shuffle(unique).slice(0, n).map((r) => ({
      question: r.question,
      options: r.options,
      correctAnswer: r.correctAnswer,
    }));
  }

  private async pickRandomQuestions(n: number): Promise<Omit<Question, 'id' | 'tournament' | 'roundIndex'>[]> {
    return this.pickFromDB(n);
  }

  private async pickQuestionsForSemi(): Promise<{
    semi1: Omit<Question, 'id' | 'tournament' | 'roundIndex'>[];
    semi2: Omit<Question, 'id' | 'tournament' | 'roundIndex'>[];
  }> {
    const semiQuestions = await this.pickFromDB(10);
    return {
      semi1: semiQuestions,
      semi2: this.shuffle([...semiQuestions]),
    };
  }

  private async pickQuestionsForFinal(): Promise<Omit<Question, 'id' | 'tournament' | 'roundIndex'>[]> {
    return this.pickFromDB(10);
  }

  /** Тренировка: присоединиться к существующему турниру или создать новый (до 4 игроков, как money-режим, но без ставки). */
  async startTraining(userId: number): Promise<{
    tournamentId: number;
    gameStartedAt: string;
    deadline: string;
    questionsSemi1: { id: number; question: string; options: string[]; correctAnswer: number }[];
    questionsSemi2: { id: number; question: string; options: string[]; correctAnswer: number }[];
    questionsFinal: { id: number; question: string; options: string[]; correctAnswer: number }[];
    playerSlot: number;
    totalPlayers: number;
    semiIndex: number;
    isCreator: boolean;
  }> {
    const user = await this.userRepository.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('User not found');

    const now = new Date();
    const waitingTournaments = await this.tournamentRepository.find({
      where: { status: TournamentStatus.WAITING, gameType: 'training' },
      relations: ['players'],
    });
    const waitingIds = waitingTournaments.map((t) => t.id);
    const waitingEntries = waitingIds.length > 0
      ? await this.tournamentEntryRepository.find({ where: { tournament: { id: In(waitingIds) } } as any })
      : [];
    const waitingProgress = waitingIds.length > 0
      ? await this.tournamentProgressRepository.find({ where: { tournamentId: In(waitingIds) } })
      : [];
    const lastActivityByTid = new Map<number, Date>();
    for (const e of waitingEntries) {
      const tid = (e as any).tournamentId ?? (e.tournament as any)?.id;
      if (!tid) continue;
      const prev = lastActivityByTid.get(tid);
      if (!prev || e.joinedAt > prev) lastActivityByTid.set(tid, e.joinedAt);
    }
    for (const p of waitingProgress) {
      if (p.leftAt) {
        const prev = lastActivityByTid.get(p.tournamentId);
        if (!prev || p.leftAt > prev) lastActivityByTid.set(p.tournamentId, p.leftAt);
      }
    }
    const waitingTournament = waitingTournaments.find((t) => {
      if (t.players.some((p) => p.id === userId)) return false;
      // Check for vacant slot or room for new player
      const hasVacantSlot = t.playerOrder?.includes(-1) ?? false;
      if (!hasVacantSlot && t.players.length >= 4) return false;
      return true;
    });

    let tournament: Tournament;
    let playerSlot: number;
    let isCreator: boolean;
    const joinedAt = new Date();

    if (waitingTournament) {
      tournament = waitingTournament;
      tournament.players.push(user);
      // Fill vacant slot (-1) if available, otherwise append
      const vacantIdx = tournament.playerOrder?.indexOf(-1) ?? -1;
      if (vacantIdx >= 0 && tournament.playerOrder) {
        tournament.playerOrder[vacantIdx] = user.id;
        playerSlot = vacantIdx;
      } else {
        tournament.playerOrder = [...(tournament.playerOrder ?? []), user.id];
        playerSlot = tournament.playerOrder.length - 1;
      }
      isCreator = false;
      await this.tournamentRepository.save(tournament);
      await this.tournamentEntryRepository.save(
        this.tournamentEntryRepository.create({ tournament, user, joinedAt }),
      );
    } else {
      tournament = this.tournamentRepository.create({
        status: TournamentStatus.WAITING,
        players: [user],
        gameType: 'training',
        playerOrder: [user.id],
      });
      await this.tournamentRepository.save(tournament);
      playerSlot = 0;
      isCreator = true;
      const { semi1, semi2 } = await this.pickQuestionsForSemi();
      for (const q of semi1) {
        const row = this.questionRepository.create({ ...q, tournament, roundIndex: 0 });
        await this.questionRepository.save(row);
      }
      for (const q of semi2) {
        const row = this.questionRepository.create({ ...q, tournament, roundIndex: 1 });
        await this.questionRepository.save(row);
      }
      await this.tournamentEntryRepository.save(
        this.tournamentEntryRepository.create({ tournament, user, joinedAt }),
      );
    }

    const toDto = (q: { id: number; question: string; options: string[]; correctAnswer: number }) => ({
      id: q.id, question: q.question, options: q.options, correctAnswer: q.correctAnswer,
    });

    let questions = await this.questionRepository.find({
      where: { tournament: { id: tournament.id } },
      order: { roundIndex: 'ASC', id: 'ASC' },
    });
    if (questions.filter((q) => q.roundIndex === 0).length === 0) {
      const generated = await this.pickQuestionsForSemi();
      for (const q of generated.semi1) {
        const row = this.questionRepository.create({ ...q, tournament, roundIndex: 0 });
        await this.questionRepository.save(row);
      }
      for (const q of generated.semi2) {
        const row = this.questionRepository.create({ ...q, tournament, roundIndex: 1 });
        await this.questionRepository.save(row);
      }
      questions = await this.questionRepository.find({
        where: { tournament: { id: tournament.id } },
        order: { roundIndex: 'ASC', id: 'ASC' },
      });
    }
    const questionsSemi1 = questions.filter((q) => q.roundIndex === 0).map(toDto);
    const questionsSemi2 = questions.filter((q) => q.roundIndex === 1).map(toDto);

    const semiIndex = playerSlot < 2 ? 0 : 1;
    const gameStartedAt = tournament.createdAt;
    const deadline = this.getRoundDeadline(tournament.createdAt);

    return {
      tournamentId: tournament.id,
      gameStartedAt: gameStartedAt.toISOString(),
      deadline,
      questionsSemi1,
      questionsSemi2,
      questionsFinal: [],
      playerSlot,
      totalPlayers: tournament.players.length,
      semiIndex,
      isCreator,
    };
  }

  async createTournament(userId: number): Promise<{ tournamentId: number; playerSlot: number; questions: any[] }> {
    const waitingTournament = await this.tournamentRepository.findOne({
      where: { status: TournamentStatus.WAITING },
      relations: ['players'],
    });

    let tournament: Tournament;
    let playerSlot: number;

    if (waitingTournament && waitingTournament.players.length < 4) {
      tournament = waitingTournament;
      const user = await this.userRepository.findOneBy({ id: userId });
      if (!user) throw new NotFoundException('User not found');
      tournament.players.push(user);
      playerSlot = tournament.players.length - 1;
      await this.tournamentRepository.save(tournament);
    } else {
      const user = await this.userRepository.findOneBy({ id: userId });
      if (!user) throw new NotFoundException('User not found');
      tournament = this.tournamentRepository.create({
        status: TournamentStatus.WAITING,
        players: [user],
      });
      await this.tournamentRepository.save(tournament);
      playerSlot = 0;
      const questions = (await this.pickFromDB(10)).map((q, i) => ({ ...q, roundIndex: 0 }));
      for (const q of questions) {
        const question = this.questionRepository.create({ ...q, tournament });
        await this.questionRepository.save(question);
      }
    }

    const questions = await this.questionRepository.find({
      where: { tournament: { id: tournament.id } },
      select: ['id', 'question', 'options'],
    });

    return {
      tournamentId: tournament.id,
      playerSlot,
      questions,
    };
  }

  /** Победы по лигам: сколько раз пользователь победил (passed=1) в турнирах с данным leagueAmount. */
  async getLeagueWins(userId: number): Promise<Map<number, number>> {
    try {
      const rows = await this.tournamentResultRepository.manager.query(
        `SELECT t."leagueAmount" as "leagueAmount", COUNT(*) as wins
         FROM tournament_result r
         INNER JOIN tournament t ON t.id = r."tournamentId"
         WHERE r."userId" = $1 AND r.passed = 1 AND t."gameType" = 'money' AND t."leagueAmount" IS NOT NULL
         GROUP BY t."leagueAmount"`,
        [userId],
      );
      const map = new Map<number, number>();
      for (const row of rows as { leagueAmount: number; wins: number }[]) {
        const amt = Number(row.leagueAmount);
        if (!Number.isNaN(amt)) map.set(amt, Number(row.wins) || 0);
      }
      return map;
    } catch {
      return new Map<number, number>();
    }
  }

  /** Лиги, доступные пользователю: баланс ≥ 10×ставка; для лиги > 5 L — 10 побед в предыдущей. */
  async getAllowedLeagues(userId: number): Promise<{
    allLeagues: number[];
    allowedLeagues: number[];
    balance: number;
    leagueWins: Record<number, number>;
    playersOnlineByLeague: Record<number, number>;
  }> {
    const user = await this.userRepository.findOneBy({ id: userId });
    if (!user) throw new BadRequestException('User not found');
    const balance = Number(user.balance ?? 0) || 0;
    const leagueWins = await this.getLeagueWins(userId);
    const wins = (amt: number) => leagueWins.get(amt) ?? 0;

    const allowedLeagues: number[] = [];
    for (let i = 0; i < LEAGUE_AMOUNTS.length; i++) {
      const amount = LEAGUE_AMOUNTS[i]!;
      const minBalance = getMinBalanceForLeague(i, amount);
      if (balance < minBalance) continue;

      const prevAmount = i > 0 ? LEAGUE_AMOUNTS[i - 1]! : null;
      if (prevAmount != null) {
        if (wins(prevAmount) < LEAGUE_WINS_TO_UNLOCK) continue;
      }
      allowedLeagues.push(amount);
    }
    const winsObj: Record<number, number> = {};
    leagueWins.forEach((v, k) => { winsObj[k] = v; });

    const playersOnlineByLeague = await this.getPlayersOnlineByLeague();
    return {
      allLeagues: [...LEAGUE_AMOUNTS],
      allowedLeagues,
      balance,
      leagueWins: winsObj,
      playersOnlineByLeague,
    };
  }

  /** Максимальная лига по условиям для пользователя (баланс + победы). */
  private getMaxAllowedLeague(balance: number, winsByLeague: Map<number, number>): number | null {
    const wins = (amt: number) => winsByLeague.get(amt) ?? 0;
    let maxAmount: number | null = null;
    for (let i = 0; i < LEAGUE_AMOUNTS.length; i++) {
      const amount = LEAGUE_AMOUNTS[i]!;
      const minBalance = getMinBalanceForLeague(i, amount);
      if (balance < minBalance) break;
      const prevAmount = i > 0 ? LEAGUE_AMOUNTS[i - 1]! : null;
      if (prevAmount != null && wins(prevAmount) < LEAGUE_WINS_TO_UNLOCK) break;
      maxAmount = amount;
    }
    return maxAmount;
  }

  /** Интервал (мс), в течение которого пользователь считается «в кабинете». */
  private static readonly CABINET_ONLINE_MS = 2 * 60 * 1000;

  /** Количество уникальных игроков «онлайн» по лиге: только те, у кого лига — макс. по условиям и кто сейчас в личном кабинете. */
  async getPlayersOnlineByLeague(): Promise<Record<number, number>> {
    const tournaments = await this.tournamentRepository.find({
      where: { status: TournamentStatus.WAITING, gameType: 'money' },
      relations: ['players'],
    });
    const userIds = new Set<number>();
    for (const t of tournaments) {
      for (const p of t.players ?? []) {
        userIds.add(p.id);
      }
    }
    if (userIds.size === 0) {
      return LEAGUE_AMOUNTS.reduce<Record<number, number>>((acc, amt) => ({ ...acc, [amt]: 0 }), {});
    }
    const users = await this.userRepository.find({
      where: { id: In([...userIds]) },
      select: ['id', 'balance', 'lastCabinetSeenAt'],
    });
    const now = Date.now();
    const cutoff = new Date(now - TournamentsService.CABINET_ONLINE_MS);
    const inCabinetIds = new Set(
      users
        .filter((u) => u.lastCabinetSeenAt != null && new Date(u.lastCabinetSeenAt) >= cutoff)
        .map((u) => u.id),
    );
    const balanceByUser = new Map(users.map((u) => [u.id, Number(u.balance ?? 0) || 0]));
    const userIdArr = [...userIds];
    const winsRows = await this.tournamentResultRepository.manager.query(
      `SELECT r."userId" as "userId", t."leagueAmount" as "leagueAmount", COUNT(*) as wins
       FROM tournament_result r
       INNER JOIN tournament t ON t.id = r."tournamentId"
       WHERE r.passed = 1 AND t."gameType" = 'money' AND t."leagueAmount" IS NOT NULL AND r."userId" IN (${userIdArr.map((_, i) => `$${i + 1}`).join(',')})
       GROUP BY r."userId", t."leagueAmount"`,
      userIdArr,
    );
    const winsByUserAndLeague = new Map<string, number>();
    for (const row of winsRows as { userId: number; leagueAmount: number; wins: number }[]) {
      winsByUserAndLeague.set(`${row.userId}:${row.leagueAmount}`, Number(row.wins) || 0);
    }
    const maxLeagueByUser = new Map<number, number | null>();
    for (const uid of userIds) {
      const balance = balanceByUser.get(uid) ?? 0;
      const winsByLeague = new Map<number, number>();
      for (const amount of LEAGUE_AMOUNTS) {
        const w = winsByUserAndLeague.get(`${uid}:${amount}`) ?? 0;
        winsByLeague.set(amount, w);
      }
      const max = this.getMaxAllowedLeague(balance, winsByLeague);
      maxLeagueByUser.set(uid, max);
    }
    // Онлайн в лиге L = кол-во игроков, у которых макс. лига по условиям = L (учитываем всех в очереди, не только турниры лиги L)
    const countByLeague: Record<number, number> = {};
    for (const amt of LEAGUE_AMOUNTS) {
      countByLeague[amt] = 0;
    }
    for (const uid of userIds) {
      if (!inCabinetIds.has(uid)) continue;
      const maxLeague = maxLeagueByUser.get(uid);
      if (maxLeague != null) {
        countByLeague[maxLeague] = (countByLeague[maxLeague] ?? 0) + 1;
      }
    }
    return countByLeague;
  }

  /**
   * Турнир на людей: присоединиться в первый свободный слот (сначала полуфинал 1, потом полуфинал 2)
   * или создать новый турнир с 2 полуфиналами (4 места), если нет свободного.
   * Пользователь не может зайти в турнир, в котором уже участвует (отыграл или ждёт).
   * Лига ограничена: баланс ≥ 10×ставка, для лиг > 5 L — 10 побед в предыдущей лиге.
   */
  async joinOrCreateMoneyTournament(userId: number, leagueAmount: number): Promise<{
    tournamentId: number;
    playerSlot: number;
    totalPlayers: number;
    semiIndex: number;
    positionInSemi: number;
    isCreator: boolean;
    gameStartedAt: string;
    deadline: string;
  }> {
    const { allowedLeagues, balance } = await this.getAllowedLeagues(userId);
    if (!allowedLeagues.includes(leagueAmount)) {
      const idx = LEAGUE_AMOUNTS.indexOf(leagueAmount);
      const minBalance = idx >= 0 ? getMinBalanceForLeague(idx, leagueAmount) : leagueAmount * LEAGUE_MIN_BALANCE_MULTIPLIER;
      if (balance < minBalance) {
        throw new BadRequestException(
          `Недостаточно средств. Для лиги ${leagueAmount} L нужен баланс минимум ${minBalance} L.`,
        );
      }
      const prevAmount = idx > 0 ? LEAGUE_AMOUNTS[idx - 1]! : null;
      if (prevAmount != null) {
        const wins = (await this.getLeagueWins(userId)).get(prevAmount) ?? 0;
        throw new BadRequestException(
          `Лига ${leagueAmount} L недоступна. Нужно 10 побед в лиге ${prevAmount} L (у вас ${wins}).`,
        );
      }
      throw new BadRequestException(`Лига ${leagueAmount} L недоступна.`);
    }
    if (balance < leagueAmount) {
      throw new BadRequestException('Недостаточно средств на балансе для вступления в игру.');
    }

    const user = await this.userRepository.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('User not found');

    // Auto-cleanup: mark expired waiting tournaments for this user as finished
    const expiredEntries = await this.tournamentEntryRepository.find({
      where: {
        user: { id: userId },
        tournament: { status: TournamentStatus.WAITING, gameType: 'money', leagueAmount },
      },
      relations: ['tournament'],
    });
    for (const entry of expiredEntries) {
      if (!entry.tournament) continue;
      const dl = this.getWaitingDeadline(entry.tournament.createdAt ?? new Date());
      if (new Date(dl) < new Date()) {
        entry.tournament.status = TournamentStatus.FINISHED;
        await this.tournamentRepository.save(entry.tournament);
      }
    }

    const waitingTournaments = await this.tournamentRepository.find({
      where: { status: TournamentStatus.WAITING, gameType: 'money' },
      relations: ['players'],
    });
    const now = new Date();
    const moneyWaitingIds = waitingTournaments.map((t) => t.id);
    const moneyWaitingEntries = moneyWaitingIds.length > 0
      ? await this.tournamentEntryRepository.find({ where: { tournament: { id: In(moneyWaitingIds) } } as any })
      : [];
    const moneyWaitingProgress = moneyWaitingIds.length > 0
      ? await this.tournamentProgressRepository.find({ where: { tournamentId: In(moneyWaitingIds) } })
      : [];
    const moneyLastActivityByTid = new Map<number, Date>();
    for (const e of moneyWaitingEntries) {
      const tid = (e as any).tournamentId ?? (e.tournament as any)?.id;
      if (!tid) continue;
      const prev = moneyLastActivityByTid.get(tid);
      if (!prev || e.joinedAt > prev) moneyLastActivityByTid.set(tid, e.joinedAt);
    }
    for (const p of moneyWaitingProgress) {
      if (p.leftAt) {
        const prev = moneyLastActivityByTid.get(p.tournamentId);
        if (!prev || p.leftAt > prev) moneyLastActivityByTid.set(p.tournamentId, p.leftAt);
      }
    }
    const waitingTournament = waitingTournaments.find((t) => {
      if ((t.leagueAmount ?? 0) !== leagueAmount) return false;
      if (t.players.some((p) => p.id === userId)) return false;
      const hasVacantSlot = t.playerOrder?.includes(-1) ?? false;
      if (!hasVacantSlot && t.players.length >= 4) return false;
      return true;
    });

    let tournament: Tournament;
    let playerSlot: number;
    let isCreator: boolean;

    const joinedAt = new Date();

    if (waitingTournament) {
      tournament = waitingTournament;
      tournament.players.push(user);
      const vacantIdx = tournament.playerOrder?.indexOf(-1) ?? -1;
      if (vacantIdx >= 0 && tournament.playerOrder) {
        tournament.playerOrder[vacantIdx] = user.id;
        playerSlot = vacantIdx;
      } else {
        tournament.playerOrder = [...(tournament.playerOrder ?? []), user.id];
        playerSlot = tournament.playerOrder.length - 1;
      }
      isCreator = false;
      await this.tournamentRepository.save(tournament);
      await this.tournamentEntryRepository.save(
        this.tournamentEntryRepository.create({ tournament, user, joinedAt }),
      );
    } else {
      tournament = this.tournamentRepository.create({
        status: TournamentStatus.WAITING,
        players: [user],
        gameType: 'money',
        leagueAmount,
        playerOrder: [user.id],
      });
      await this.tournamentRepository.save(tournament);
      playerSlot = 0;
      isCreator = true;
      const { semi1, semi2 } = await this.pickQuestionsForSemi();
      for (const q of semi1) {
        const row = this.questionRepository.create({ ...q, tournament, roundIndex: 0 });
        await this.questionRepository.save(row);
      }
      for (const q of semi2) {
        const row = this.questionRepository.create({ ...q, tournament, roundIndex: 1 });
        await this.questionRepository.save(row);
      }
      await this.tournamentEntryRepository.save(
        this.tournamentEntryRepository.create({ tournament, user, joinedAt }),
      );
    }

    try {
      await this.usersService.deductBalance(
        userId,
        leagueAmount,
        `${getLeagueName(leagueAmount)}, ID ${tournament.id}`,
        'loss',
        tournament.id,
      );
    } catch (e) {
      if (waitingTournament) {
        tournament.players = tournament.players.filter((p) => p.id !== userId);
        await this.tournamentRepository.save(tournament);
        const entry = await this.tournamentEntryRepository.findOne({
          where: { tournament: { id: tournament.id }, user: { id: userId } },
        });
        if (entry) await this.tournamentEntryRepository.remove(entry);
      } else {
        await this.tournamentRepository.remove(tournament);
      }
      throw e;
    }

    await this.tournamentEscrowRepository.save(
      this.tournamentEscrowRepository.create({
        userId,
        tournamentId: tournament.id,
        amount: leagueAmount,
        status: 'held',
      }),
    );

    const semiIndex = playerSlot < 2 ? 0 : 1;
    const positionInSemi = playerSlot % 2;

    return {
      tournamentId: tournament.id,
      playerSlot,
      totalPlayers: tournament.players.length,
      semiIndex,
      positionInSemi,
      isCreator,
      gameStartedAt: joinedAt.toISOString(),
      deadline: this.getRoundDeadline(tournament.createdAt),
    };
  }

  async getMyTournaments(
    userId: number,
    mode?: 'training' | 'money',
    currentTournamentId?: number,
  ): Promise<{
    active: { id: number; status: string; createdAt: string; playersCount: number; leagueAmount: number | null; deadline: string; userStatus: 'passed' | 'not_passed'; stage?: string; resultLabel?: string; roundForQuestions: 'semi' | 'final'; questionsAnswered: number; questionsTotal: number; correctAnswersInRound: number; roundFinished?: boolean; roundStartedAt?: string | null }[];
    completed: { id: number; status: string; createdAt: string; playersCount: number; leagueAmount: number | null; userStatus: 'passed' | 'not_passed'; stage?: string; resultLabel?: string; roundForQuestions: 'semi' | 'final'; questionsAnswered: number; questionsTotal: number; correctAnswersInRound: number; completedAt?: string | null; roundStartedAt?: string | null }[];
  }> {
    await this.tournamentRepository
      .createQueryBuilder()
      .update(Tournament)
      .set({ gameType: 'training' })
      .where('gameType IS NULL')
      .execute();

    if (mode === 'money') {
      await this.processAllExpiredEscrows();
    }

    const qb = this.tournamentRepository
      .createQueryBuilder('t')
      .innerJoinAndSelect('t.players', 'p', 'p.id = :userId', { userId })
      .orderBy('t.createdAt', 'DESC');
    if (mode === 'training') {
      qb.andWhere('t.gameType = :gameType', { gameType: 'training' });
    } else if (mode === 'money') {
      qb.andWhere('t.gameType = :gameType', { gameType: 'money' });
    }
    const tournaments = await qb.getMany();

    const allIds = tournaments.map((t) => t.id);
    const resultByTournamentId = new Map<number, boolean>();
    const completedAtByTid = new Map<number, string | null>();
    if (allIds.length > 0) {
      const results = await this.tournamentResultRepository.find({
        where: { userId, tournamentId: In(allIds) },
      });
      for (const r of results) {
        resultByTournamentId.set(r.tournamentId, r.passed === 1);
        completedAtByTid.set(r.tournamentId, r.completedAt ? (r.completedAt instanceof Date ? r.completedAt.toISOString() : String(r.completedAt)) : null);
      }
    }

    const deadlineByTournamentId: Record<number, string> = {};
    const roundStartedAtByTid = new Map<number, string | null>();
    const playerRoundFinished = new Map<number, boolean>();
    if (allIds.length > 0) {
      const allProgress = await this.tournamentProgressRepository
        .createQueryBuilder('p')
        .where('p.tournamentId IN (:...ids)', { ids: allIds })
        .getMany();

      const entriesByTid = new Map<number, Date>();
      if (allIds.length > 0) {
        const allEntries = await this.tournamentEntryRepository.find({ where: { user: { id: userId } } as any });
        for (const e of allEntries) {
          const tid2 = (e as any).tournamentId ?? (e.tournament as any)?.id;
          if (tid2 && e.joinedAt) entriesByTid.set(tid2, e.joinedAt);
        }
      }
      for (const tid of allIds) {
        const myProg = allProgress.find((p) => p.tournamentId === tid && p.userId === userId);
        const roundStart = myProg?.roundStartedAt ?? entriesByTid.get(tid) ?? null;
        deadlineByTournamentId[tid] = roundStart
          ? this.getRoundDeadline(roundStart)
          : this.getRoundDeadline(new Date());
        roundStartedAtByTid.set(tid, myProg?.roundStartedAt ? myProg.roundStartedAt.toISOString() : null);
      }

      // Determine if player has finished current round (no timer needed)
      const hasOtherFinalist = (t: Tournament): boolean => {
        const order = t.playerOrder;
        if (!order || order.length < 4) return false;
        const pSlot = order.indexOf(userId);
        if (pSlot < 0) return false;
        const os: [number, number] = pSlot < 2 ? [2, 3] : [0, 1];
        const id1 = order[os[0]]; const id2 = order[os[1]];
        if (id1 == null || id2 == null || id1 <= 0 || id2 <= 0) return false;
        const pr1 = allProgress.find((p) => p.tournamentId === t.id && p.userId === id1);
        const pr2 = allProgress.find((p) => p.tournamentId === t.id && p.userId === id2);
        if (!pr1 || !pr2) return false;
        if ((pr1.questionsAnsweredCount ?? 0) < 10 || (pr2.questionsAnsweredCount ?? 0) < 10) return false;
        const s1 = pr1.semiFinalCorrectCount ?? 0;
        const s2 = pr2.semiFinalCorrectCount ?? 0;
        if (s1 !== s2) return true;
        const tb1 = pr1.tiebreakerRoundsCorrect ?? [];
        const tb2 = pr2.tiebreakerRoundsCorrect ?? [];
        for (let r = 0; r < Math.max(tb1.length, tb2.length); r++) {
          if ((tb1[r] ?? 0) !== (tb2[r] ?? 0)) return true;
        }
        return false;
      };

      for (const tid of allIds) {
        const myProg = allProgress.find((p) => p.tournamentId === tid && p.userId === userId);
        if (!myProg) { playerRoundFinished.set(tid, false); continue; }
        const t = tournaments.find((t2) => t2.id === tid);
        if (!t) { playerRoundFinished.set(tid, false); continue; }
        this.sortPlayersByOrder(t);
        const playerSlot = t.playerOrder?.indexOf(userId) ?? -1;
        const oppSlot = playerSlot >= 0 ? (playerSlot % 2 === 0 ? playerSlot + 1 : playerSlot - 1) : -1;
        const oppId = oppSlot >= 0 && t.playerOrder && oppSlot < t.playerOrder.length ? t.playerOrder[oppSlot] : null;
        const oppProg = oppId != null && oppId > 0 ? allProgress.find((p) => p.tournamentId === tid && p.userId === oppId) : null;

        const myQ = myProg.questionsAnsweredCount ?? 0;
        const mySemi = myProg.semiFinalCorrectCount;
        const myTBLen = (myProg.tiebreakerRoundsCorrect ?? []).length;
        const mySemiTotal = 10 + myTBLen * 10;

        if (myQ < 10) {
          playerRoundFinished.set(tid, false);
        } else if (oppId == null || oppId <= 0) {
          const realPlayers = (t.playerOrder?.filter((id: number) => id > 0).length) ?? 0;
          if (realPlayers <= 2) {
            playerRoundFinished.set(tid, myQ >= 10);
          } else {
            if (myQ >= mySemiTotal + 10) { playerRoundFinished.set(tid, true); }
            else if (myQ >= 10 && myQ < mySemiTotal + 10) { playerRoundFinished.set(tid, false); }
            else { playerRoundFinished.set(tid, myQ >= 10); }
          }
        } else if (mySemi != null && oppProg?.semiFinalCorrectCount != null && mySemi === oppProg.semiFinalCorrectCount) {
          const myTB = myProg.tiebreakerRoundsCorrect ?? [];
          const oppTB = oppProg.tiebreakerRoundsCorrect ?? [];
          let tbWon = false;
          let tbLost = false;
          for (let r = 0; r < Math.max(myTB.length, oppTB.length); r++) {
            if ((myTB[r] ?? 0) > (oppTB[r] ?? 0)) { tbWon = true; break; }
            if ((myTB[r] ?? 0) < (oppTB[r] ?? 0)) { tbLost = true; break; }
          }
          if (tbWon) {
            if (myQ < mySemiTotal) { playerRoundFinished.set(tid, true); }
            else if (myQ >= mySemiTotal + 10) { playerRoundFinished.set(tid, true); }
            else { playerRoundFinished.set(tid, false); }
          } else if (tbLost) {
            playerRoundFinished.set(tid, true);
          } else {
            const oppTBLen = oppTB.length;
            const nextTBEnd = 10 + Math.max(myTBLen, oppTBLen) * 10 + 10;
            playerRoundFinished.set(tid, myQ >= nextTBEnd - 10 && myQ % 10 === 0 && myQ > 10);
          }
        } else if (mySemi != null && oppProg?.semiFinalCorrectCount != null && mySemi > oppProg.semiFinalCorrectCount) {
          if (myQ < mySemiTotal) { playerRoundFinished.set(tid, true); }
          else if (myQ >= mySemiTotal + 10) { playerRoundFinished.set(tid, true); }
          else { playerRoundFinished.set(tid, false); }
        } else {
          playerRoundFinished.set(tid, myQ >= 10);
        }
      }
    }

    const QUESTIONS_PER_ROUND = 10;
    const TIEBREAKER_QUESTIONS = 10;

    type ProgressData = { q: number; semiCorrect: number | null; totalCorrect: number; currentIndex: number; tiebreakerRounds: number[]; finalTiebreakerRounds: number[] };
    const progressByTid = new Map<number, ProgressData>();
    const progressByTidAndUser = new Map<number, Map<number, ProgressData>>();

    if (allIds.length > 0) {
      const allProgressList = await this.tournamentProgressRepository.find({
        where: { tournamentId: In(allIds) },
      });
      let progressList = allProgressList;
      const othersProgress = allProgressList.filter((p) => p.userId !== userId);

      // Backfill: исправляем рассинхрон 9/10 и 19/20 для всех турниров.
      if (allIds.length > 0) {
        await this.tournamentProgressRepository
          .createQueryBuilder()
          .update(TournamentProgress)
          .set({ questionsAnsweredCount: QUESTIONS_PER_ROUND })
          .where('userId = :userId', { userId })
          .andWhere('tournamentId IN (:...ids)', { ids: allIds })
          .andWhere('questionsAnsweredCount = :q', { q: QUESTIONS_PER_ROUND - 1 })
          .andWhere('currentQuestionIndex = :idx', { idx: QUESTIONS_PER_ROUND - 1 })
          .execute();
        await this.tournamentProgressRepository
          .createQueryBuilder()
          .update(TournamentProgress)
          .set({ questionsAnsweredCount: 2 * QUESTIONS_PER_ROUND })
          .where('userId = :userId', { userId })
          .andWhere('tournamentId IN (:...ids)', { ids: allIds })
          .andWhere('questionsAnsweredCount = :q', { q: 2 * QUESTIONS_PER_ROUND - 1 })
          .andWhere('currentQuestionIndex = :idx', { idx: 2 * QUESTIONS_PER_ROUND - 1 })
          .execute();
        await this.tournamentProgressRepository
          .createQueryBuilder()
          .update(TournamentProgress)
          .set({ questionsAnsweredCount: QUESTIONS_PER_ROUND })
          .where('userId = :userId', { userId })
          .andWhere('tournamentId IN (:...ids)', { ids: allIds })
          .andWhere('currentQuestionIndex >= :minIdx', { minIdx: QUESTIONS_PER_ROUND })
          .andWhere('questionsAnsweredCount < :q', { q: QUESTIONS_PER_ROUND })
          .execute();
      }

      // Backfill: если 10 ответов, но semiFinalCorrectCount не установлен — восстанавливаем из correctAnswersCount.
      if (allIds.length > 0) {
        const toFix = await this.tournamentProgressRepository.find({
          where: { userId, tournamentId: In(allIds) },
        });
        for (const p of toFix) {
          if (
            p.questionsAnsweredCount === QUESTIONS_PER_ROUND + 1 &&
            (p.currentQuestionIndex ?? 0) >= QUESTIONS_PER_ROUND &&
            p.semiFinalCorrectCount != null &&
            (p.lockedAnswerCount ?? 0) <= QUESTIONS_PER_ROUND
          ) {
            await this.tournamentProgressRepository.update(
              { id: p.id },
              {
                questionsAnsweredCount: QUESTIONS_PER_ROUND,
                currentQuestionIndex: QUESTIONS_PER_ROUND,
                correctAnswersCount: p.semiFinalCorrectCount,
              },
            );
          } else if (
            p.questionsAnsweredCount === QUESTIONS_PER_ROUND &&
            p.semiFinalCorrectCount == null &&
            p.correctAnswersCount != null
          ) {
            await this.tournamentProgressRepository.update(
              { id: p.id },
              { semiFinalCorrectCount: p.correctAnswersCount },
            );
          }
        }
        // Перечитываем прогресс после backfill, чтобы использовать обновлённые данные.
        const refreshedProgress = await this.tournamentProgressRepository.find({
          where: { userId, tournamentId: In(allIds) },
        });
        progressList = [...refreshedProgress, ...othersProgress.filter((p) => p.userId !== userId)];
      }

      for (const p of progressList) {
        let adjustedQ = p.questionsAnsweredCount;
        if (p.userId === userId) {
          if (p.questionsAnsweredCount === QUESTIONS_PER_ROUND - 1 && p.currentQuestionIndex === QUESTIONS_PER_ROUND - 1) {
            adjustedQ = QUESTIONS_PER_ROUND;
          } else if (p.questionsAnsweredCount === 2 * QUESTIONS_PER_ROUND - 1 && p.currentQuestionIndex === 2 * QUESTIONS_PER_ROUND - 1) {
            adjustedQ = 2 * QUESTIONS_PER_ROUND;
          } else if (p.currentQuestionIndex >= QUESTIONS_PER_ROUND - 1 && adjustedQ < QUESTIONS_PER_ROUND) {
            adjustedQ = QUESTIONS_PER_ROUND;
          } else if (p.currentQuestionIndex >= 2 * QUESTIONS_PER_ROUND - 1 && adjustedQ < 2 * QUESTIONS_PER_ROUND) {
            adjustedQ = 2 * QUESTIONS_PER_ROUND;
          }
          if (p.currentQuestionIndex > 0) {
            adjustedQ = Math.max(adjustedQ, p.currentQuestionIndex);
          }
          if (p.semiFinalCorrectCount != null && adjustedQ < QUESTIONS_PER_ROUND && p.questionsAnsweredCount >= QUESTIONS_PER_ROUND - 2) {
            adjustedQ = Math.max(adjustedQ, QUESTIONS_PER_ROUND);
          }
        }
        const data: ProgressData = {
          q: adjustedQ,
          semiCorrect: p.semiFinalCorrectCount,
          totalCorrect: p.correctAnswersCount ?? 0,
          currentIndex: p.currentQuestionIndex,
          tiebreakerRounds: Array.isArray(p.tiebreakerRoundsCorrect) ? p.tiebreakerRoundsCorrect : [],
          finalTiebreakerRounds: Array.isArray((p as any).finalTiebreakerRoundsCorrect) ? (p as any).finalTiebreakerRoundsCorrect : [],
        };
        if (p.userId === userId) progressByTid.set(p.tournamentId, data);
        if (!progressByTidAndUser.has(p.tournamentId)) {
          progressByTidAndUser.set(p.tournamentId, new Map());
        }
        progressByTidAndUser.get(p.tournamentId)!.set(p.userId, data);
      }
    }

    const lostSemiByTid = new Map<number, boolean>();

    const tidsWithFinalQuestions = new Set<number>();
    if (allIds.length > 0) {
      const fqRows = await this.questionRepository
        .createQueryBuilder('q')
        .select('DISTINCT q.tournamentId', 'tid')
        .where('q.tournamentId IN (:...ids)', { ids: allIds })
        .andWhere('q.roundIndex = 2')
        .getRawMany();
      for (const row of fqRows) tidsWithFinalQuestions.add(Number(row.tid));
    }

    const getPlayerCount = (t: Tournament): number =>
      t.playerOrder?.length ?? t.players?.length ?? 0;

    const getMoneySemiResult = (
      t: Tournament,
    ): { result: 'won' | 'lost' | 'tie' | 'incomplete'; tiebreakerRound?: number } => {
      const order = t.playerOrder;
      if (!order || order.length < 2) return { result: 'incomplete' };
      const playerSlot = order.indexOf(userId);
      if (playerSlot < 0) return { result: 'incomplete' };
      const opponentSlot = playerSlot % 2 === 0 ? playerSlot + 1 : playerSlot - 1;

      const noOpponent =
        opponentSlot < 0 ||
        opponentSlot >= order.length ||
        (order[opponentSlot] ?? -1) <= 0;

      if (noOpponent) {
        const myProgress = progressByTidAndUser.get(t.id)?.get(userId);
        return (myProgress?.q ?? 0) >= QUESTIONS_PER_ROUND
          ? { result: 'won' }
          : { result: 'incomplete' };
      }

      const opponentId = order[opponentSlot];

      const myProgress = progressByTidAndUser.get(t.id)?.get(userId);
      const oppProgress = progressByTidAndUser.get(t.id)?.get(opponentId);
      const myQ = myProgress?.q ?? 0;
      const oppQ = oppProgress?.q ?? 0;
      const mySemi = myProgress?.semiCorrect ?? 0;
      const oppSemi = oppProgress?.semiCorrect ?? 0;
      const myTB = myProgress?.tiebreakerRounds ?? [];
      const oppTB = oppProgress?.tiebreakerRounds ?? [];

      if (myQ < QUESTIONS_PER_ROUND || oppQ < QUESTIONS_PER_ROUND) return { result: 'incomplete' };

      const myTBLenLocal = myTB.length;
      const mySemiTotalLocal = QUESTIONS_PER_ROUND + myTBLenLocal * TIEBREAKER_QUESTIONS;
      if (myQ > mySemiTotalLocal && tidsWithFinalQuestions.has(t.id)) {
        return { result: 'won' };
      }

      if (mySemi > oppSemi) return { result: 'won' };
      if (mySemi < oppSemi) return { result: 'lost' };

      for (let r = 1; r <= 50; r++) {
        const roundEnd = QUESTIONS_PER_ROUND + r * TIEBREAKER_QUESTIONS;
        if (myQ < roundEnd || oppQ < roundEnd) return { result: 'tie', tiebreakerRound: r };
        const myR = myTB[r - 1] ?? 0;
        const oppR = oppTB[r - 1] ?? 0;
        if (myR > oppR) return { result: 'won' };
        if (myR < oppR) return { result: 'lost' };
      }
      return { result: 'tie', tiebreakerRound: 50 };
    };

    const getOtherFinalist = (
      t: Tournament,
    ): ProgressData | null => {
      const order = t.playerOrder;
      if (!order || order.length <= 2) return null;
      const playerSlot = order.indexOf(userId);
      if (playerSlot < 0) return null;
      const otherSlots: [number, number] = playerSlot < 2 ? [2, 3] : [0, 1];
      const p1Id = otherSlots[0] < order.length ? order[otherSlots[0]] : -1;
      const p2Id = otherSlots[1] < order.length ? order[otherSlots[1]] : -1;
      const p1Valid = p1Id != null && p1Id > 0;
      const p2Valid = p2Id != null && p2Id > 0;

      if (!p1Valid && !p2Valid) return null;

      if (p1Valid && p2Valid) {
        const prog1 = progressByTidAndUser.get(t.id)?.get(p1Id);
        const prog2 = progressByTidAndUser.get(t.id)?.get(p2Id);
        const q1 = prog1?.q ?? 0;
        const q2 = prog2?.q ?? 0;
        if (q1 < QUESTIONS_PER_ROUND || q2 < QUESTIONS_PER_ROUND) return null;
        const semi1 = prog1?.semiCorrect ?? 0;
        const semi2 = prog2?.semiCorrect ?? 0;
        if (semi1 > semi2) return prog1!;
        if (semi2 > semi1) return prog2!;
        const tb1 = prog1?.tiebreakerRounds ?? [];
        const tb2 = prog2?.tiebreakerRounds ?? [];
        for (let r = 1; r <= 50; r++) {
          const roundEnd = QUESTIONS_PER_ROUND + r * TIEBREAKER_QUESTIONS;
          if (q1 < roundEnd || q2 < roundEnd) return null;
          const r1 = tb1[r - 1] ?? 0;
          const r2 = tb2[r - 1] ?? 0;
          if (r1 > r2) return prog1!;
          if (r2 > r1) return prog2!;
        }
        return null;
      }

      const soloId = p1Valid ? p1Id : p2Id;
      const soloProg = progressByTidAndUser.get(t.id)?.get(soloId);
      if (!soloProg || (soloProg.q ?? 0) < QUESTIONS_PER_ROUND) return null;
      return soloProg;
    };

    const now = new Date();

    /** Количество вопросов в полуфинальной фазе (10 + тайбрейкеры) */
    const semiPhaseQuestions = (prog: ProgressData): number =>
      QUESTIONS_PER_ROUND + prog.tiebreakerRounds.length * TIEBREAKER_QUESTIONS;

    /** Корректный расчёт верных в финале (без учёта полуфинальных тайбрейкеров) */
    const computeFinalCorrect = (prog: ProgressData): number => {
      const semiTBSum = prog.tiebreakerRounds.reduce((a, b) => a + b, 0);
      return prog.totalCorrect - (prog.semiCorrect ?? 0) - semiTBSum;
    };

    /** Результат финала: won/lost/tie/incomplete */
    const getFinalResult = (
      t: Tournament,
      myProg: ProgressData,
    ): 'won' | 'lost' | 'tie' | 'incomplete' => {
      if (getPlayerCount(t) <= 2) return 'incomplete';
      const otherFin = getOtherFinalist(t);
      if (!otherFin) return 'incomplete';
      const mySemiTotal = semiPhaseQuestions(myProg);
      const oppSemiTotal = QUESTIONS_PER_ROUND + otherFin.tiebreakerRounds.length * TIEBREAKER_QUESTIONS;
      if (myProg.q < mySemiTotal + QUESTIONS_PER_ROUND) return 'incomplete';
      if (otherFin.q < oppSemiTotal + QUESTIONS_PER_ROUND) return 'incomplete';
      const myFC = computeFinalCorrect(myProg);
      const oppFC = computeFinalCorrect(otherFin);
      const myFTBSum = myProg.finalTiebreakerRounds.reduce((a, b) => a + b, 0);
      const oppFTBSum = otherFin.finalTiebreakerRounds.reduce((a, b) => a + b, 0);
      const myFinalBase = myFC - myFTBSum;
      const oppFinalBase = oppFC - oppFTBSum;
      if (myFinalBase > oppFinalBase) return 'won';
      if (myFinalBase < oppFinalBase) return 'lost';
      for (let r = 0; r < Math.max(myProg.finalTiebreakerRounds.length, otherFin.finalTiebreakerRounds.length); r++) {
        const myFTBEnd = mySemiTotal + QUESTIONS_PER_ROUND + (r + 1) * TIEBREAKER_QUESTIONS;
        const oppFTBEnd = oppSemiTotal + QUESTIONS_PER_ROUND + (r + 1) * TIEBREAKER_QUESTIONS;
        if (myProg.q < myFTBEnd || otherFin.q < oppFTBEnd) return 'tie';
        const myR = myProg.finalTiebreakerRounds[r] ?? 0;
        const oppR = otherFin.finalTiebreakerRounds[r] ?? 0;
        if (myR > oppR) return 'won';
        if (myR < oppR) return 'lost';
      }
      return 'tie';
    };

    for (const t of tournaments) {
      const userProgress = progressByTid.get(t.id);
      const answered = userProgress?.q ?? 0;
      let passed: boolean;
      let row = await this.tournamentResultRepository.findOne({ where: { userId, tournamentId: t.id } });

      const realPlayers = (t.playerOrder?.filter((id: number) => id > 0).length) ?? 0;
      const semiResult = getMoneySemiResult(t);

      if (realPlayers < 4) {
        passed = false;
      } else if (semiResult.result === 'lost') {
        lostSemiByTid.set(t.id, true);
        passed = false;
      } else if (semiResult.result === 'tie') {
        passed = false;
      } else if (semiResult.result === 'won' && userProgress) {
        const mySemiTotal = semiPhaseQuestions(userProgress);
        if (answered >= mySemiTotal + QUESTIONS_PER_ROUND) {
          const fr = getFinalResult(t, userProgress);
          if (fr === 'won') passed = true;
          else if (fr === 'lost') passed = false;
          else passed = false;
        } else {
          passed = false;
        }
      } else {
        passed = row?.passed === 1 ? true : false;
      }

      if (row) {
        row.passed = passed ? 1 : 0;
        if (!row.completedAt && t.status === TournamentStatus.FINISHED) row.completedAt = new Date();
        if (t.status !== TournamentStatus.FINISHED && row.completedAt) row.completedAt = null as any;
        await this.tournamentResultRepository.save(row);
      } else {
        row = this.tournamentResultRepository.create({
          userId, tournamentId: t.id, passed: passed ? 1 : 0,
          ...(t.status === TournamentStatus.FINISHED ? { completedAt: new Date() } : {}),
        });
        await this.tournamentResultRepository.save(row);
      }
      completedAtByTid.set(t.id, row.completedAt ? (row.completedAt instanceof Date ? row.completedAt.toISOString() : String(row.completedAt)) : null);
      resultByTournamentId.set(t.id, passed);
    }

    // Backfill: помечаем FINISHED только турниры с подтверждённой победой (после пересчёта).
    const finishedIds = tournaments
      .filter(
        (t) =>
          resultByTournamentId.get(t.id) === true &&
          (t.playerOrder?.length ?? t.players?.length ?? 0) >= 2 &&
          t.status !== TournamentStatus.FINISHED,
      )
      .map((t) => t.id);
    if (finishedIds.length > 0) {
      await this.tournamentRepository.update(
        { id: In(finishedIds) },
        { status: TournamentStatus.FINISHED },
      );
      for (const t of tournaments) {
        if (finishedIds.includes(t.id)) t.status = TournamentStatus.FINISHED;
      }
    }

    // Safety: если турнир FINISHED но сейчас ничья — вернуть в waiting
    const tieButFinished = tournaments.filter(
      (t) =>
        t.status === TournamentStatus.FINISHED &&
        getMoneySemiResult(t).result === 'tie',
    );
    if (tieButFinished.length > 0) {
      const revertIds = tieButFinished.map((t) => t.id);
      await this.tournamentRepository.update(
        { id: In(revertIds) },
        { status: TournamentStatus.WAITING },
      );
      for (const t of tieButFinished) {
        t.status = TournamentStatus.WAITING;
      }
    }

    const getStage = (t: Tournament): string => {
      const semiResult = getMoneySemiResult(t);
      if (semiResult.result === 'tie') return 'Доп. раунд (ПФ)';
      if (semiResult.result === 'won') {
        const prog = progressByTid.get(t.id);
        if (prog) {
          const mySemiTotal = semiPhaseQuestions(prog);
          const answered = prog.q ?? 0;
          if (answered >= mySemiTotal + QUESTIONS_PER_ROUND) {
            const fr = getFinalResult(t, prog);
            if (fr === 'tie') return 'Доп. раунд (Ф)';
          }
        }
        return 'Финал';
      }
      return 'Полуфинал';
    };

    const toItem = (
      t: Tournament,
      deadline: string,
      userStatus: 'passed' | 'not_passed',
      resultLabel: string,
      roundForQuestions?: 'semi' | 'final',
      stageOverride?: string,
    ) => {
      const prog = progressByTid.get(t.id);
      const answered = prog?.q ?? 0;
      const semiCorrect = prog?.semiCorrect ?? (answered <= QUESTIONS_PER_ROUND ? (prog?.totalCorrect ?? 0) : 0);
      const totalCorrect = prog?.totalCorrect ?? 0;
      const tbRounds = prog?.tiebreakerRounds ?? [];
      const stage = stageOverride ?? getStage(t);
      const semiRes = getMoneySemiResult(t);
      const inSemiPhase = semiRes.result !== 'won';
      const round: 'semi' | 'final' =
        roundForQuestions ?? (inSemiPhase ? 'semi' : 'final');

      let questionsAnsweredInRound: number;
      let questionsTotal: number;
      let correctAnswersInRound: number;

      const semiResultForDisplay = getMoneySemiResult(t);
      const isSemiTiebreaker = semiResultForDisplay.result === 'tie';

      if (round === 'semi') {
        const completedTBRounds = tbRounds.length;
        const tbCorrectSum = tbRounds.reduce((a, b) => a + b, 0);
        const answeredAfterSemi = Math.max(0, answered - QUESTIONS_PER_ROUND);
        const answeredInCompletedTB = completedTBRounds * TIEBREAKER_QUESTIONS;
        const inCurrentTBRound = answeredAfterSemi - answeredInCompletedTB;
        const hasTiebreaker = answeredAfterSemi > 0 || completedTBRounds > 0 || isSemiTiebreaker;
        const activeTBRounds = hasTiebreaker
          ? Math.max(1, completedTBRounds + (inCurrentTBRound > 0 ? 1 : 0))
          : 0;

        questionsTotal = QUESTIONS_PER_ROUND + activeTBRounds * TIEBREAKER_QUESTIONS;
        questionsAnsweredInRound = Math.min(answered, questionsTotal);
        correctAnswersInRound = semiCorrect + tbCorrectSum;
      } else {
        const semiTBCount = tbRounds.length;
        const semiTotal = QUESTIONS_PER_ROUND + semiTBCount * TIEBREAKER_QUESTIONS;
        const finalTBRounds = prog?.finalTiebreakerRounds ?? [];
        const finalAnswered = Math.max(0, answered - semiTotal);
        const hasFinalTB = finalTBRounds.length > 0 || finalAnswered > QUESTIONS_PER_ROUND;
        const activeFinalTBRounds = hasFinalTB
          ? Math.max(1, finalTBRounds.length + (finalAnswered > QUESTIONS_PER_ROUND + finalTBRounds.length * TIEBREAKER_QUESTIONS ? 1 : 0))
          : 0;
        questionsTotal = semiTotal + QUESTIONS_PER_ROUND + activeFinalTBRounds * TIEBREAKER_QUESTIONS;
        questionsAnsweredInRound = answered;
        correctAnswersInRound = totalCorrect;
      }
      return {
        id: t.id,
        status: t.status,
        createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : String(t.createdAt),
        playersCount: getPlayerCount(t),
        leagueAmount: t.leagueAmount ?? null,
        deadline,
        userStatus,
        stage,
        resultLabel,
        roundForQuestions: round,
        questionsAnswered: questionsAnsweredInRound,
        questionsTotal,
        correctAnswersInRound,
        completedAt: completedAtByTid.get(t.id) ?? null,
        roundFinished: playerRoundFinished.get(t.id) ?? false,
        roundStartedAt: roundStartedAtByTid.get(t.id) ?? null,
      };
    };

    const isNotInOrder = (t: Tournament): boolean => {
      const order = t.playerOrder;
      if (!order) return false;
      return !order.includes(userId);
    };

    const getRealPlayerCount = (t: Tournament): number =>
      (t.playerOrder?.filter((id: number) => id > 0).length) ?? 0;

    const getResultLabel = (t: Tournament): string => {
      if (isNotInOrder(t)) return 'Время истекло';
      const prog = progressByTid.get(t.id);
      const answered = prog?.q ?? 0;
      const rp = getRealPlayerCount(t);

      if (rp < 4 && t.status === TournamentStatus.FINISHED) {
        if (answered >= QUESTIONS_PER_ROUND) {
          const semiRes4 = getMoneySemiResult(t);
          if (semiRes4.result === 'lost') return 'Поражение';
        }
        return 'Время истекло';
      }

      if (t.status === TournamentStatus.FINISHED) {
        if (answered < QUESTIONS_PER_ROUND) return 'Время истекло';
        if (resultByTournamentId.get(t.id) === true) return 'Победа';
        return 'Поражение';
      }

      if (rp < 4) return 'Ожидание соперника';

      if (answered < QUESTIONS_PER_ROUND) return 'Этап не пройден';

      const semiResult = getMoneySemiResult(t);
      if (semiResult.result === 'incomplete') return 'Ожидание соперника';
      if (semiResult.result === 'tie') {
        const tbRound = semiResult.tiebreakerRound ?? 1;
        const roundEnd = QUESTIONS_PER_ROUND + tbRound * TIEBREAKER_QUESTIONS;
        if (answered >= roundEnd) return 'Ожидание соперника';
        return 'Этап не пройден';
      }
      if (semiResult.result === 'lost') return 'Поражение';
      if (semiResult.result === 'won') {
        if (!prog) return 'Этап не пройден';
        const mySemiTotal = semiPhaseQuestions(prog);
        if (answered < mySemiTotal + QUESTIONS_PER_ROUND) return 'Этап не пройден';
        const fr = getFinalResult(t, prog);
        if (fr === 'won') return 'Победа';
        if (fr === 'lost') return 'Поражение';
        if (fr === 'tie') return 'Этап не пройден';
        return 'Ожидание соперника';
      }
      return 'Ожидание соперника';
    };

    const getUserStatus = (t: Tournament): 'passed' | 'not_passed' => {
      if (getRealPlayerCount(t) < 4) return 'not_passed';
      return resultByTournamentId.get(t.id) === true ? 'passed' : 'not_passed';
    };

    const isTimeExpired = (t: Tournament): boolean => {
      const deadline = deadlineByTournamentId[t.id] ?? this.getRoundDeadline(t.createdAt);
      return new Date(deadline) < now;
    };

    const belongsToHistory = (t: Tournament): boolean => {
      if (t.status === TournamentStatus.FINISHED) return true;
      if (isNotInOrder(t)) return true;
      const label = getResultLabel(t);
      if (label === 'Время истекло' || label === 'Поражение' || label === 'Победа') return true;
      if (label === 'Ожидание соперника') return isTimeExpired(t);
      if (playerRoundFinished.get(t.id) && !isTimeExpired(t)) return false;
      if (currentTournamentId === t.id && !isTimeExpired(t)) return false;
      return isTimeExpired(t);
    };

    const getDisplayResultLabel = (t: Tournament, inCompleted: boolean): string => {
      const label = getResultLabel(t);
      if (isNotInOrder(t)) return 'Время истекло';
      if (inCompleted && isTimeExpired(t) && label !== 'Поражение' && label !== 'Победа') {
        return 'Время истекло';
      }
      return label;
    };

    const activeTournamentsRaw = tournaments.filter((t) => !belongsToHistory(t));
    const completedTournamentsRaw = tournaments.filter((t) => belongsToHistory(t));

    for (const t of completedTournamentsRaw) {
      if (t.gameType === 'money' && isTimeExpired(t)) {
        try {
          await this.processTournamentEscrow(t.id);
        } catch (err) {
          console.error('[getMyTournaments] processTournamentEscrow', t.id, err);
        }
      }
    }

    // Если выиграл полуфинал — турнир и в активных (есть финал), и в истории (пройден этап ПФ = Победа).
    const moneySemiWonFinalPending = tournaments.filter(
      (t) =>
        getMoneySemiResult(t).result === 'won' &&
        !belongsToHistory(t),
    );
    const semiWonCompletedItems = moneySemiWonFinalPending.map((t) =>
      toItem(t, deadlineByTournamentId[t.id] ?? '', 'passed', 'Победа', 'semi', 'Полуфинал'),
    );

    const activeRaw = activeTournamentsRaw.map((t) =>
      toItem(t, deadlineByTournamentId[t.id] ?? this.getRoundDeadline(t.createdAt), getUserStatus(t), getDisplayResultLabel(t, false)),
    );
    const active = activeRaw.slice().sort((a, b) => {
      const tA = new Date(a.createdAt).getTime();
      const tB = new Date(b.createdAt).getTime();
      if (tA !== tB) return tB - tA;
      return b.id - a.id;
    });

    const completedRaw = [
      ...completedTournamentsRaw.map((t) =>
        toItem(t, deadlineByTournamentId[t.id] ?? '', getUserStatus(t), getDisplayResultLabel(t, true)),
      ),
      ...semiWonCompletedItems,
    ];
    const completed = completedRaw.slice().sort((a, b) => {
      const tA = new Date(a.createdAt).getTime();
      const tB = new Date(b.createdAt).getTime();
      if (tA !== tB) return tB - tA;
      return b.id - a.id;
    });

    return { active, completed };
  }

  /** Возвращает состояние турнира для участника (продолжить игру). */
  async getTournamentState(
    userId: number,
    tournamentId: number,
  ): Promise<{
    tournamentId: number;
    playerSlot: number;
    totalPlayers: number;
    semiIndex: number;
    positionInSemi: number;
    isCreator: boolean;
    deadline: string;
    tiebreakerRound?: number;
    tiebreakerQuestions?: { id: number; question: string; options: string[]; correctAnswer: number }[];
  }> {
    const tournament = await this.tournamentRepository.findOne({
      where: { id: tournamentId },
      relations: ['players'],
    });
    if (!tournament) throw new NotFoundException('Tournament not found');
    this.sortPlayersByOrder(tournament);
    if (tournament.status !== TournamentStatus.WAITING && tournament.status !== TournamentStatus.ACTIVE) {
      throw new BadRequestException('Tournament is not active');
    }
    const order = tournament.playerOrder ?? [];
    const playerSlot = order.indexOf(userId);
    if (playerSlot < 0) throw new BadRequestException('You are not in this tournament');

    const semiIndex = playerSlot < 2 ? 0 : 1;
    const positionInSemi = playerSlot % 2;
    const isCreator = playerSlot === 0;

    const progress = await this.tournamentProgressRepository.findOne({ where: { userId, tournamentId } });
    const roundStart = progress?.roundStartedAt ?? tournament.createdAt ?? new Date();
    const deadline = this.getRoundDeadline(roundStart);
    const opponentSlot = playerSlot % 2 === 0 ? playerSlot + 1 : playerSlot - 1;
    const oppIdState = opponentSlot >= 0 && opponentSlot < order.length ? order[opponentSlot] : -1;
    const opponent = oppIdState > 0 ? (tournament.players?.find((p) => p.id === oppIdState) ?? null) : null;
    let tiebreakerRound = 0;
    let tiebreakerQuestions: { id: number; question: string; options: string[]; correctAnswer: number }[] = [];

    if (opponent && progress) {
      const oppProgress = await this.tournamentProgressRepository.findOne({
        where: { userId: opponent.id, tournamentId },
      });
      const myQ = progress.questionsAnsweredCount ?? 0;
      const oppQ = oppProgress?.questionsAnsweredCount ?? 0;
      const mySemi = progress.semiFinalCorrectCount ?? 0;
      const oppSemi = oppProgress?.semiFinalCorrectCount ?? 0;
      const myTB = progress.tiebreakerRoundsCorrect ?? [];
      const oppTB = oppProgress?.tiebreakerRoundsCorrect ?? [];

      if (myQ >= this.QUESTIONS_PER_ROUND && oppQ >= this.QUESTIONS_PER_ROUND && mySemi === oppSemi) {
        for (let r = 1; r <= 50; r++) {
          const roundEnd = this.QUESTIONS_PER_ROUND + r * this.TIEBREAKER_QUESTIONS;
          if (myQ < roundEnd || oppQ < roundEnd) {
            tiebreakerRound = r;
            const roundIndex = 2 + r;
            const existing = await this.questionRepository.find({
              where: { tournament: { id: tournamentId }, roundIndex },
            });
            if (myQ === this.QUESTIONS_PER_ROUND && oppQ === this.QUESTIONS_PER_ROUND) {
              if (existing.length > 0) {
                for (const q of existing) {
                  await this.questionRepository.remove(q);
                }
              }
            } else if (existing.length >= this.TIEBREAKER_QUESTIONS) {
              const questions = await this.questionRepository.find({
                where: { tournament: { id: tournamentId }, roundIndex },
                order: { id: 'ASC' },
              });
              tiebreakerQuestions = questions.map((q) => {
                const fixed = this.ensureQuestionOptions(q.question, q.options, q.correctAnswer);
                return { id: q.id, question: q.question, options: fixed.options, correctAnswer: fixed.correctAnswer };
              });
            } else if (existing.length < this.TIEBREAKER_QUESTIONS && (myQ > this.QUESTIONS_PER_ROUND || oppQ > this.QUESTIONS_PER_ROUND)) {
              const pool = await this.pickRandomQuestions(this.TIEBREAKER_QUESTIONS);
              for (const q of pool) {
                const row = this.questionRepository.create({ ...q, tournament, roundIndex });
                await this.questionRepository.save(row);
              }
              const questions = await this.questionRepository.find({
                where: { tournament: { id: tournamentId }, roundIndex },
                order: { id: 'ASC' },
              });
              tiebreakerQuestions = questions.map((q) => {
                const fixed = this.ensureQuestionOptions(q.question, q.options, q.correctAnswer);
                return { id: q.id, question: q.question, options: fixed.options, correctAnswer: fixed.correctAnswer };
              });
            }
            break;
          }
          const myR = myTB[r - 1] ?? 0;
          const oppR = oppTB[r - 1] ?? 0;
          if (myR !== oppR) break;
        }
      }
    }

    return {
      tournamentId: tournament.id,
      playerSlot,
      totalPlayers: tournament.players?.length ?? 0,
      semiIndex,
      positionInSemi,
      isCreator,
      deadline,
      tiebreakerRound,
      tiebreakerQuestions,
    };
  }

  /** Записать результат участника по турниру (пройден / не пройден). */
  async completeTournament(userId: number, tournamentId: number, passed: boolean): Promise<{ ok: boolean }> {
    const tournament = await this.tournamentRepository.findOne({
      where: { id: tournamentId },
      relations: ['players'],
    });
    if (!tournament) throw new NotFoundException('Tournament not found');
    this.sortPlayersByOrder(tournament);
    const isPlayer = tournament.players?.some((p) => p.id === userId);
    if (!isPlayer) throw new BadRequestException('You are not in this tournament');

    let effectivePassed = passed;

    if (passed) {
      const players = tournament.players ?? [];
      if (players.length < 2) {
        effectivePassed = false;
      } else {
        const semiResult = await this.computeSemiResult(tournament, userId);
        if (semiResult !== 'won') {
          effectivePassed = false;
        } else if ((tournament.playerOrder?.length ?? 0) < 4) {
          effectivePassed = false;
        } else {
          const cOrder = tournament.playerOrder ?? [];
          const cPlayerSlot = cOrder.indexOf(userId);
          const otherSlots: [number, number] = cPlayerSlot < 2 ? [2, 3] : [0, 1];
          const opp1Id = otherSlots[0] < cOrder.length ? cOrder[otherSlots[0]] : -1;
          const opp2Id = otherSlots[1] < cOrder.length ? cOrder[otherSlots[1]] : -1;
          const opp1 = opp1Id > 0 ? (players.find((p) => p.id === opp1Id) ?? null) : null;
          const opp2 = opp2Id > 0 ? (players.find((p) => p.id === opp2Id) ?? null) : null;
          let finalistProgress: TournamentProgress | null = null;
          if (opp1 && opp2) {
            const p1 = await this.tournamentProgressRepository.findOne({ where: { userId: opp1.id, tournamentId } });
            const p2 = await this.tournamentProgressRepository.findOne({ where: { userId: opp2.id, tournamentId } });
            finalistProgress = this.findSemiWinner(p1, p2);
          }
          if (!finalistProgress) {
            effectivePassed = false;
          } else {
            const myProgress = await this.tournamentProgressRepository.findOne({ where: { userId, tournamentId } });
            const myTBCount = (myProgress?.tiebreakerRoundsCorrect ?? []).length;
            const mySemiTotal = this.QUESTIONS_PER_ROUND + myTBCount * this.TIEBREAKER_QUESTIONS;
            const myQ = myProgress?.questionsAnsweredCount ?? 0;
            const oppTBCount = (finalistProgress.tiebreakerRoundsCorrect ?? []).length;
            const oppSemiTotal = this.QUESTIONS_PER_ROUND + oppTBCount * this.TIEBREAKER_QUESTIONS;
            const oppQ = finalistProgress.questionsAnsweredCount ?? 0;

            if (myQ < mySemiTotal + this.QUESTIONS_PER_ROUND || oppQ < oppSemiTotal + this.QUESTIONS_PER_ROUND) {
              effectivePassed = false;
            } else {
              const mySemiTBSum = (myProgress?.tiebreakerRoundsCorrect ?? []).reduce((a, b) => a + b, 0);
              const myFinalCorrect = (myProgress?.correctAnswersCount ?? 0) - (myProgress?.semiFinalCorrectCount ?? 0) - mySemiTBSum;
              const oppSemiTBSum = (finalistProgress.tiebreakerRoundsCorrect ?? []).reduce((a, b) => a + b, 0);
              const oppFinalCorrect = (finalistProgress.correctAnswersCount ?? 0) - (finalistProgress.semiFinalCorrectCount ?? 0) - oppSemiTBSum;

              const myFTB = myProgress?.finalTiebreakerRoundsCorrect ?? [];
              const oppFTB = finalistProgress.finalTiebreakerRoundsCorrect ?? [];
              const myFTBSum = myFTB.reduce((a, b) => a + b, 0);
              const oppFTBSum = oppFTB.reduce((a, b) => a + b, 0);
              const myFinalBase = myFinalCorrect - myFTBSum;
              const oppFinalBase = oppFinalCorrect - oppFTBSum;

              if (myFinalBase > oppFinalBase) {
                effectivePassed = true;
              } else if (myFinalBase < oppFinalBase) {
                effectivePassed = false;
              } else {
                let decided = false;
                for (let r = 0; r < Math.max(myFTB.length, oppFTB.length); r++) {
                  if ((myFTB[r] ?? 0) > (oppFTB[r] ?? 0)) { effectivePassed = true; decided = true; break; }
                  if ((myFTB[r] ?? 0) < (oppFTB[r] ?? 0)) { effectivePassed = false; decided = true; break; }
                }
                if (!decided) effectivePassed = false;
              }
            }
          }
        }
      }
    }

    let result = await this.tournamentResultRepository.findOne({
      where: { userId, tournamentId },
    });
    const now = new Date();
    if (result) {
      result.passed = effectivePassed ? 1 : 0;
      if (!result.completedAt) result.completedAt = now;
      await this.tournamentResultRepository.save(result);
    } else {
      result = this.tournamentResultRepository.create({
        userId,
        tournamentId,
        passed: effectivePassed ? 1 : 0,
        completedAt: now,
      });
      await this.tournamentResultRepository.save(result);
    }
    return { ok: true };
  }

  /** Состояние тренировки для продолжения игры (вопросы по раундам + прогресс). */
  async getTrainingState(
    userId: number,
    tournamentId: number,
  ): Promise<{
    tournamentId: number;
    deadline: string;
    questionsSemi1: { id: number; question: string; options: string[]; correctAnswer: number }[];
    questionsSemi2: { id: number; question: string; options: string[]; correctAnswer: number }[];
    questionsFinal: { id: number; question: string; options: string[]; correctAnswer: number }[];
    questionsTiebreaker: { id: number; question: string; options: string[]; correctAnswer: number }[];
    tiebreakerRound: number;
    tiebreakerBase: number;
    tiebreakerPhase: 'semi' | 'final' | null;
    questionsAnsweredCount: number;
    currentQuestionIndex: number;
    lockedAnswerCount: number;
    timeLeftSeconds: number | null;
    leftAt: string | null;
    correctAnswersCount: number;
    semiFinalCorrectCount: number | null;
    semiTiebreakerCorrectSum: number;
    answersChosen: number[];
    userSemiIndex: number;
    semiResult: 'playing' | 'won' | 'lost' | 'tie' | 'waiting';
    semiTiebreakerAllQuestions: { id: number; question: string; options: string[]; correctAnswer: number }[][];
    semiTiebreakerRoundsCorrect: number[];
    finalTiebreakerAllQuestions: { id: number; question: string; options: string[]; correctAnswer: number }[][];
    finalTiebreakerRoundsCorrect: number[];
    opponentAnswersByRound: number[][];
    opponentInfoByRound: { id: number; nickname: string; avatarUrl: string | null }[];
  }> {
    const tournament = await this.tournamentRepository.findOne({
      where: { id: tournamentId },
      relations: ['players'],
    });
    if (!tournament) throw new NotFoundException('Tournament not found');
    this.sortPlayersByOrder(tournament);
    const isPlayer = tournament.players?.some((p) => p.id === userId);
    if (!isPlayer) throw new BadRequestException('You are not in this tournament');

    let questions = await this.questionRepository.find({
      where: { tournament: { id: tournamentId } },
      order: { roundIndex: 'ASC', id: 'ASC' },
    });

    if (questions.filter((q) => q.roundIndex === 0).length === 0) {
      const { semi1, semi2 } = await this.pickQuestionsForSemi();
      for (const q of semi1) {
        const row = this.questionRepository.create({ ...q, tournament, roundIndex: 0 });
        await this.questionRepository.save(row);
      }
      for (const q of semi2) {
        const row = this.questionRepository.create({ ...q, tournament, roundIndex: 1 });
        await this.questionRepository.save(row);
      }
      questions = await this.questionRepository.find({
        where: { tournament: { id: tournamentId } },
        order: { roundIndex: 'ASC', id: 'ASC' },
      });
    }

    const toDto = (q: Question) => {
      const fixed = this.ensureQuestionOptions(q.question, q.options, q.correctAnswer);
      return {
        id: q.id,
        question: q.question,
        options: fixed.options,
        correctAnswer: fixed.correctAnswer,
      };
    };
    const questionsSemi1 = questions.filter((q) => q.roundIndex === 0).map(toDto);
    const questionsSemi2 = questions.filter((q) => q.roundIndex === 1).map(toDto);
    let questionsFinal = questions.filter((q) => q.roundIndex === 2).map(toDto);

    // Lazy-создание финальных вопросов: только когда определён победитель полуфинала
    if (questionsFinal.length === 0) {
      const wonSemi = await this.didUserWinSemiFinal(tournament, userId);
      if (wonSemi) {
        const finalPool = await this.pickQuestionsForFinal();
        const created: typeof questionsFinal = [];
        for (const q of finalPool) {
          const row = this.questionRepository.create({ ...q, tournament, roundIndex: 2 });
          await this.questionRepository.save(row);
          created.push(toDto(row));
        }
        questionsFinal = created;
      }
    }

    const progress = await this.tournamentProgressRepository.findOne({
      where: { userId, tournamentId },
    });
    const roundStart = progress?.roundStartedAt ?? tournament.createdAt ?? new Date();
    const deadline = this.getRoundDeadline(roundStart);
    const questionsAnsweredCount = progress?.questionsAnsweredCount ?? 0;
    const currentQuestionIndex = progress?.currentQuestionIndex ?? 0;
    const timeLeftSeconds = progress?.timeLeftSeconds ?? null;
    const leftAt = progress?.leftAt ?? null;
    const correctAnswersCount = progress?.correctAnswersCount ?? 0;
    const semiFinalCorrectCount = progress?.semiFinalCorrectCount ?? null;
    const playerSlotForSemi = (tournament.playerOrder ?? []).indexOf(userId);
    const userSemiIndex = playerSlotForSemi >= 0 ? (playerSlotForSemi < 2 ? 0 : 1) : 0;

    // answersChosen — массив выбранных вариантов по вопросам (0–9 полуфинал). Нужен для бейджей «Мой ответ» в просмотре.
    let answersChosen = this.normalizeAnswersChosen(progress?.answersChosen);
    if (progress?.id != null && questionsAnsweredCount > 0) {
      const rawRows = await this.tournamentProgressRepository.query(
        'SELECT "answersChosen" FROM tournament_progress WHERE id = $1',
        [progress.id],
      );
      const row = rawRows?.[0];
      const rawVal = row?.answersChosen ?? row?.answers_chosen ?? (row && (row as any).answerschosen);
      const fromRaw = rawVal != null ? this.normalizeAnswersChosen(rawVal) : [];
      if (fromRaw.length > answersChosen.length) answersChosen = fromRaw;
    }

    const semiResult = await this.computeSemiResult(tournament, userId);

    let questionsTiebreaker: typeof questionsSemi1 = [];
    let tiebreakerRound = 0;
    let tiebreakerBase = 0;
    let tiebreakerPhase: 'semi' | 'final' | null = null;

    if (semiResult === 'tie' && progress) {
      tiebreakerPhase = 'semi';
      const myTB = progress.tiebreakerRoundsCorrect ?? [];
      const oppSlotTB = playerSlotForSemi % 2 === 0 ? playerSlotForSemi + 1 : playerSlotForSemi - 1;
      const oppIdTB = oppSlotTB >= 0 && oppSlotTB < (tournament.playerOrder?.length ?? 0) ? (tournament.playerOrder![oppSlotTB] ?? -1) : -1;
      const oppProgress = oppIdTB > 0
        ? await this.tournamentProgressRepository.findOne({ where: { userId: oppIdTB, tournamentId } })
        : null;
      const oppTB = oppProgress?.tiebreakerRoundsCorrect ?? [];
      const myQ = questionsAnsweredCount;
      const oppQ = oppProgress?.questionsAnsweredCount ?? 0;

      for (let r = 1; r <= 50; r++) {
        const roundEnd = this.QUESTIONS_PER_ROUND + r * this.TIEBREAKER_QUESTIONS;
        if (myQ < roundEnd || oppQ < roundEnd) {
          tiebreakerRound = r;
          tiebreakerBase = this.QUESTIONS_PER_ROUND + (r - 1) * this.TIEBREAKER_QUESTIONS;
          const roundIndex = 2 + r;
          let existing = await this.questionRepository.find({
            where: { tournament: { id: tournamentId }, roundIndex },
            order: { id: 'ASC' },
          });
          if (existing.length < this.TIEBREAKER_QUESTIONS) {
            const pool = await this.pickRandomQuestions(this.TIEBREAKER_QUESTIONS);
            for (const q of pool) {
              const row = this.questionRepository.create({ ...q, tournament, roundIndex });
              await this.questionRepository.save(row);
            }
            existing = await this.questionRepository.find({
              where: { tournament: { id: tournamentId }, roundIndex },
              order: { id: 'ASC' },
            });
          }
          questionsTiebreaker = existing.map(toDto);
          break;
        }
        const myR = myTB[r - 1] ?? 0;
        const oppR = oppTB[r - 1] ?? 0;
        if (myR !== oppR) break;
      }
    }

    if (semiResult === 'won' && progress) {
      const myTBCount = progress.tiebreakerRoundsCorrect?.length ?? 0;
      const mySemiTotal = this.QUESTIONS_PER_ROUND + myTBCount * this.TIEBREAKER_QUESTIONS;
      if (questionsAnsweredCount >= mySemiTotal + this.QUESTIONS_PER_ROUND) {
        const fOrder = tournament.playerOrder ?? [];
        const otherSlots: [number, number] = playerSlotForSemi < 2 ? [2, 3] : [0, 1];
        const fOpp1Id = otherSlots[0] < fOrder.length ? fOrder[otherSlots[0]] : -1;
        const fOpp2Id = otherSlots[1] < fOrder.length ? fOrder[otherSlots[1]] : -1;
        let finalistProgress: TournamentProgress | null = null;
        if (fOpp1Id > 0 && fOpp2Id > 0) {
          const p1 = await this.tournamentProgressRepository.findOne({ where: { userId: fOpp1Id, tournamentId } });
          const p2 = await this.tournamentProgressRepository.findOne({ where: { userId: fOpp2Id, tournamentId } });
          finalistProgress = this.findSemiWinner(p1, p2);
        } else if (fOpp1Id > 0) {
          finalistProgress = await this.tournamentProgressRepository.findOne({ where: { userId: fOpp1Id, tournamentId } });
        } else if (fOpp2Id > 0) {
          finalistProgress = await this.tournamentProgressRepository.findOne({ where: { userId: fOpp2Id, tournamentId } });
        }

        if (finalistProgress) {
          const oppTBCount = finalistProgress.tiebreakerRoundsCorrect?.length ?? 0;
          const oppSemiTotal = this.QUESTIONS_PER_ROUND + oppTBCount * this.TIEBREAKER_QUESTIONS;
          const oppQ = finalistProgress.questionsAnsweredCount ?? 0;
          if (oppQ >= oppSemiTotal + this.QUESTIONS_PER_ROUND) {
            const mySemiTBSum = (progress.tiebreakerRoundsCorrect ?? []).reduce((a, b) => a + b, 0);
            const myFinalCorrect = correctAnswersCount - (semiFinalCorrectCount ?? 0) - mySemiTBSum;
            const oppSemiTBSum = (finalistProgress.tiebreakerRoundsCorrect ?? []).reduce((a, b) => a + b, 0);
            const oppFinalCorrect = (finalistProgress.correctAnswersCount ?? 0) - (finalistProgress.semiFinalCorrectCount ?? 0) - oppSemiTBSum;

            const myFTB = progress.finalTiebreakerRoundsCorrect ?? [];
            const oppFTB = finalistProgress.finalTiebreakerRoundsCorrect ?? [];
            const myFTBSum = myFTB.reduce((a, b) => a + b, 0);
            const oppFTBSum = oppFTB.reduce((a, b) => a + b, 0);
            const myFinalBase = myFinalCorrect - myFTBSum;
            const oppFinalBase = oppFinalCorrect - oppFTBSum;

            if (myFinalBase === oppFinalBase) {
              let finalTied = true;
              for (let r = 0; r < Math.max(myFTB.length, oppFTB.length); r++) {
                const myR = myFTB[r] ?? 0;
                const oppR = oppFTB[r] ?? 0;
                if (myR !== oppR) { finalTied = false; break; }
              }
              if (finalTied) {
                tiebreakerPhase = 'final';
                const ftbRound = Math.max(myFTB.length, oppFTB.length) + 1;
                tiebreakerRound = ftbRound;
                tiebreakerBase = mySemiTotal + this.QUESTIONS_PER_ROUND + (ftbRound - 1) * this.TIEBREAKER_QUESTIONS;
                const roundIndex = 100 + ftbRound;
                let existing = await this.questionRepository.find({
                  where: { tournament: { id: tournamentId }, roundIndex },
                  order: { id: 'ASC' },
                });
                if (existing.length < this.TIEBREAKER_QUESTIONS) {
                  const pool = await this.pickRandomQuestions(this.TIEBREAKER_QUESTIONS);
                  for (const q of pool) {
                    const row = this.questionRepository.create({ ...q, tournament, roundIndex });
                    await this.questionRepository.save(row);
                  }
                  existing = await this.questionRepository.find({
                    where: { tournament: { id: tournamentId }, roundIndex },
                    order: { id: 'ASC' },
                  });
                }
                questionsTiebreaker = existing.map(toDto);
              }
            }
          }
        }
      }
    }

    const semiTiebreakerAllQuestions: (typeof questionsSemi1)[] = [];
    for (let r = 1; r <= 50; r++) {
      const ri = 2 + r;
      const qs = questions.filter((q) => q.roundIndex === ri).map(toDto);
      if (qs.length === 0) break;
      semiTiebreakerAllQuestions.push(qs);
    }
    const finalTiebreakerAllQuestions: (typeof questionsSemi1)[] = [];
    for (let r = 1; r <= 50; r++) {
      const ri = 100 + r;
      const qs = questions.filter((q) => q.roundIndex === ri).map(toDto);
      if (qs.length === 0) break;
      finalTiebreakerAllQuestions.push(qs);
    }

    // ---- Opponent answers + info per round (for question review table) ----
    const opponentAnswersByRound: number[][] = [];
    const opponentInfoByRound: { id: number; nickname: string; avatarUrl: string | null }[] = [];
    const fetchOppAC = async (oppUserId: number): Promise<number[]> => {
      const oppProg = await this.tournamentProgressRepository.findOne({ where: { userId: oppUserId, tournamentId } });
      if (!oppProg) return [];
      let ac = this.normalizeAnswersChosen(oppProg.answersChosen);
      if (oppProg.id != null) {
        const rawRows = await this.tournamentProgressRepository.query(
          'SELECT "answersChosen" FROM tournament_progress WHERE id = $1', [oppProg.id],
        );
        const rawVal = rawRows?.[0]?.answersChosen ?? rawRows?.[0]?.answers_chosen;
        if (rawVal != null) {
          const fromRaw = this.normalizeAnswersChosen(rawVal);
          if (fromRaw.length > ac.length) ac = fromRaw;
        }
      }
      return ac;
    };
    const getOppNickname = (user: User | undefined | null): string =>
      user?.nickname || user?.username || `Игрок #${user?.id ?? '?'}`;

    const QPR = this.QUESTIONS_PER_ROUND;
    const TBQ = this.TIEBREAKER_QUESTIONS;

    // Semi opponent
    const semiOppSlot = playerSlotForSemi % 2 === 0 ? playerSlotForSemi + 1 : playerSlotForSemi - 1;
    const semiOppIdLookup = semiOppSlot >= 0 && semiOppSlot < (tournament.playerOrder?.length ?? 0) ? (tournament.playerOrder![semiOppSlot] ?? -1) : -1;
    let semiOppAC: number[] = [];
    let semiOppUser: User | null = null;
    if (semiOppIdLookup > 0) {
      semiOppUser = tournament.players?.find((p) => p.id === semiOppIdLookup) ?? null;
      if (semiOppUser) semiOppAC = await fetchOppAC(semiOppUser.id);
    }
    const semiOppInfo = semiOppUser ? { id: semiOppUser.id, nickname: getOppNickname(semiOppUser), avatarUrl: semiOppUser.avatarUrl ?? null } : { id: 0, nickname: '—', avatarUrl: null };
    opponentAnswersByRound.push(semiOppAC.slice(0, QPR));
    opponentInfoByRound.push(semiOppInfo);
    for (let r = 0; r < semiTiebreakerAllQuestions.length; r++) {
      opponentAnswersByRound.push(semiOppAC.slice(QPR + r * TBQ, QPR + (r + 1) * TBQ));
      opponentInfoByRound.push(semiOppInfo);
    }

    // Final opponent (winner of the other semi pair)
    if (questionsFinal.length > 0) {
      const fOtherSlots: [number, number] = playerSlotForSemi < 2 ? [2, 3] : [0, 1];
      const fOrder2 = tournament.playerOrder ?? [];
      const fOppId1 = fOtherSlots[0] < fOrder2.length ? fOrder2[fOtherSlots[0]] : -1;
      const fOppId2 = fOtherSlots[1] < fOrder2.length ? fOrder2[fOtherSlots[1]] : -1;
      const p1 = fOppId1 > 0 ? await this.tournamentProgressRepository.findOne({ where: { userId: fOppId1, tournamentId } }) : null;
      const p2 = fOppId2 > 0 ? await this.tournamentProgressRepository.findOne({ where: { userId: fOppId2, tournamentId } }) : null;
      const finalist = this.findSemiWinner(p1, p2);
      if (finalist) {
        const finalistUser = (tournament.players ?? []).find((u) => u.id === finalist.userId) ?? null;
        const finalOppInfo = finalistUser ? { id: finalistUser.id, nickname: getOppNickname(finalistUser), avatarUrl: finalistUser.avatarUrl ?? null } : { id: 0, nickname: '—', avatarUrl: null };
        const fAC = await fetchOppAC(finalist.userId);
        const fTBCount = finalist.tiebreakerRoundsCorrect?.length ?? 0;
        const fFinalStart = QPR + fTBCount * TBQ;
        opponentAnswersByRound.push(fAC.slice(fFinalStart, fFinalStart + QPR));
        opponentInfoByRound.push(finalOppInfo);
        for (let r = 0; r < finalTiebreakerAllQuestions.length; r++) {
          opponentAnswersByRound.push(fAC.slice(fFinalStart + QPR + r * TBQ, fFinalStart + QPR + (r + 1) * TBQ));
          opponentInfoByRound.push(finalOppInfo);
        }
      }
    }

    return {
      tournamentId: tournament.id,
      deadline,
      questionsSemi1,
      questionsSemi2,
      questionsFinal,
      questionsTiebreaker,
      tiebreakerRound,
      tiebreakerBase,
      tiebreakerPhase,
      questionsAnsweredCount,
      currentQuestionIndex,
      lockedAnswerCount: progress?.lockedAnswerCount ?? 0,
      timeLeftSeconds,
      leftAt: leftAt ? (leftAt instanceof Date ? leftAt.toISOString() : String(leftAt)) : null,
      correctAnswersCount,
      semiFinalCorrectCount,
      semiTiebreakerCorrectSum: (progress?.tiebreakerRoundsCorrect ?? []).reduce((a: number, b: number) => a + b, 0),
      answersChosen,
      userSemiIndex,
      semiResult,
      semiTiebreakerAllQuestions,
      semiTiebreakerRoundsCorrect: progress?.tiebreakerRoundsCorrect ?? [],
      finalTiebreakerAllQuestions,
      finalTiebreakerRoundsCorrect: progress?.finalTiebreakerRoundsCorrect ?? [],
      opponentAnswersByRound,
      opponentInfoByRound,
    };
  }

  /**
   * Для математических вопросов вида "Сколько будет X op Y?" вычисляет правильный ответ.
   * Возвращает null, если вопрос не математический или не удалось распарсить.
   */
  private parseMathAnswer(question: string): number | null {
    let m = question.match(/Сколько будет (\d+)\s*([+−×÷\-])\s*(\d+)/);
    if (!m) m = question.match(/What is (\d+)\s*([+*\-])\s*(\d+)/i);
    if (!m) return null;
    const a = parseInt(m[1]!, 10);
    const b = parseInt(m[3]!, 10);
    const op = m[2];
    if (op === '+') return a + b;
    if (op === '−' || op === '-') return a - b;
    if (op === '×' || op === '*') return a * b;
    if (op === '÷') return b !== 0 ? Math.floor(a / b) : null;
    return null;
  }

  /**
   * Если правильный ответ отсутствует в вариантах (баг старых данных) — восстанавливает варианты
   * для математических вопросов: вычисляет ответ по тексту и подставляет в options.
   */
  private ensureQuestionOptions(
    question: string,
    options: string[],
    correctAnswer: number,
  ): { options: string[]; correctAnswer: number } {
    const opts = Array.isArray(options) ? [...options] : [];
    const idx = Math.max(0, Math.floor(correctAnswer));
    if (opts[idx] !== undefined && opts[idx] !== null && opts[idx] !== '') {
      return { options: opts, correctAnswer: idx };
    }
    const correctVal = this.parseMathAnswer(question);
    if (correctVal == null) return { options: opts.length ? opts : ['?'], correctAnswer: 0 };
    const correctStr = String(correctVal);
    if (opts.includes(correctStr)) {
      return { options: opts, correctAnswer: opts.indexOf(correctStr) };
    }
    const newOpts: string[] = [correctStr];
    if (correctVal >= 10) {
      const deltas = [-30, -20, -10, 10, 20, 30].filter((d) => correctVal + d > 0);
      for (let i = deltas.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deltas[i], deltas[j]] = [deltas[j]!, deltas[i]!]; }
      deltas.forEach((d) => { if (newOpts.length < 4 && !newOpts.includes(String(correctVal + d))) newOpts.push(String(correctVal + d)); });
      for (let m = 4; newOpts.length < 4; m++) {
        if (correctVal + m * 10 > 0) newOpts.push(String(correctVal + m * 10));
        else if (correctVal - m * 10 > 0) newOpts.push(String(correctVal - m * 10));
      }
    } else {
      const wrong = [-3, -2, -1, 1, 2, 3].filter((d) => correctVal + d > 0);
      wrong.forEach((w) => { if (newOpts.length < 4) newOpts.push(String(correctVal + w)); });
      for (let k = 4; newOpts.length < 4; k++) newOpts.push(String(correctVal + k));
    }
    for (let i = newOpts.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newOpts[i], newOpts[j]] = [newOpts[j]!, newOpts[i]!];
    }
    return { options: newOpts, correctAnswer: newOpts.indexOf(correctStr) };
  }

  private findSemiWinner(p1: TournamentProgress | null, p2: TournamentProgress | null): TournamentProgress | null {
    if (!p1 || !p2) return p1 || p2;
    const q1 = p1.questionsAnsweredCount ?? 0;
    const q2 = p2.questionsAnsweredCount ?? 0;
    if (q1 < this.QUESTIONS_PER_ROUND || q2 < this.QUESTIONS_PER_ROUND) return null;
    const s1 = p1.semiFinalCorrectCount ?? 0;
    const s2 = p2.semiFinalCorrectCount ?? 0;
    if (s1 > s2) return p1;
    if (s2 > s1) return p2;
    const tb1 = p1.tiebreakerRoundsCorrect ?? [];
    const tb2 = p2.tiebreakerRoundsCorrect ?? [];
    for (let r = 0; r < Math.max(tb1.length, tb2.length); r++) {
      if ((tb1[r] ?? 0) > (tb2[r] ?? 0)) return p1;
      if ((tb2[r] ?? 0) > (tb1[r] ?? 0)) return p2;
    }
    return null;
  }

  private normalizeAnswersChosen(val: unknown): number[] {
    const mapFn = (a: unknown): number => {
      if (typeof a === 'number' && !Number.isNaN(a)) {
        return a < 0 ? -1 : Math.floor(a);
      }
      return -1;
    };
    if (Array.isArray(val)) return val.map(mapFn);
    if (typeof val === 'string') {
      try {
        const parsed = JSON.parse(val) as unknown;
        return Array.isArray(parsed) ? parsed.map(mapFn) : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  private readonly QUESTIONS_PER_ROUND = 10;
  private readonly TIEBREAKER_QUESTIONS = 10;

  private sortPlayersByOrder(tournament: Tournament): void {
    const order = tournament.playerOrder;
    if (!order || !tournament.players || tournament.players.length <= 1) return;
    const orderMap = new Map(order.map((uid, i) => [uid, i]));
    tournament.players.sort((a, b) => (orderMap.get(a.id) ?? 999) - (orderMap.get(b.id) ?? 999));
  }

  /**
   * Определяет, выиграл ли пользователь полуфинал.
   * Тренировка (1 игрок): финал доступен после завершения 10 вопросов полуфинала.
   * Деньги (2+ игрока): финал доступен только если у пользователя больше правильных, чем у оппонента,
   * либо он выиграл тайбрейкер.
   */
  private async didUserWinSemiFinal(tournament: Tournament, userId: number): Promise<boolean> {
    const order = tournament.playerOrder ?? [];
    const playerSlot = order.indexOf(userId);
    if (playerSlot < 0) return false;
    const opponentSlot = playerSlot % 2 === 0 ? playerSlot + 1 : playerSlot - 1;
    const oppId = opponentSlot >= 0 && opponentSlot < order.length ? order[opponentSlot] : -1;

    if (oppId == null || oppId <= 0) {
      const myProgress = await this.tournamentProgressRepository.findOne({ where: { userId, tournamentId: tournament.id } });
      return (myProgress?.questionsAnsweredCount ?? 0) >= this.QUESTIONS_PER_ROUND;
    }

    const myProgress = await this.tournamentProgressRepository.findOne({ where: { userId, tournamentId: tournament.id } });
    const allProgWin = await this.tournamentProgressRepository.find({ where: { tournamentId: tournament.id } });
    if (this.isPlayerInFinalPhase(myProgress, allProgWin, tournament)) return true;

    const myQ = myProgress?.questionsAnsweredCount ?? 0;
    const myTBLenW = (myProgress?.tiebreakerRoundsCorrect ?? []).length;
    const mySemiTotalW = this.QUESTIONS_PER_ROUND + myTBLenW * this.TIEBREAKER_QUESTIONS;
    if (myQ > mySemiTotalW) {
      const finalQCount = await this.questionRepository.count({
        where: { tournament: { id: tournament.id }, roundIndex: 2 },
      });
      if (finalQCount > 0) return true;
    }

    const oppProgress = await this.tournamentProgressRepository.findOne({ where: { userId: oppId, tournamentId: tournament.id } });
    const oppQ = oppProgress?.questionsAnsweredCount ?? 0;

    if (myQ < this.QUESTIONS_PER_ROUND || oppQ < this.QUESTIONS_PER_ROUND) return false;

    const mySemi = myProgress?.semiFinalCorrectCount ?? 0;
    const oppSemi = oppProgress?.semiFinalCorrectCount ?? 0;

    if (mySemi > oppSemi) return true;
    if (mySemi < oppSemi) return false;

    // Ничья в полуфинале → проверяем тайбрейкеры
    const myTB = myProgress?.tiebreakerRoundsCorrect ?? [];
    const oppTB = oppProgress?.tiebreakerRoundsCorrect ?? [];
    for (let r = 0; r < Math.min(myTB.length, oppTB.length); r++) {
      const roundEnd = this.QUESTIONS_PER_ROUND + (r + 1) * this.TIEBREAKER_QUESTIONS;
      if (myQ < roundEnd || oppQ < roundEnd) return false;
      if ((myTB[r] ?? 0) > (oppTB[r] ?? 0)) return true;
      if ((myTB[r] ?? 0) < (oppTB[r] ?? 0)) return false;
    }
    return false;
  }

  /**
   * Вычисляет результат полуфинала для данного пользователя:
   * 'playing' — ещё не закончил полуфинал;
   * 'waiting' — закончил, но оппонент ещё нет (или нет оппонента в money-режиме);
   * 'won' — выиграл полуфинал (больше правильных или выиграл тайбрейкер);
   * 'lost' — проиграл полуфинал;
   * 'tie' — ничья, нужен дополнительный раунд.
   */
  private async computeSemiResult(
    tournament: Tournament,
    userId: number,
  ): Promise<'playing' | 'won' | 'lost' | 'tie' | 'waiting'> {
    const players = tournament.players ?? [];
    const myProgress = await this.tournamentProgressRepository.findOne({ where: { userId, tournamentId: tournament.id } });
    const myQ = myProgress?.questionsAnsweredCount ?? 0;

    if (myQ < this.QUESTIONS_PER_ROUND) return 'playing';

    const allProgForCheck = await this.tournamentProgressRepository.find({ where: { tournamentId: tournament.id } });
    if (this.isPlayerInFinalPhase(myProgress, allProgForCheck, tournament)) return 'won';

    const myTBLenCS = (myProgress?.tiebreakerRoundsCorrect ?? []).length;
    const mySemiTotalCS = this.QUESTIONS_PER_ROUND + myTBLenCS * this.TIEBREAKER_QUESTIONS;
    if (myQ > mySemiTotalCS) {
      const finalQCount = await this.questionRepository.count({
        where: { tournament: { id: tournament.id }, roundIndex: 2 },
      });
      if (finalQCount > 0) return 'won';
    }

    const order = tournament.playerOrder ?? [];
    const playerSlot = order.indexOf(userId);
    if (playerSlot < 0) return 'playing';
    const opponentSlot = playerSlot % 2 === 0 ? playerSlot + 1 : playerSlot - 1;
    const oppId = opponentSlot >= 0 && opponentSlot < order.length ? order[opponentSlot] : -1;
    if (oppId == null || oppId <= 0) return 'won';

    const oppProgress = await this.tournamentProgressRepository.findOne({ where: { userId: oppId, tournamentId: tournament.id } });
    const oppQ = oppProgress?.questionsAnsweredCount ?? 0;

    if (oppQ < this.QUESTIONS_PER_ROUND) return 'waiting';

    const mySemi = myProgress?.semiFinalCorrectCount ?? 0;
    const oppSemi = oppProgress?.semiFinalCorrectCount ?? 0;

    if (mySemi > oppSemi) return 'won';
    if (mySemi < oppSemi) return 'lost';

    // Ничья — проверяем тайбрейкеры
    const myTB = myProgress?.tiebreakerRoundsCorrect ?? [];
    const oppTB = oppProgress?.tiebreakerRoundsCorrect ?? [];
    for (let r = 0; r < Math.max(myTB.length, oppTB.length); r++) {
      const roundEnd = this.QUESTIONS_PER_ROUND + (r + 1) * this.TIEBREAKER_QUESTIONS;
      if (myQ < roundEnd || oppQ < roundEnd) return 'tie';
      if ((myTB[r] ?? 0) > (oppTB[r] ?? 0)) return 'won';
      if ((myTB[r] ?? 0) < (oppTB[r] ?? 0)) return 'lost';
    }
    return 'tie';
  }

  /** Подсчитать количество верных ответов на основе answersChosen и вопросов турнира.
   *  answersChosen хранится как: [semi0..semi9, final0..final9, ...tiebreakers].
   *  Нужно сравнивать с вопросами НУЖНОГО полуфинала (по semiRoundIndex) + финал. */
  private async computeCorrectFromAnswers(
    tournamentId: number,
    answersChosen: number[],
    semiRoundIndex: number = 0,
  ): Promise<{ total: number; semi: number }> {
    if (!answersChosen || answersChosen.length === 0) return { total: 0, semi: 0 };
    const questions = await this.questionRepository.find({
      where: { tournament: { id: tournamentId } },
      order: { roundIndex: 'ASC', id: 'ASC' },
    });
    const semiQuestions = questions.filter((q) => q.roundIndex === semiRoundIndex);
    const tiebreakerQuestions = questions.filter((q) => q.roundIndex >= 3).sort((a, b) => a.roundIndex - b.roundIndex || a.id - b.id);
    const finalQuestions = questions.filter((q) => q.roundIndex === 2).sort((a, b) => a.id - b.id);
    const playerQuestions = [...semiQuestions, ...tiebreakerQuestions, ...finalQuestions];
    let total = 0;
    let semi = 0;
    for (let i = 0; i < answersChosen.length && i < playerQuestions.length; i++) {
      if (answersChosen[i] >= 0 && answersChosen[i] === playerQuestions[i].correctAnswer) {
        total++;
        if (i < semiQuestions.length) semi++;
      }
    }
    return { total, semi };
  }

  /** Обновить прогресс участника (сколько вопросов ответил + на каком вопросе остановились + оставшееся время). */
  async setProgress(
    userId: number,
    tournamentId: number,
    count: number,
    currentIndex?: number,
    timeLeft?: number,
    correctCount?: number,
    answersChosen?: unknown,
    answerFinal?: boolean,
  ): Promise<{ ok: boolean }> {
    const normalizedChosen = this.normalizeAnswersChosen(answersChosen);
    const tournament = await this.tournamentRepository.findOne({
      where: { id: tournamentId },
      relations: ['players'],
    });
    if (!tournament) throw new NotFoundException('Tournament not found');
    this.sortPlayersByOrder(tournament);
    const isPlayer = tournament.players?.some((p) => p.id === userId);
    if (!isPlayer) throw new BadRequestException('You are not in this tournament');
    let safeCount = Math.max(0, Math.floor(count));
    let safeCurrent = currentIndex !== undefined ? Math.max(0, Math.min(259, Math.floor(currentIndex))) : safeCount;
    const safeTimeLeft = timeLeft !== undefined ? Math.max(0, Math.min(5, Math.floor(timeLeft))) : null;

    const chosenToSave = normalizedChosen.slice(0, Math.max(safeCount, normalizedChosen.length));

    let progress = await this.tournamentProgressRepository.findOne({
      where: { userId, tournamentId },
    });

    // Anti-cheat: заблокированные ответы нельзя перезаписать
    if (progress) {
      const locked = progress.lockedAnswerCount ?? 0;
      const prevChosen = progress.answersChosen ?? [];
      for (let i = 0; i < Math.min(locked, chosenToSave.length); i++) {
        if (i < prevChosen.length) {
          chosenToSave[i] = prevChosen[i];
        }
      }

      // Prevent pre-save inflation: non-final saves can advance at most 1 beyond locked answers
      if (!answerFinal && locked > 0) {
        const cap = locked + 1;
        if (safeCount > cap) safeCount = cap;
        if (safeCurrent > cap) safeCurrent = cap;
      }
    }

    const playerSlot = tournament.players?.findIndex((p) => p.id === userId) ?? 0;
    const semiRoundIndex = playerSlot < 2 ? 0 : 1;
    const { total: computedCorrect, semi: computedSemi } = await this.computeCorrectFromAnswers(tournamentId, chosenToSave, semiRoundIndex);

    if (progress) {
      if (safeCount >= progress.questionsAnsweredCount) {
        progress.questionsAnsweredCount = safeCount;
      }

      const currentLen = progress.answersChosen?.length ?? 0;
      if (chosenToSave.length >= currentLen && (chosenToSave.length >= safeCount || chosenToSave.length > currentLen)) {
        progress.answersChosen = chosenToSave;
        progress.correctAnswersCount = Math.max(computedCorrect, progress.correctAnswersCount);
        if (chosenToSave.length >= this.QUESTIONS_PER_ROUND) {
          progress.semiFinalCorrectCount = Math.max(computedSemi, progress.semiFinalCorrectCount ?? 0);
        }
      } else if (chosenToSave.length >= this.QUESTIONS_PER_ROUND && chosenToSave.length >= currentLen) {
        progress.correctAnswersCount = Math.max(computedCorrect, progress.correctAnswersCount);
        progress.semiFinalCorrectCount = Math.max(computedSemi, progress.semiFinalCorrectCount ?? 0);
      } else {
        const fallbackCorrect = correctCount !== undefined ? Math.max(0, Math.floor(correctCount)) : null;
        if (fallbackCorrect !== null && (progress.correctAnswersCount === 0 || fallbackCorrect > progress.correctAnswersCount)) {
          progress.correctAnswersCount = fallbackCorrect;
        }
      }

      if (progress.semiFinalCorrectCount != null) {
        const currentCorrect = progress.correctAnswersCount;
        const semiTBRounds = progress.tiebreakerRoundsCorrect ?? [];

        const oppSlotForTB = playerSlot % 2 === 0 ? playerSlot + 1 : playerSlot - 1;
        const oppPlayerForTB = tournament.players?.[oppSlotForTB];
        let isSemiTied = false;
        if (oppPlayerForTB) {
          const oppProg = await this.tournamentProgressRepository.findOne({
            where: { userId: oppPlayerForTB.id, tournamentId },
          });
          isSemiTied = oppProg?.semiFinalCorrectCount != null
            && oppProg.semiFinalCorrectCount === progress.semiFinalCorrectCount;
          if (isSemiTied && semiTBRounds.length > 0) {
            const oppTBRounds = oppProg?.tiebreakerRoundsCorrect ?? [];
            for (let r = 0; r < Math.min(semiTBRounds.length, oppTBRounds.length); r++) {
              if ((semiTBRounds[r] ?? 0) !== (oppTBRounds[r] ?? 0)) {
                isSemiTied = false;
                break;
              }
            }
          }
        }

        if (isSemiTied) {
          for (let r = 1; r <= 50; r++) {
            const roundEnd = this.QUESTIONS_PER_ROUND + r * this.TIEBREAKER_QUESTIONS;
            if (safeCount === roundEnd && semiTBRounds.length < r) {
              const prevSum = semiTBRounds.reduce((a, b) => a + b, 0);
              const roundCorrect = currentCorrect - progress.semiFinalCorrectCount - prevSum;
              progress.tiebreakerRoundsCorrect = [...semiTBRounds, Math.max(0, roundCorrect)];
              break;
            }
          }
        }

        const semiTBCount = (progress.tiebreakerRoundsCorrect ?? []).length;
        const semiPhaseTotal = this.QUESTIONS_PER_ROUND + semiTBCount * this.TIEBREAKER_QUESTIONS;
        const semiTBSum = (progress.tiebreakerRoundsCorrect ?? []).reduce((a, b) => a + b, 0);
        const finalTBRounds = progress.finalTiebreakerRoundsCorrect ?? [];
        for (let r = 1; r <= 50; r++) {
          const ftbEnd = semiPhaseTotal + this.QUESTIONS_PER_ROUND + r * this.TIEBREAKER_QUESTIONS;
          if (safeCount === ftbEnd && finalTBRounds.length < r) {
            const prevFTBSum = finalTBRounds.reduce((a, b) => a + b, 0);
            const roundCorrect = currentCorrect - progress.semiFinalCorrectCount - semiTBSum - prevFTBSum;
            progress.finalTiebreakerRoundsCorrect = [...finalTBRounds, Math.max(0, roundCorrect)];
            break;
          }
        }
      }
      progress.currentQuestionIndex = Math.max(safeCurrent, progress.currentQuestionIndex);
      if (safeTimeLeft !== null) {
        progress.timeLeftSeconds = safeTimeLeft;
        progress.leftAt = new Date();
      } else {
        progress.timeLeftSeconds = null;
        progress.leftAt = null;
      }

      // Anti-cheat: при answerFinal фиксируем ответы — перезаписать нельзя
      if (answerFinal) {
        progress.lockedAnswerCount = Math.max(progress.lockedAnswerCount ?? 0, chosenToSave.length);
      }

      // Per-player 24h timer: reset roundStartedAt when crossing phase boundary
      if (!progress.roundStartedAt) {
        progress.roundStartedAt = new Date();
      }

      // Re-read from DB right before save to prevent lost-update race condition:
      // another concurrent request may have saved newer data between our initial read and now.
      const freshRows = await this.tournamentProgressRepository.query(
        'SELECT "answersChosen", "questionsAnsweredCount", "correctAnswersCount", "semiFinalCorrectCount", "lockedAnswerCount" FROM tournament_progress WHERE id = $1',
        [progress.id],
      );
      if (freshRows?.[0]) {
        const freshChosen = this.normalizeAnswersChosen(freshRows[0].answersChosen);
        const freshCorrect = Number(freshRows[0].correctAnswersCount) || 0;
        const freshSemiCorrect = freshRows[0].semiFinalCorrectCount != null ? Number(freshRows[0].semiFinalCorrectCount) : null;
        const freshLocked = Number(freshRows[0].lockedAnswerCount) || 0;
        progress.lockedAnswerCount = Math.max(progress.lockedAnswerCount ?? 0, freshLocked);

        // Защита от перезаписи заблокированных ответов из свежих данных
        const mergedChosen = progress.answersChosen ?? [];
        for (let i = 0; i < Math.min(freshLocked, mergedChosen.length); i++) {
          if (i < freshChosen.length) mergedChosen[i] = freshChosen[i];
        }
        progress.answersChosen = mergedChosen;

        if (freshChosen.length > (progress.answersChosen?.length ?? 0)) {
          progress.answersChosen = freshChosen;
          const { total: recomputedTotal, semi: recomputedSemi } = await this.computeCorrectFromAnswers(tournamentId, freshChosen, semiRoundIndex);
          progress.correctAnswersCount = Math.max(recomputedTotal, freshCorrect, progress.correctAnswersCount);
          if (freshChosen.length >= this.QUESTIONS_PER_ROUND) {
            progress.semiFinalCorrectCount = Math.max(recomputedSemi, freshSemiCorrect ?? 0, progress.semiFinalCorrectCount ?? 0);
          }
        } else {
          if (freshCorrect > progress.correctAnswersCount) {
            progress.correctAnswersCount = freshCorrect;
          }
          if (freshSemiCorrect != null && (progress.semiFinalCorrectCount == null || freshSemiCorrect > progress.semiFinalCorrectCount)) {
            progress.semiFinalCorrectCount = freshSemiCorrect;
          }
        }

        const freshCount = Number(freshRows[0].questionsAnsweredCount) || 0;
        if (freshCount > progress.questionsAnsweredCount) {
          progress.questionsAnsweredCount = freshCount;
        }

        // Reset roundStartedAt on phase boundary crossing (semi→TB, TB→final, etc.)
        const prevQ = freshCount;
        const semiTBLen = (progress.tiebreakerRoundsCorrect ?? []).length;
        const boundaries: number[] = [this.QUESTIONS_PER_ROUND];
        for (let r = 1; r <= semiTBLen + 1; r++) boundaries.push(this.QUESTIONS_PER_ROUND + r * this.TIEBREAKER_QUESTIONS);
        const fStart = this.QUESTIONS_PER_ROUND + semiTBLen * this.TIEBREAKER_QUESTIONS;
        boundaries.push(fStart + this.QUESTIONS_PER_ROUND);
        for (const b of boundaries) {
          if (prevQ < b && safeCount >= b) { progress.roundStartedAt = new Date(); break; }
        }
      }

      await this.tournamentProgressRepository.save(progress);
    } else {
      const fallbackCorrect = correctCount !== undefined ? Math.max(0, Math.floor(correctCount)) : null;
      const bestCorrect = chosenToSave.length > 0 ? computedCorrect : (fallbackCorrect ?? 0);
      const bestSemi = chosenToSave.length >= this.QUESTIONS_PER_ROUND ? computedSemi
        : (safeCount === this.QUESTIONS_PER_ROUND && fallbackCorrect != null ? Math.min(this.QUESTIONS_PER_ROUND, fallbackCorrect) : undefined);
      progress = this.tournamentProgressRepository.create({
        userId,
        tournamentId,
        questionsAnsweredCount: safeCount,
        correctAnswersCount: bestCorrect,
        ...(bestSemi !== undefined && { semiFinalCorrectCount: bestSemi }),
        currentQuestionIndex: safeCurrent,
        lockedAnswerCount: answerFinal ? safeCount : 0,
        ...(safeTimeLeft !== null && { timeLeftSeconds: safeTimeLeft, leftAt: new Date() }),
        ...(chosenToSave.length > 0 && { answersChosen: chosenToSave }),
        roundStartedAt: new Date(),
      });
      await this.tournamentProgressRepository.save(progress);
    }

    await this.tryAutoComplete(tournament, userId).catch(() => {});

    return { ok: true };
  }

  /** Автозавершение: после каждого ответа проверяем, определился ли результат. */
  private async tryAutoComplete(tournament: Tournament, userId: number): Promise<void> {
    const tournamentId = tournament.id;
    const players = tournament.players ?? [];
    if (players.length < 2) return;
    this.sortPlayersByOrder(tournament);

    const order = tournament.playerOrder ?? [];
    const playerSlot = order.indexOf(userId);
    if (playerSlot < 0) return;
    const opponentSlot = playerSlot % 2 === 0 ? playerSlot + 1 : playerSlot - 1;
    const opponentId = opponentSlot >= 0 && opponentSlot < order.length ? order[opponentSlot] : -1;
    if (opponentId <= 0) return;

    const myProgress = await this.tournamentProgressRepository.findOne({ where: { userId, tournamentId } });
    const oppProgress = await this.tournamentProgressRepository.findOne({ where: { userId: opponentId, tournamentId } });
    if (!myProgress || !oppProgress) return;

    const myQ = myProgress.questionsAnsweredCount ?? 0;
    const oppQ = oppProgress.questionsAnsweredCount ?? 0;
    if (myQ < this.QUESTIONS_PER_ROUND || oppQ < this.QUESTIONS_PER_ROUND) return;

    const semiResult = await this.computeSemiResult(tournament, userId);
    if (semiResult === 'playing' || semiResult === 'waiting' || semiResult === 'tie') return;

    // Double-check: re-read fresh progress to prevent race condition
    const freshMy = await this.tournamentProgressRepository.findOne({ where: { userId, tournamentId } });
    const freshOpp = await this.tournamentProgressRepository.findOne({ where: { userId: opponentId, tournamentId } });
    if (freshMy && freshOpp) {
      const fMyS = freshMy.semiFinalCorrectCount ?? 0;
      const fOpS = freshOpp.semiFinalCorrectCount ?? 0;
      if (fMyS === fOpS) {
        const myTBFresh = freshMy.tiebreakerRoundsCorrect ?? [];
        const oppTBFresh = freshOpp.tiebreakerRoundsCorrect ?? [];
        let tbResolved = false;
        for (let r = 0; r < Math.min(myTBFresh.length, oppTBFresh.length); r++) {
          if ((myTBFresh[r] ?? 0) !== (oppTBFresh[r] ?? 0)) { tbResolved = true; break; }
        }
        if (!tbResolved) return;
      }
    }

    const semiWinnerId = semiResult === 'won' ? userId : opponentId;
    const semiLoserId = semiResult === 'won' ? opponentId : userId;

    const now = new Date();
    const saveResult = async (uid: number, passed: boolean) => {
      let row = await this.tournamentResultRepository.findOne({ where: { userId: uid, tournamentId } });
      if (row) {
        row.passed = passed ? 1 : 0;
        if (!row.completedAt) row.completedAt = now;
        await this.tournamentResultRepository.save(row);
      } else {
        row = this.tournamentResultRepository.create({ userId: uid, tournamentId, passed: passed ? 1 : 0, completedAt: now });
        await this.tournamentResultRepository.save(row);
      }
    };

    if (players.length <= 2) {
      await saveResult(semiLoserId, false);
      await saveResult(semiWinnerId, true);
      await this.tournamentRepository.update({ id: tournamentId }, { status: TournamentStatus.FINISHED });
      return;
    }

    await saveResult(semiLoserId, false);

    if (semiResult !== 'won') return;

    const otherSlots: [number, number] = playerSlot < 2 ? [2, 3] : [0, 1];
    const opp1Id = otherSlots[0] < order.length ? order[otherSlots[0]] : -1;
    const opp2Id = otherSlots[1] < order.length ? order[otherSlots[1]] : -1;
    if (opp1Id <= 0 && opp2Id <= 0) return;

    const p1 = opp1Id > 0 ? await this.tournamentProgressRepository.findOne({ where: { userId: opp1Id, tournamentId } }) : null;
    const p2 = opp2Id > 0 ? await this.tournamentProgressRepository.findOne({ where: { userId: opp2Id, tournamentId } }) : null;
    let finalistProgress: TournamentProgress | null = null;
    if (opp1Id > 0 && opp2Id > 0) {
      finalistProgress = this.findSemiWinner(p1, p2);
    } else {
      finalistProgress = p1 || p2;
    }
    if (!finalistProgress) return;

    const finalistId = finalistProgress.userId;
    const myTBCount = (myProgress.tiebreakerRoundsCorrect ?? []).length;
    const mySemiTotal = this.QUESTIONS_PER_ROUND + myTBCount * this.TIEBREAKER_QUESTIONS;
    const oppTBCount = (finalistProgress.tiebreakerRoundsCorrect ?? []).length;
    const oppSemiTotal = this.QUESTIONS_PER_ROUND + oppTBCount * this.TIEBREAKER_QUESTIONS;

    if (myQ < mySemiTotal + this.QUESTIONS_PER_ROUND) return;
    if ((finalistProgress.questionsAnsweredCount ?? 0) < oppSemiTotal + this.QUESTIONS_PER_ROUND) return;

    const mySemiTBSum = (myProgress.tiebreakerRoundsCorrect ?? []).reduce((a, b) => a + b, 0);
    const myFinalCorrect = (myProgress.correctAnswersCount ?? 0) - (myProgress.semiFinalCorrectCount ?? 0) - mySemiTBSum;
    const oppSemiTBSum = (finalistProgress.tiebreakerRoundsCorrect ?? []).reduce((a, b) => a + b, 0);
    const oppFinalCorrect = (finalistProgress.correctAnswersCount ?? 0) - (finalistProgress.semiFinalCorrectCount ?? 0) - oppSemiTBSum;

    const myFTB = myProgress.finalTiebreakerRoundsCorrect ?? [];
    const oppFTB = finalistProgress.finalTiebreakerRoundsCorrect ?? [];
    const myFTBSum = myFTB.reduce((a, b) => a + b, 0);
    const oppFTBSum = oppFTB.reduce((a, b) => a + b, 0);
    const myFinalBase = myFinalCorrect - myFTBSum;
    const oppFinalBase = oppFinalCorrect - oppFTBSum;

    let myWon: boolean | null = null;
    if (myFinalBase > oppFinalBase) {
      myWon = true;
    } else if (myFinalBase < oppFinalBase) {
      myWon = false;
    } else {
      for (let r = 0; r < Math.max(myFTB.length, oppFTB.length); r++) {
        const myFTBEnd = mySemiTotal + this.QUESTIONS_PER_ROUND + (r + 1) * this.TIEBREAKER_QUESTIONS;
        const oppFTBEnd = oppSemiTotal + this.QUESTIONS_PER_ROUND + (r + 1) * this.TIEBREAKER_QUESTIONS;
        if (myQ < myFTBEnd || (finalistProgress.questionsAnsweredCount ?? 0) < oppFTBEnd) break;
        if ((myFTB[r] ?? 0) > (oppFTB[r] ?? 0)) { myWon = true; break; }
        if ((myFTB[r] ?? 0) < (oppFTB[r] ?? 0)) { myWon = false; break; }
      }
    }

    if (myWon === null) return;

    const tournamentWinnerId = myWon ? userId : finalistId;
    const tournamentLoserId = myWon ? finalistId : userId;

    await saveResult(tournamentWinnerId, true);
    await saveResult(tournamentLoserId, false);

    await this.tournamentRepository.update({ id: tournamentId }, { status: TournamentStatus.FINISHED });
  }

  /** Карта турнира: полуфиналы по бокам, финал в центре. */
  async getTournamentBracket(
    userId: number,
    tournamentId: number,
  ): Promise<{
    tournamentId: number;
    gameType: string | null;
    status: string;
    isCompleted: boolean;
    isActive: boolean;
    semi1: { players: { id: number; username: string; nickname?: string | null; semiScore?: number; questionsAnswered?: number; correctAnswersCount?: number; isLoser?: boolean; tiebreakerRound?: number; tiebreakerAnswered?: number; tiebreakerCorrect?: number }[] };
    semi2: { players: { id: number; username: string; nickname?: string | null; semiScore?: number; questionsAnswered?: number; correctAnswersCount?: number; isLoser?: boolean; tiebreakerRound?: number; tiebreakerAnswered?: number; tiebreakerCorrect?: number }[] } | null;
    final: { players: { id: number; username: string; nickname?: string | null; finalScore?: number; finalAnswered?: number; finalCorrect?: number }[] };
  }> {
    const tournament = await this.tournamentRepository.findOne({
      where: { id: tournamentId },
      relations: ['players'],
    });
    if (!tournament) throw new NotFoundException('Tournament not found');
    this.sortPlayersByOrder(tournament);
    const isPlayer = tournament.players?.some((p) => p.id === userId);
    if (!isPlayer) throw new BadRequestException('You are not in this tournament');

    const entries = await this.tournamentEntryRepository.find({
      where: { tournament: { id: tournamentId } },
    });
    const players = tournament.players ?? [];
    let progressList = await this.tournamentProgressRepository.find({
      where: { tournamentId, userId: In(players.map((p) => p.id)) },
    });
    const baseDeadline = this.getRoundDeadline(tournament.createdAt ?? new Date());
    // Backfill: если ровно 10 ответов, но semiFinalCorrectCount не установлен — восстанавливаем из correctAnswersCount.
    // При 10 ответах correctAnswersCount = верные в полуфинале. При 11+ это уже сумма полуфинал+финал — не трогаем.
    for (const p of progressList) {
      if (
        p.questionsAnsweredCount === this.QUESTIONS_PER_ROUND &&
        p.semiFinalCorrectCount == null &&
        p.correctAnswersCount != null
      ) {
        const semiCorrect = Math.min(this.QUESTIONS_PER_ROUND, p.correctAnswersCount);
        await this.tournamentProgressRepository.update(
          { id: p.id },
          { semiFinalCorrectCount: semiCorrect },
        );
        p.semiFinalCorrectCount = semiCorrect;
      }
    }
    const progressByUser = new Map(progressList.map((p) => [p.userId, p]));

    const isTimeExpired = new Date(baseDeadline) < new Date();
    const hasWinner =
      (await this.tournamentResultRepository.findOne({
        where: { tournamentId, passed: 1 },
      })) != null;
    const isCompleted =
      tournament.status === TournamentStatus.FINISHED || hasWinner || isTimeExpired;
    const isActive = !isCompleted;

    const toPlayer = (p: User, isLoser?: boolean) => {
      const prog = progressByUser.get(p.id);
      const q = prog?.questionsAnsweredCount ?? 0;
      let semiScore: number | undefined;
      if (prog?.semiFinalCorrectCount != null && prog.semiFinalCorrectCount <= this.QUESTIONS_PER_ROUND) {
        semiScore = prog.semiFinalCorrectCount;
      } else if (q <= this.QUESTIONS_PER_ROUND) {
        semiScore = prog?.correctAnswersCount ?? 0;
      }

      let tiebreakerRound = 0;
      let tiebreakerAnswered = 0;
      let tiebreakerCorrect: number | undefined;
      const tbRounds = prog?.tiebreakerRoundsCorrect ?? [];
      if (q > this.QUESTIONS_PER_ROUND && prog?.semiFinalCorrectCount != null) {
        const completedTBRounds = tbRounds.length;
        const answeredAfterSemi = q - this.QUESTIONS_PER_ROUND;
        const answeredInCompletedRounds = completedTBRounds * this.TIEBREAKER_QUESTIONS;
        const inCurrentRound = answeredAfterSemi - answeredInCompletedRounds;
        if (inCurrentRound > 0) {
          tiebreakerRound = completedTBRounds + 1;
          tiebreakerAnswered = Math.min(inCurrentRound, this.TIEBREAKER_QUESTIONS);
        } else if (completedTBRounds > 0) {
          tiebreakerRound = completedTBRounds;
          tiebreakerAnswered = this.TIEBREAKER_QUESTIONS;
          tiebreakerCorrect = tbRounds[completedTBRounds - 1];
        }
      }

      return {
        id: p.id,
        username: p.username ?? `Игрок ${p.id}`,
        nickname: (p as any).nickname ?? null,
        avatarUrl: (p as any).avatarUrl ?? null,
        semiScore,
        questionsAnswered: q,
        correctAnswersCount: prog?.correctAnswersCount ?? 0,
        isLoser: isLoser ?? false,
        tiebreakerRound,
        tiebreakerAnswered,
        tiebreakerCorrect,
      };
    };

    const getSemiLoserIndex = (
      prog0: TournamentProgress | undefined,
      prog1: TournamentProgress | undefined,
    ): 0 | 1 | null => {
      const q0 = prog0?.questionsAnsweredCount ?? 0;
      const q1 = prog1?.questionsAnsweredCount ?? 0;
      if (q0 < 10 || q1 < 10) return null;
      const s0 = prog0?.semiFinalCorrectCount ?? 0;
      const s1 = prog1?.semiFinalCorrectCount ?? 0;
      if (s0 > s1) return 1;
      if (s1 > s0) return 0;
      const tb0 = prog0?.tiebreakerRoundsCorrect ?? [];
      const tb1 = prog1?.tiebreakerRoundsCorrect ?? [];
      const R = this.QUESTIONS_PER_ROUND;
      const T = this.TIEBREAKER_QUESTIONS;
      for (let r = 1; r <= 50; r++) {
        const roundEnd = R + r * T;
        if (q0 < roundEnd || q1 < roundEnd) return null;
        const myR = tb0[r - 1] ?? 0;
        const oppR = tb1[r - 1] ?? 0;
        if (myR > oppR) return 1;
        if (oppR > myR) return 0;
      }
      return null;
    };

    const order = tournament.playerOrder ?? [];
    const vacantPlayer = (slot: number) => ({
      id: -1,
      username: 'Ожидание игрока',
      nickname: null,
      avatarUrl: null,
      semiScore: undefined,
      questionsAnswered: 0,
      correctAnswersCount: 0,
      isLoser: false,
      tiebreakerRound: 0,
      tiebreakerAnswered: 0,
      tiebreakerCorrect: undefined,
    });

    const playerBySlot = (slot: number) => {
      const uid = slot >= 0 && slot < order.length ? order[slot] : -1;
      if (uid <= 0) return null;
      return players.find((p) => p.id === uid) ?? null;
    };

    const toSemiPlayers = (slot0: number, slot1: number) => {
      const uid0 = slot0 < order.length ? order[slot0] : -1;
      const uid1 = slot1 < order.length ? order[slot1] : -1;
      const p0 = uid0 > 0 ? players.find((p) => p.id === uid0) : null;
      const p1 = uid1 > 0 ? players.find((p) => p.id === uid1) : null;

      if (!p0 && !p1) return [vacantPlayer(slot0), vacantPlayer(slot1)];
      if (!p0) return [vacantPlayer(slot0), toPlayer(p1!, false)];
      if (!p1) return [toPlayer(p0!, false), vacantPlayer(slot1)];

      const prog0 = progressByUser.get(p0.id);
      const prog1 = progressByUser.get(p1.id);
      const loserIndex = getSemiLoserIndex(prog0, prog1);
      return [
        toPlayer(p0, loserIndex === 0),
        toPlayer(p1, loserIndex === 1),
      ];
    };

    const enrichFinalPlayer = (
      pl: User,
      prog: TournamentProgress | undefined,
    ) => {
      const q = prog?.questionsAnsweredCount ?? 0;
      const semiCorrect = prog?.semiFinalCorrectCount ?? 0;
      const totalCorrect = prog?.correctAnswersCount ?? 0;
      const semiTBRounds: number[] = (prog as any)?.tiebreakerRoundsCorrect ?? [];
      const semiTBSum = semiTBRounds.reduce((a: number, b: number) => a + b, 0);
      const semiPhase = this.QUESTIONS_PER_ROUND + semiTBRounds.length * this.TIEBREAKER_QUESTIONS;
      const finalAnswered = q > semiPhase ? Math.min(this.QUESTIONS_PER_ROUND, q - semiPhase) : 0;
      const finalCorrect = q > semiPhase ? Math.max(0, totalCorrect - semiCorrect - semiTBSum) : 0;
      const finalScore = q >= semiPhase + this.QUESTIONS_PER_ROUND ? finalCorrect : undefined;
      return {
        id: pl.id,
        username: pl.username ?? 'Игрок',
        nickname: (pl as any).nickname ?? null,
        avatarUrl: (pl as any).avatarUrl ?? null,
        finalScore,
        finalAnswered,
        finalCorrect,
      };
    };

    const semi1Players = order.length >= 2 ? toSemiPlayers(0, 1) : players.slice(0, 2).map((p) => toPlayer(p));
    const semi2Players = order.length > 2 ? toSemiPlayers(2, 3) : [];

    const semiWinner = (slot0: number, slot1: number): User | null => {
      const uid0 = slot0 < order.length ? order[slot0] : -1;
      const uid1 = slot1 < order.length ? order[slot1] : -1;
      const p0 = uid0 > 0 ? players.find((p) => p.id === uid0) ?? null : null;
      const p1 = uid1 > 0 ? players.find((p) => p.id === uid1) ?? null : null;
      if (!p0 || !p1) return null;
      const prog0 = progressByUser.get(p0.id);
      const prog1 = progressByUser.get(p1.id);
      const loserIdx = getSemiLoserIndex(prog0, prog1);
      if (loserIdx === 0) return p1;
      if (loserIdx === 1) return p0;
      return null;
    };

    const finalPlayers: { id: number; username: string; nickname?: string | null; finalScore?: number; finalAnswered?: number; finalCorrect?: number }[] = [];
    if (order.length >= 2) {
      const winner1 = semiWinner(0, 1);
      if (winner1) finalPlayers.push(enrichFinalPlayer(winner1, progressByUser.get(winner1.id)));
    }
    if (order.length >= 4) {
      const winner2 = semiWinner(2, 3);
      if (winner2) finalPlayers.push(enrichFinalPlayer(winner2, progressByUser.get(winner2.id)));
    }

    return {
      tournamentId,
      gameType: tournament.gameType,
      status: tournament.status ?? 'active',
      isCompleted,
      isActive,
      semi1: { players: semi1Players },
      semi2: semi2Players.length ? { players: semi2Players } : null,
      final: { players: finalPlayers },
    };
  }

  /** Дозаполняет TournamentEntry для всех игроков в активных турнирах (если записи не было — создаёт с joinedAt = createdAt турнира) */
  async backfillTournamentEntries(): Promise<{ updated: number }> {
    const tournaments = await this.tournamentRepository.find({
      where: [{ status: TournamentStatus.WAITING }, { status: TournamentStatus.ACTIVE }],
      relations: ['players'],
    });
    let updated = 0;
    for (const tournament of tournaments) {
      if (!tournament.players?.length) continue;
      const existing = await this.tournamentEntryRepository.find({
        where: { tournament: { id: tournament.id } },
        relations: ['user'],
      });
      const existingUserIds = new Set(existing.map((e) => e.user?.id).filter(Boolean));
      for (const user of tournament.players) {
        if (existingUserIds.has(user.id)) continue;
        const entry = this.tournamentEntryRepository.create({
          tournament,
          user,
          joinedAt: tournament.createdAt ?? new Date(),
        });
        await this.tournamentEntryRepository.save(entry);
        updated++;
      }
    }
    return { updated };
  }

}