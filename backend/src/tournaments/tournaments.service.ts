import { BadRequestException, forwardRef, Inject, Injectable, NotFoundException, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull, Not } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Tournament, TournamentStatus, ROUND_DEADLINE_HOURS } from './tournament.entity';
import { Question } from './question.entity';
import { QuestionPoolItem } from './question-pool.entity';
import { TournamentEntry } from './tournament-entry.entity';
import { TournamentResult } from './tournament-result.entity';
import { TournamentProgress } from './tournament-progress.entity';
import { TournamentEscrow } from './tournament-escrow.entity';
import { User } from '../users/user.entity';
import { Transaction } from '../users/transaction.entity';
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

/** Название турнира для отображения: лига (для money) или «Тренировка». */
function getTournamentDisplayName(t: { gameType?: string | null; leagueAmount?: number | null }): string {
  if (t.gameType === 'money' && t.leagueAmount != null) return getLeagueName(t.leagueAmount);
  if (t.gameType === 'training') return 'Тренировка';
  if (t.leagueAmount != null) return getLeagueName(t.leagueAmount);
  return 'Турнир';
}

/** Объект турнира в ответе — ID, название, тип, статус, ставка. */
export interface TournamentInfoDto {
  id: number;
  name: string;
  type: string | null;
  status: string;
  leagueAmount?: number | null;
}

/** DTO элемента списка активных/завершённых турниров. */
export interface TournamentListItemDto {
  id: number;
  status: string;
  createdAt: string;
  playersCount: number;
  leagueAmount: number | null;
  deadline: string | null;
  userStatus: 'passed' | 'not_passed';
  stage?: string;
  resultLabel?: string;
  roundForQuestions: 'semi' | 'final';
  questionsAnswered: number;
  questionsTotal: number;
  correctAnswersInRound: number;
  completedAt?: string | null;
  roundFinished?: boolean;
  roundStartedAt?: string | null;
  /** Объект турнира: ID, название, тип, статус — для фронтенда. */
  tournament: TournamentInfoDto;
}

/** Выигрыш победителя: 4 игрока × ставка − 20% с каждого из 3 проигравших = 3.4 × ставка L */
function getLeaguePrize(stake: number): number {
  return Math.round(3.4 * stake);
}

function getMinBalanceForLeague(leagueIndex: number, amount: number): number {
  return leagueIndex === 0 ? amount : amount * LEAGUE_MIN_BALANCE_MULTIPLIER;
}

@Injectable()
export class TournamentsService implements OnModuleInit {
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
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    @Inject(forwardRef(() => UsersService))
    private readonly usersService: UsersService,
  ) {}

  private readonly logger = new Logger(TournamentsService.name);

  async onModuleInit(): Promise<void> {
    await this.backfillTournamentResultCompletedAt().catch((err) => {
      this.logger.warn('backfillTournamentResultCompletedAt failed', err?.message ?? err);
    });
    await this.backfillResolvedHeadToHeadResults().catch((err) => {
      this.logger.warn('backfillResolvedHeadToHeadResults failed', err?.message ?? err);
    });
    await this.backfillResolvedBracketResults().catch((err) => {
      this.logger.warn('backfillResolvedBracketResults failed', err?.message ?? err);
    });
  }

  /**
   * Дозаполняет completedAt у записей tournament_result, где дата отсутствует.
   * Берёт момент по паре: max(leftAt | roundStartedAt) по обоим участникам пары; если нет — tournament.createdAt или now.
   * @param onlyTournamentIds если задан — обрабатывать только эти турниры (для вызова из getMyTournaments).
   */
  async backfillTournamentResultCompletedAt(onlyTournamentIds?: number[]): Promise<{ updated: number }> {
    const where: any = { completedAt: IsNull() };
    if (onlyTournamentIds?.length) {
      where.tournamentId = In(onlyTournamentIds);
    }
    const rows = await this.tournamentResultRepository.find({ where });
    if (rows.length === 0) return { updated: 0 };
    const now = new Date();
    let updated = 0;
    const tournamentIds = [...new Set(rows.map((r) => r.tournamentId))];
    const tournaments = await this.tournamentRepository.find({
      where: { id: In(tournamentIds) },
    });
    const tourById = new Map(tournaments.map((t) => [t.id, t]));
    const progressRows = await this.tournamentProgressRepository.find({
      where: { tournamentId: In(tournamentIds) },
    });
    const progressByTidAndUser = new Map<number, Map<number, { leftAt: Date | null; roundStartedAt: Date | null }>>();
    for (const p of progressRows) {
      if (!progressByTidAndUser.has(p.tournamentId)) progressByTidAndUser.set(p.tournamentId, new Map());
      progressByTidAndUser.get(p.tournamentId)!.set(p.userId, {
        leftAt: p.leftAt ?? null,
        roundStartedAt: p.roundStartedAt ?? null,
      });
    }
    const toDate = (d: Date | string | null | undefined): Date | null => {
      if (!d) return null;
      const dt = d instanceof Date ? d : new Date(d);
      return Number.isNaN(dt.getTime()) ? null : dt;
    };
    for (const row of rows) {
      const t = tourById.get(row.tournamentId);
      if (!t) continue;
      const fallbackDate = t.createdAt instanceof Date ? t.createdAt : toDate((t as any).createdAt) ?? now;
      let completedAt: Date = fallbackDate;
      const order = t.playerOrder;
      if (order?.length && order.indexOf(row.userId) >= 0) {
        const playerSlot = order.indexOf(row.userId);
        const opponentSlot = playerSlot % 2 === 0 ? playerSlot + 1 : playerSlot - 1;
        const opponentId = opponentSlot >= 0 && opponentSlot < order.length ? (order[opponentSlot] ?? -1) : -1;
        const userIds = [row.userId, opponentId].filter((id) => id > 0);
        const map = progressByTidAndUser.get(row.tournamentId);
        const dates: Date[] = [];
        for (const uid of userIds) {
          const prog = map?.get(uid);
          if (!prog) continue;
          const d = toDate(prog.leftAt) ?? toDate(prog.roundStartedAt);
          if (d) dates.push(d);
        }
        if (dates.length > 0) {
          completedAt = new Date(Math.max(...dates.map((d) => d.getTime())));
        }
      }
      const capped = completedAt > now ? now : completedAt;
      row.completedAt = capped;
      await this.tournamentResultRepository.save(row);
      updated++;
    }
    if (updated > 0) this.logger.log(`backfillTournamentResultCompletedAt: updated ${updated} rows`);
    return { updated };
  }

  async backfillResolvedHeadToHeadResults(): Promise<{ updatedResults: number; updatedStatuses: number }> {
    const rows = await this.tournamentRepository.manager.query(
      `SELECT id FROM tournament WHERE json_array_length("playerOrder"::json) = 2`,
    );
    const tournamentIds = rows
      .map((row: { id?: number | string }) => Number(row.id))
      .filter((id: number) => Number.isFinite(id) && id > 0);
    if (tournamentIds.length === 0) {
      return { updatedResults: 0, updatedStatuses: 0 };
    }

    const tournaments = await this.tournamentRepository.find({
      where: { id: In(tournamentIds) },
      relations: ['players'],
    });

    let updatedResults = 0;
    let updatedStatuses = 0;
    const touchedTournamentIds = new Set<number>();

    for (const tournament of tournaments) {
      this.sortPlayersByOrder(tournament);
      const order = (tournament.playerOrder ?? []).filter((id) => id > 0);
      if (order.length !== 2) continue;

      const [userId1, userId2] = order;
      const progress1 = await this.tournamentProgressRepository.findOne({
        where: { tournamentId: tournament.id, userId: userId1 },
      });
      const progress2 = await this.tournamentProgressRepository.findOne({
        where: { tournamentId: tournament.id, userId: userId2 },
      });

      const winner = this.findSemiWinner(progress1, progress2);
      if (!winner) continue;

      const winnerId = winner.userId;
      const loserId = winnerId === userId1 ? userId2 : userId1;
      const now = new Date();

      const upsertResult = async (userId: number, passed: boolean): Promise<void> => {
        const passedValue = passed ? 1 : 0;
        let row = await this.tournamentResultRepository.findOne({
          where: { userId, tournamentId: tournament.id },
        });
        if (row) {
          const shouldSave = row.passed !== passedValue || !row.completedAt;
          if (!shouldSave) return;
          row.passed = passedValue;
          if (!row.completedAt) row.completedAt = now;
          await this.tournamentResultRepository.save(row);
          updatedResults += 1;
          touchedTournamentIds.add(tournament.id);
          return;
        }

        row = this.tournamentResultRepository.create({
          userId,
          tournamentId: tournament.id,
          passed: passedValue,
          completedAt: now,
        });
        await this.tournamentResultRepository.save(row);
        updatedResults += 1;
        touchedTournamentIds.add(tournament.id);
      };

      await upsertResult(winnerId, true);
      await upsertResult(loserId, false);

      if (tournament.status !== TournamentStatus.FINISHED) {
        await this.tournamentRepository.update(
          { id: tournament.id },
          { status: TournamentStatus.FINISHED },
        );
        updatedStatuses += 1;
        touchedTournamentIds.add(tournament.id);
      }
    }

    if (touchedTournamentIds.size > 0) {
      await this.backfillTournamentResultCompletedAt([...touchedTournamentIds]).catch(() => {});
      this.logger.log(
        `backfillResolvedHeadToHeadResults: updated ${updatedResults} result rows and ${updatedStatuses} tournament statuses`,
      );
    }

    return { updatedResults, updatedStatuses };
  }

  async backfillResolvedBracketResults(): Promise<{ updatedResults: number; updatedStatuses: number }> {
    const tournaments = await this.tournamentRepository.find({
      where: { status: TournamentStatus.FINISHED },
      relations: ['players'],
    });

    let updatedResults = 0;
    let updatedStatuses = 0;
    const touchedTournamentIds = new Set<number>();

    const upsertResult = async (tournamentId: number, userId: number, passed: boolean, now: Date): Promise<void> => {
      const passedValue = passed ? 1 : 0;
      let row = await this.tournamentResultRepository.findOne({
        where: { userId, tournamentId },
      });
      if (row) {
        const shouldSave = row.passed !== passedValue || !row.completedAt;
        if (!shouldSave) return;
        row.passed = passedValue;
        if (!row.completedAt) row.completedAt = now;
        await this.tournamentResultRepository.save(row);
        updatedResults += 1;
        touchedTournamentIds.add(tournamentId);
        return;
      }

      row = this.tournamentResultRepository.create({
        userId,
        tournamentId,
        passed: passedValue,
        completedAt: now,
      });
      await this.tournamentResultRepository.save(row);
      updatedResults += 1;
      touchedTournamentIds.add(tournamentId);
    };

    for (const tournament of tournaments) {
      this.sortPlayersByOrder(tournament);
      const order = (tournament.playerOrder ?? []).filter((id) => id > 0);
      if (order.length < 4) continue;

      const progressList = await this.tournamentProgressRepository.find({
        where: { tournamentId: tournament.id },
      });
      const progressByUser = new Map(progressList.map((progress) => [progress.userId, progress]));

      const semiWinner1 = this.findSemiWinner(
        progressByUser.get(order[0]) ?? null,
        progressByUser.get(order[1]) ?? null,
        true,
      );
      const semiWinner2 = this.findSemiWinner(
        progressByUser.get(order[2]) ?? null,
        progressByUser.get(order[3]) ?? null,
        true,
      );

      const semi1BothLost = this.didSemiPairBothLoseByTimeout(
        progressByUser.get(order[0]) ?? null,
        progressByUser.get(order[1]) ?? null,
      );
      const semi2BothLost = this.didSemiPairBothLoseByTimeout(
        progressByUser.get(order[2]) ?? null,
        progressByUser.get(order[3]) ?? null,
      );

      let winnerId: number | null = null;
      if (semiWinner1 && semiWinner2) {
        const finalState = this.getFinalHeadToHeadState(semiWinner1, semiWinner2, true);
        if (finalState.result === 'won') winnerId = semiWinner1.userId;
        else if (finalState.result === 'lost') winnerId = semiWinner2.userId;
        else if (finalState.result === 'tie') {
          const now = new Date();
          for (const userId of order) {
            await upsertResult(tournament.id, userId, false, now);
          }
          touchedTournamentIds.add(tournament.id);
          continue;
        }
      } else if (semiWinner1 && !semiWinner2 && semi2BothLost) {
        const soloFinal = this.getSoloFinalOutcome(semiWinner1, true);
        if (soloFinal.result === 'won') {
          winnerId = semiWinner1.userId;
        } else {
          const now = new Date();
          for (const userId of order) {
            await upsertResult(tournament.id, userId, false, now);
          }
          touchedTournamentIds.add(tournament.id);
          continue;
        }
      } else if (!semiWinner1 && semiWinner2 && semi1BothLost) {
        const soloFinal = this.getSoloFinalOutcome(semiWinner2, true);
        if (soloFinal.result === 'won') {
          winnerId = semiWinner2.userId;
        } else {
          const now = new Date();
          for (const userId of order) {
            await upsertResult(tournament.id, userId, false, now);
          }
          touchedTournamentIds.add(tournament.id);
          continue;
        }
      }

      if (!winnerId) continue;

      const now = new Date();
      for (const userId of order) {
        await upsertResult(tournament.id, userId, userId === winnerId, now);
      }

      if (tournament.status !== TournamentStatus.FINISHED) {
        await this.tournamentRepository.update(
          { id: tournament.id },
          { status: TournamentStatus.FINISHED },
        );
        updatedStatuses += 1;
        touchedTournamentIds.add(tournament.id);
      }
    }

    if (touchedTournamentIds.size > 0) {
      await this.backfillTournamentResultCompletedAt([...touchedTournamentIds]).catch(() => {});
      this.logger.log(
        `backfillResolvedBracketResults: updated ${updatedResults} result rows and ${updatedStatuses} tournament statuses`,
      );
    }

    return { updatedResults, updatedStatuses };
  }

  private getRoundDeadline(from: Date): string {
    return new Date(from.getTime() + ROUND_DEADLINE_HOURS * 3600000).toISOString();
  }

  private resolveStageTotals(
    myAnswered: number,
    myBaseCorrect: number,
    myExtraRounds: number[] | null | undefined,
    oppAnswered: number,
    oppBaseCorrect: number,
    oppExtraRounds: number[] | null | undefined,
    allowUnevenResolved = false,
  ): { result: 'won' | 'lost' | 'tie' | 'incomplete'; tiebreakerRound?: number; myTotal: number; oppTotal: number; roundsUsed: number } {
    if (myAnswered < this.QUESTIONS_PER_ROUND || oppAnswered < this.QUESTIONS_PER_ROUND) {
      return { result: 'incomplete', myTotal: myBaseCorrect, oppTotal: oppBaseCorrect, roundsUsed: 0 };
    }

    const myRounds = myExtraRounds ?? [];
    const oppRounds = oppExtraRounds ?? [];
    let myTotal = myBaseCorrect;
    let oppTotal = oppBaseCorrect;
    if (myTotal > oppTotal) return { result: 'won', myTotal, oppTotal, roundsUsed: 0 };
    if (myTotal < oppTotal) return { result: 'lost', myTotal, oppTotal, roundsUsed: 0 };

    for (let r = 1; r <= 50; r++) {
      const roundEnd = this.QUESTIONS_PER_ROUND + r * this.TIEBREAKER_QUESTIONS;
      const myHasRound = myAnswered >= roundEnd || myRounds.length >= r;
      const oppHasRound = oppAnswered >= roundEnd || oppRounds.length >= r;

      if (!myHasRound && !oppHasRound) {
        return { result: 'tie', tiebreakerRound: r, myTotal, oppTotal, roundsUsed: r - 1 };
      }

      if (!allowUnevenResolved && (!myHasRound || !oppHasRound)) {
        return { result: 'tie', tiebreakerRound: r, myTotal, oppTotal, roundsUsed: r - 1 };
      }

      myTotal += myHasRound ? (myRounds[r - 1] ?? 0) : 0;
      oppTotal += oppHasRound ? (oppRounds[r - 1] ?? 0) : 0;

      if (myTotal > oppTotal) return { result: 'won', myTotal, oppTotal, roundsUsed: r };
      if (myTotal < oppTotal) return { result: 'lost', myTotal, oppTotal, roundsUsed: r };
    }

    return { result: 'tie', tiebreakerRound: 50, myTotal, oppTotal, roundsUsed: 50 };
  }

  private compareStageTotals(
    myAnswered: number,
    myBaseCorrect: number,
    myExtraRounds: number[] | null | undefined,
    oppAnswered: number,
    oppBaseCorrect: number,
    oppExtraRounds: number[] | null | undefined,
    allowUnevenResolved = false,
  ): { result: 'won' | 'lost' | 'tie' | 'incomplete'; tiebreakerRound?: number } {
    const resolved = this.resolveStageTotals(
      myAnswered,
      myBaseCorrect,
      myExtraRounds,
      oppAnswered,
      oppBaseCorrect,
      oppExtraRounds,
      allowUnevenResolved,
    );
    return { result: resolved.result, tiebreakerRound: resolved.tiebreakerRound };
  }

  private getSemiHeadToHeadState(
    myQ: number,
    mySemi: number | null | undefined,
    myTB: number[] | null | undefined,
    oppQ: number,
    oppSemi: number | null | undefined,
    oppTB: number[] | null | undefined,
    allowUnevenResolved = false,
  ): { result: 'won' | 'lost' | 'tie' | 'incomplete'; tiebreakerRound?: number } {
    return this.compareStageTotals(
      myQ,
      mySemi ?? 0,
      myTB,
      oppQ,
      oppSemi ?? 0,
      oppTB,
      allowUnevenResolved,
    );
  }

  private getFinalStageBaseCorrect(prog: TournamentProgress | null | undefined): number {
    if (!prog) return 0;
    const semiTBSum = (prog.tiebreakerRoundsCorrect ?? []).reduce((a: number, b: number) => a + b, 0);
    const finalTBSum = (prog.finalTiebreakerRoundsCorrect ?? []).reduce((a: number, b: number) => a + b, 0);
    return Math.max(0, (prog.correctAnswersCount ?? 0) - (prog.semiFinalCorrectCount ?? 0) - semiTBSum - finalTBSum);
  }

  private getFinalHeadToHeadState(
    myProg: TournamentProgress | null | undefined,
    oppProg: TournamentProgress | null | undefined,
    allowUnevenResolved = false,
  ): { result: 'won' | 'lost' | 'tie' | 'incomplete'; tiebreakerRound?: number } {
    if (!myProg || !oppProg) return { result: 'incomplete' };

    const mySemiTotal = this.QUESTIONS_PER_ROUND + (myProg.tiebreakerRoundsCorrect?.length ?? 0) * this.TIEBREAKER_QUESTIONS;
    const oppSemiTotal = this.QUESTIONS_PER_ROUND + (oppProg.tiebreakerRoundsCorrect?.length ?? 0) * this.TIEBREAKER_QUESTIONS;
    const myAnswered = Math.max(0, (myProg.questionsAnsweredCount ?? 0) - mySemiTotal);
    const oppAnswered = Math.max(0, (oppProg.questionsAnsweredCount ?? 0) - oppSemiTotal);
    const myFinalTotal = this.getFinalStageBaseCorrect(myProg) + (myProg.finalTiebreakerRoundsCorrect ?? []).reduce((a: number, b: number) => a + b, 0);
    const oppFinalTotal = this.getFinalStageBaseCorrect(oppProg) + (oppProg.finalTiebreakerRoundsCorrect ?? []).reduce((a: number, b: number) => a + b, 0);

    if (allowUnevenResolved) {
      const myFinishedBaseFinal = myAnswered >= this.QUESTIONS_PER_ROUND;
      const oppFinishedBaseFinal = oppAnswered >= this.QUESTIONS_PER_ROUND;
      if (myFinishedBaseFinal && !oppFinishedBaseFinal) {
        return myFinalTotal > 0 ? { result: 'won' } : { result: 'tie' };
      }
      if (!myFinishedBaseFinal && oppFinishedBaseFinal) {
        return oppFinalTotal > 0 ? { result: 'lost' } : { result: 'tie' };
      }
    }

    return this.compareStageTotals(
      myAnswered,
      this.getFinalStageBaseCorrect(myProg),
      myProg.finalTiebreakerRoundsCorrect ?? [],
      oppAnswered,
      this.getFinalStageBaseCorrect(oppProg),
      oppProg.finalTiebreakerRoundsCorrect ?? [],
      allowUnevenResolved,
    );
  }

  private isRoundDeadlinePassed(
    roundStartedAt: Date | null | undefined,
    now: Date = new Date(),
  ): boolean {
    if (!(roundStartedAt instanceof Date)) return false;
    return now.getTime() - roundStartedAt.getTime() > ROUND_DEADLINE_HOURS * 3600000;
  }

  private getSoloFinalOutcome(
    prog: TournamentProgress | null | undefined,
    deadlinePassed = false,
  ): { result: 'won' | 'lost' | 'incomplete'; finalAnswered: number; finalCorrect: number } {
    if (!prog) return { result: 'incomplete', finalAnswered: 0, finalCorrect: 0 };
    const semiTotal = this.getSemiPhaseQuestionCount(prog);
    const finalAnswered = Math.max(0, (prog.questionsAnsweredCount ?? 0) - semiTotal);
    const finalCorrect = this.getFinalStageBaseCorrect(prog)
      + (prog.finalTiebreakerRoundsCorrect ?? []).reduce((a: number, b: number) => a + b, 0);
    if (finalAnswered >= this.QUESTIONS_PER_ROUND) {
      return { result: finalCorrect > 0 ? 'won' : 'lost', finalAnswered, finalCorrect };
    }
    if (deadlinePassed) {
      return { result: finalCorrect > 0 ? 'won' : 'lost', finalAnswered, finalCorrect };
    }
    return { result: 'incomplete', finalAnswered, finalCorrect };
  }

  private getSoloFinalistByOppositeSemiTimeout(
    tournament: Tournament,
    allProgress: TournamentProgress[],
  ): TournamentProgress | null {
    this.sortPlayersByOrder(tournament);
    const order = tournament.playerOrder ?? [];
    if (order.filter((id) => id > 0).length < 4) return null;

    const progressByUser = new Map(allProgress.map((progress) => [progress.userId, progress]));
    const semiWinner1 = this.findSemiWinner(
      progressByUser.get(order[0] ?? -1) ?? null,
      progressByUser.get(order[1] ?? -1) ?? null,
      true,
    );
    const semiWinner2 = this.findSemiWinner(
      progressByUser.get(order[2] ?? -1) ?? null,
      progressByUser.get(order[3] ?? -1) ?? null,
      true,
    );
    const semi1BothLost = this.didSemiPairBothLoseByTimeout(
      progressByUser.get(order[0] ?? -1) ?? null,
      progressByUser.get(order[1] ?? -1) ?? null,
    );
    const semi2BothLost = this.didSemiPairBothLoseByTimeout(
      progressByUser.get(order[2] ?? -1) ?? null,
      progressByUser.get(order[3] ?? -1) ?? null,
    );

    if (semiWinner1 && !semiWinner2 && semi2BothLost) return semiWinner1;
    if (!semiWinner1 && semiWinner2 && semi1BothLost) return semiWinner2;
    return null;
  }

  private getSemiPhaseQuestionCount(prog: Pick<TournamentProgress, 'tiebreakerRoundsCorrect'> | null | undefined): number {
    return this.QUESTIONS_PER_ROUND + ((prog?.tiebreakerRoundsCorrect?.length ?? 0) * this.TIEBREAKER_QUESTIONS);
  }

  private getSemiCurrentRoundTargets(
    p1: TournamentProgress | null | undefined,
    p2: TournamentProgress | null | undefined,
  ): { p1Target: number; p2Target: number } {
    const semiState = this.getSemiHeadToHeadState(
      p1?.questionsAnsweredCount ?? 0,
      p1?.semiFinalCorrectCount,
      p1?.tiebreakerRoundsCorrect,
      p2?.questionsAnsweredCount ?? 0,
      p2?.semiFinalCorrectCount,
      p2?.tiebreakerRoundsCorrect,
    );
    const extraRounds = semiState.result === 'tie' ? (semiState.tiebreakerRound ?? 1) : 0;
    const target = this.QUESTIONS_PER_ROUND + extraRounds * this.TIEBREAKER_QUESTIONS;
    return { p1Target: target, p2Target: target };
  }

  private getFinalCurrentRoundTargets(
    p1: TournamentProgress | null | undefined,
    p2: TournamentProgress | null | undefined,
  ): { p1Target: number; p2Target: number } {
    const p1SemiTotal = this.getSemiPhaseQuestionCount(p1);
    const p2SemiTotal = this.getSemiPhaseQuestionCount(p2);
    const finalState = this.getFinalHeadToHeadState(p1, p2);
    const extraRounds = finalState.result === 'tie' ? (finalState.tiebreakerRound ?? 1) : 0;
    return {
      p1Target: p1SemiTotal + this.QUESTIONS_PER_ROUND + extraRounds * this.TIEBREAKER_QUESTIONS,
      p2Target: p2SemiTotal + this.QUESTIONS_PER_ROUND + extraRounds * this.TIEBREAKER_QUESTIONS,
    };
  }

  private getSharedSemiTiebreakerStart(
    myProg: TournamentProgress | undefined | null,
    oppProg: TournamentProgress | undefined | null,
  ): Date | null {
    if (!myProg) return null;
    if (!oppProg) return null;
    if (!(myProg.roundStartedAt instanceof Date) || !(oppProg.roundStartedAt instanceof Date)) return null;

    const myQ = myProg.questionsAnsweredCount ?? 0;
    const oppQ = oppProg.questionsAnsweredCount ?? 0;
    const semiState = this.getSemiHeadToHeadState(
      myQ,
      myProg.semiFinalCorrectCount,
      myProg.tiebreakerRoundsCorrect,
      oppQ,
      oppProg.semiFinalCorrectCount,
      oppProg.tiebreakerRoundsCorrect,
    );

    const maxStart = (...progs: (TournamentProgress | undefined | null)[]): Date | null => {
      const dates = progs
        .map((p) => p?.roundStartedAt)
        .filter((dt): dt is Date => dt instanceof Date);
      return dates.length > 0 ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
    };

    if (semiState.result !== 'tie') {
      return maxStart(myProg, oppProg);
    }

    const roundEnd = this.QUESTIONS_PER_ROUND + (semiState.tiebreakerRound ?? 1) * this.TIEBREAKER_QUESTIONS;
    const activeRoundStarts = [myProg, oppProg]
      .filter((prog) => (prog.questionsAnsweredCount ?? 0) < roundEnd)
      .map((prog) => prog.roundStartedAt)
      .filter((dt): dt is Date => dt instanceof Date);

    if (activeRoundStarts.length > 0) {
      return new Date(Math.max(...activeRoundStarts.map((dt) => dt.getTime())));
    }

    return maxStart(myProg, oppProg);
  }

  private async syncSemiPairStartOnJoin(
    tournamentId: number,
    playerOrder: number[] | null | undefined,
    playerSlot: number,
    joinedAt: Date,
  ): Promise<void> {
    if (!playerOrder || playerSlot < 0 || playerSlot >= playerOrder.length) return;
    const opponentSlot = playerSlot % 2 === 0 ? playerSlot + 1 : playerSlot - 1;
    if (opponentSlot < 0 || opponentSlot >= playerOrder.length) return;

    const joinedUserId = playerOrder[playerSlot] ?? -1;
    const opponentUserId = playerOrder[opponentSlot] ?? -1;
    if (joinedUserId <= 0 || opponentUserId <= 0) return;

    const pairUserIds = [joinedUserId, opponentUserId];
    const existing = await this.tournamentProgressRepository.find({
      where: { tournamentId, userId: In(pairUserIds) },
    });
    const progressByUserId = new Map(existing.map((row) => [row.userId, row]));

    for (const pairUserId of pairUserIds) {
      const existingProgress = progressByUserId.get(pairUserId);
      if (existingProgress) {
        existingProgress.roundStartedAt = joinedAt;
        await this.tournamentProgressRepository.save(existingProgress);
        continue;
      }

      const progress = this.tournamentProgressRepository.create({
        userId: pairUserId,
        tournamentId,
        questionsAnsweredCount: 0,
        correctAnswersCount: 0,
        currentQuestionIndex: 0,
        lockedAnswerCount: 0,
        roundStartedAt: joinedAt,
        leftAt: null,
        timeLeftSeconds: null,
      });
      await this.tournamentProgressRepository.save(progress);
    }
  }

  private getCurrentRoundSharedStart(
    tournament: Tournament,
    userId: number,
    myProg: TournamentProgress | undefined | null,
    allProgress: TournamentProgress[],
  ): Date | null {
    if (!myProg) return null;

    this.sortPlayersByOrder(tournament);
    const playerSlot = tournament.playerOrder?.indexOf(userId) ?? -1;
    if (playerSlot < 0) return null;

    const inFinal = this.isPlayerInFinalPhase(myProg, allProgress, tournament);
    if (inFinal) {
      const otherSlots: [number, number] = playerSlot < 2 ? [2, 3] : [0, 1];
      const fOpp1 = otherSlots[0] < (tournament.playerOrder?.length ?? 0) ? (tournament.playerOrder![otherSlots[0]]) : -1;
      const fOpp2 = otherSlots[1] < (tournament.playerOrder?.length ?? 0) ? (tournament.playerOrder![otherSlots[1]]) : -1;
      const fPr1 = fOpp1 > 0 ? allProgress.find((p) => p.tournamentId === tournament.id && p.userId === fOpp1) : null;
      const fPr2 = fOpp2 > 0 ? allProgress.find((p) => p.tournamentId === tournament.id && p.userId === fOpp2) : null;
      let finalOppProg: TournamentProgress | null = null;
      if (fPr1 && fPr2) {
        const st = this.getSemiHeadToHeadState(
          fPr1.questionsAnsweredCount ?? 0,
          fPr1.semiFinalCorrectCount,
          fPr1.tiebreakerRoundsCorrect,
          fPr2.questionsAnsweredCount ?? 0,
          fPr2.semiFinalCorrectCount,
          fPr2.tiebreakerRoundsCorrect,
        );
        if (st.result === 'won') finalOppProg = fPr1;
        else if (st.result === 'lost') finalOppProg = fPr2;
      } else {
        finalOppProg = fPr1 ?? fPr2 ?? null;
      }
      if (finalOppProg && this.isPlayerInFinalPhase(finalOppProg, allProgress, tournament)) {
        const shared = this.getSharedSemiTiebreakerStart(myProg, finalOppProg);
        if (shared) return shared;
        // Соперник в финале уже ответил на все вопросы финала — у него таймера нет; у входящего (текущий игрок) берём его roundStartedAt, чтобы таймер загорелся у входящего.
        const oppSemiTotal = this.QUESTIONS_PER_ROUND + (finalOppProg.tiebreakerRoundsCorrect?.length ?? 0) * this.TIEBREAKER_QUESTIONS;
        if (myProg.roundStartedAt instanceof Date && (finalOppProg.questionsAnsweredCount ?? 0) >= oppSemiTotal + this.QUESTIONS_PER_ROUND) {
          return myProg.roundStartedAt;
        }
      }
      const soloFinalist = this.getSoloFinalistByOppositeSemiTimeout(tournament, allProgress);
      if (soloFinalist?.userId === userId && myProg.roundStartedAt instanceof Date) {
        return myProg.roundStartedAt;
      }
      return null;
    }

    const oppSlot = playerSlot % 2 === 0 ? playerSlot + 1 : playerSlot - 1;
    const oppId = oppSlot >= 0 && tournament.playerOrder && oppSlot < tournament.playerOrder.length
      ? tournament.playerOrder[oppSlot]
      : null;
    const oppProg = oppId != null && oppId > 0
      ? allProgress.find((p) => p.tournamentId === tournament.id && p.userId === oppId)
      : null;
    return this.getSharedSemiTiebreakerStart(myProg, oppProg);
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

    if (oppId == null || oppId <= 0) return false;

    const oppProg = allProgress.find((p) => p.tournamentId === myProg.tournamentId && p.userId === oppId);
    if (!oppProg || oppProg.semiFinalCorrectCount == null) {
      return myQ > mySemiTotal;
    }

    const semiState = this.getSemiHeadToHeadState(
      myQ,
      mySemi,
      myProg.tiebreakerRoundsCorrect,
      oppProg.questionsAnsweredCount ?? 0,
      oppProg.semiFinalCorrectCount,
      oppProg.tiebreakerRoundsCorrect,
    );
    if (semiState.result !== 'won') return false;

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
   * Старые недозаполненные турниры остаются открытыми для новых игроков.
   */
  private async cancelUnfilledTournaments(): Promise<void> {
    return;
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
          return null;
        };

        const sharedDeadlinePassed = (uid1: number, uid2: number): boolean => {
          const s1 = getPlayerRoundStart(uid1);
          const s2 = getPlayerRoundStart(uid2);
          if (!s1 || !s2) return false;
          const shared = Math.max(s1.getTime(), s2.getTime());
          return now.getTime() - shared > roundCutoffMs;
        };

        const saveResult = async (uid: number, passed: boolean) => {
          let row = await this.tournamentResultRepository.findOne({ where: { userId: uid, tournamentId: tournament.id } });
          if (row) { row.passed = passed ? 1 : 0; if (!row.completedAt) row.completedAt = new Date(); await this.tournamentResultRepository.save(row); }
          else { await this.tournamentResultRepository.save(this.tournamentResultRepository.create({ userId: uid, tournamentId: tournament.id, passed: passed ? 1 : 0, completedAt: new Date() })); }
        };

        let tournamentResolved = false;
        const semiOutcomes: Array<{ winnerId: number | null; bothLost: boolean }> = [
          { winnerId: null, bothLost: false },
          { winnerId: null, bothLost: false },
        ];

        for (const [pairIndex, pair] of ([[0, 1], [2, 3]] as const).entries()) {
          const id1 = pair[0] < order.length ? order[pair[0]] : -1;
          const id2 = pair[1] < order.length ? order[pair[1]] : -1;
          if (id1 <= 0 || id2 <= 0) continue;
          if (!sharedDeadlinePassed(id1, id2)) continue;

          const prog1 = allProg.find((p) => p.userId === id1) ?? null;
          const prog2 = allProg.find((p) => p.userId === id2) ?? null;
          const semiTargets = this.getSemiCurrentRoundTargets(prog1, prog2);

          const p1Finished = (prog1?.questionsAnsweredCount ?? 0) >= semiTargets.p1Target;
          const p2Finished = (prog2?.questionsAnsweredCount ?? 0) >= semiTargets.p2Target;

          if (p1Finished && !p2Finished) {
            this.logger.log(`[closeTimedOutRounds] T${tournament.id}: player ${id2} timed out, ${id1} wins`);
            await saveResult(id2, false);
            semiOutcomes[pairIndex] = { winnerId: id1, bothLost: false };
          } else if (p2Finished && !p1Finished) {
            this.logger.log(`[closeTimedOutRounds] T${tournament.id}: player ${id1} timed out, ${id2} wins`);
            await saveResult(id1, false);
            semiOutcomes[pairIndex] = { winnerId: id2, bothLost: false };
          } else if (!p1Finished && !p2Finished) {
            this.logger.log(`[closeTimedOutRounds] T${tournament.id}: both ${id1} and ${id2} timed out`);
            await saveResult(id1, false);
            await saveResult(id2, false);
            semiOutcomes[pairIndex] = { winnerId: null, bothLost: true };
          }
        }

        if (realCount === 2) {
          const headToHeadOutcome = semiOutcomes[0];
          if (headToHeadOutcome) {
            if (headToHeadOutcome.bothLost) {
              tournamentResolved = true;
            } else if (headToHeadOutcome.winnerId) {
              const loserId = headToHeadOutcome.winnerId === order[0] ? order[1] : order[0];
              if (loserId > 0) await saveResult(loserId, false);
              await saveResult(headToHeadOutcome.winnerId, true);
              tournamentResolved = true;
            }
          }
        }

        const finalists: number[] = [];
        for (const prog of allProg) {
          if (this.isPlayerInFinalPhase(prog, allProg, tournament)) {
            finalists.push(prog.userId);
          }
        }

        if (finalists.length === 1) {
          const soloFinalistId = finalists[0]!;
          const otherSemiBothLost = semiOutcomes.some((outcome) => outcome.bothLost);
          const winnerSemiResolved = semiOutcomes.some((outcome) => outcome.winnerId === soloFinalistId);
          if (otherSemiBothLost && winnerSemiResolved) {
            const soloProg = allProg.find((p) => p.userId === soloFinalistId) ?? null;
            const soloOutcome = this.getSoloFinalOutcome(
              soloProg,
              this.isRoundDeadlinePassed(soloProg?.roundStartedAt ?? null, now),
            );
            if (soloOutcome.result === 'won') {
              this.logger.log(`[closeTimedOutRounds] T${tournament.id}: solo finalist ${soloFinalistId} wins with ${soloOutcome.finalCorrect} correct`);
              await saveResult(soloFinalistId, true);
              tournamentResolved = true;
            } else if (soloOutcome.result === 'lost') {
              this.logger.log(`[closeTimedOutRounds] T${tournament.id}: solo finalist ${soloFinalistId} loses (${soloOutcome.finalCorrect} correct, ${soloOutcome.finalAnswered}/10 answered)`);
              await saveResult(soloFinalistId, false);
              tournamentResolved = true;
            }
          }
        } else if (finalists.length === 2) {
          const f1 = finalists[0], f2 = finalists[1];
          if (!sharedDeadlinePassed(f1, f2)) { /* wait */ }
          else {
            const f1Prog = allProg.find((p) => p.userId === f1) ?? null;
            const f2Prog = allProg.find((p) => p.userId === f2) ?? null;
            const finalTargets = this.getFinalCurrentRoundTargets(f1Prog, f2Prog);
            const f1Finished = (f1Prog?.questionsAnsweredCount ?? 0) >= finalTargets.p1Target;
            const f2Finished = (f2Prog?.questionsAnsweredCount ?? 0) >= finalTargets.p2Target;

            const getFinalCorrectCount = (uid: number): number => {
              const prog = allProg.find((p) => p.userId === uid);
              if (!prog) return 0;
              const total = prog.correctAnswersCount ?? 0;
              const semi = prog.semiFinalCorrectCount ?? 0;
              const tbSum = (prog.tiebreakerRoundsCorrect ?? []).reduce((a: number, b: number) => a + b, 0);
              return total - semi - tbSum;
            };

            if (f1Finished && !f2Finished) {
              const f1c = getFinalCorrectCount(f1);
              if (f1c === 0) {
                this.logger.log(`[closeTimedOutRounds] T${tournament.id} final: ${f1} finished with 0 correct, ${f2} timed out → both lose`);
                await saveResult(f1, false);
                await saveResult(f2, false);
              } else {
                this.logger.log(`[closeTimedOutRounds] T${tournament.id} final: ${f2} timed out, ${f1} wins (${f1c} correct)`);
                await saveResult(f1, true);
                await saveResult(f2, false);
              }
              tournamentResolved = true;
            } else if (f2Finished && !f1Finished) {
              const f2c = getFinalCorrectCount(f2);
              if (f2c === 0) {
                this.logger.log(`[closeTimedOutRounds] T${tournament.id} final: ${f2} finished with 0 correct, ${f1} timed out → both lose`);
                await saveResult(f1, false);
                await saveResult(f2, false);
              } else {
                this.logger.log(`[closeTimedOutRounds] T${tournament.id} final: ${f1} timed out, ${f2} wins (${f2c} correct)`);
                await saveResult(f2, true);
                await saveResult(f1, false);
              }
              tournamentResolved = true;
            } else if (!f1Finished && !f2Finished) {
              this.logger.log(`[closeTimedOutRounds] T${tournament.id} final: both finalists timed out`);
              await saveResult(f1, false);
              await saveResult(f2, false);
              tournamentResolved = true;
            }
          }
        }

        if (tournamentResolved) {
          tournament.status = TournamentStatus.FINISHED;
          await this.tournamentRepository.update({ id: tournament.id }, { status: TournamentStatus.FINISHED });
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
    await this.tournamentEscrowRepository.query(
      'UPDATE tournament_escrow SET status = \'held\' WHERE status = \'processing\' AND "createdAt" < NOW() - INTERVAL \'5 minutes\'',
    );
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
    const existingWinTransactions = await this.transactionRepository.find({
      where: { tournamentId, category: 'win' },
    });
    const existingRefundTransactions = await this.transactionRepository.find({
      where: { tournamentId, category: 'refund' },
    });
    const refundedUserIds = new Set(existingRefundTransactions.map((tx) => tx.userId));

    const leagueAmount = tournament.leagueAmount ?? 0;
    const prize = getLeaguePrize(leagueAmount);
    const realPlayerCount = (tournament.playerOrder?.filter((id) => id > 0).length) ?? 0;
    const finalQuestionCount = await this.questionRepository.count({
      where: { tournament: { id: tournamentId }, roundIndex: 2 },
    });
    const canPayFinalPrize = realPlayerCount === 4 && (finalQuestionCount > 0 || winners.length === 1);

    if (winners.length === 1) {
      if (!canPayFinalPrize) {
        this.logger.warn(`[processTournamentEscrow] Skip payout for tournament ${tournamentId}: no valid final winner context`);
        await this.tournamentEscrowRepository.query(
          'UPDATE tournament_escrow SET status = \'held\' WHERE "tournamentId" = $1 AND status = \'processing\'',
          [tournamentId],
        );
        return;
      }
      const winnerId = winners[0]!;
      const winnerAlreadyPaid = existingWinTransactions.some((tx) => tx.userId === winnerId);
      if (prize > 0 && winnerId > 0 && !winnerAlreadyPaid) {
        await this.usersService.addToBalanceL(
          winnerId,
          prize,
          `Выигрыш за турнир, ${getLeagueName(leagueAmount)}, ID ${tournamentId}`,
          'win',
          tournamentId,
        );
        await this.usersService.distributeReferralRewards(winnerId, leagueAmount, tournamentId);
      } else if (winnerAlreadyPaid) {
        this.logger.warn(`[processTournamentEscrow] Skip duplicate winner payout for tournament ${tournamentId}, user ${winnerId}`);
      }
      await this.tournamentEscrowRepository.query(
        'UPDATE tournament_escrow SET status = \'paid_to_winner\' WHERE "tournamentId" = $1 AND status = \'processing\'',
        [tournamentId],
      );
    } else {
      for (const row of claimed) {
        const uid = row.userId ?? (row as any).userid;
        const amt = Number(row.amount ?? (row as any).amt ?? 0);
        if (!uid || uid <= 0 || !amt || amt <= 0) {
          console.warn(`[processTournamentEscrow] Skipping invalid escrow row ${row.id}: userId=${uid}, amount=${amt}, tournamentId=${tournamentId}`);
          continue;
        }
        if (refundedUserIds.has(uid)) {
          this.logger.warn(`[processTournamentEscrow] Skip duplicate refund for tournament ${tournamentId}, user ${uid}`);
          continue;
        }
        await this.usersService.addToBalanceL(
          uid,
          amt,
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

  private buildQuestionUniqueKey(question: string): string {
    return this.sanitizeUtf8ForDisplay(String(question ?? '')).trim().toLowerCase();
  }

  private async getTournamentQuestionKeySet(
    tournamentId: number,
    excludeRoundIndexes: number[] = [],
  ): Promise<Set<string>> {
    const questions = await this.questionRepository.find({
      where: { tournament: { id: tournamentId } },
      select: ['question', 'roundIndex'],
      order: { roundIndex: 'ASC', id: 'ASC' },
    });
    const excluded = new Set(excludeRoundIndexes);
    const keys = new Set<string>();
    for (const q of questions) {
      if (excluded.has(q.roundIndex)) continue;
      keys.add(this.buildQuestionUniqueKey(q.question));
    }
    return keys;
  }

  private async pickFromDB(
    n: number,
    excludedQuestionKeys: Set<string> = new Set(),
  ): Promise<{ question: string; options: string[]; correctAnswer: number }[]> {
    const normalizedExcluded = new Set<string>(
      [...excludedQuestionKeys].map((key) => this.buildQuestionUniqueKey(key)),
    );
    const collectUnique = (rows: QuestionPoolItem[]): { question: string; options: string[]; correctAnswer: number }[] => {
      const seen = new Set<string>(normalizedExcluded);
      const unique: { question: string; options: string[]; correctAnswer: number }[] = [];
      for (const r of rows) {
        const key = this.buildQuestionUniqueKey(r.question);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        unique.push({
          question: this.sanitizeUtf8ForDisplay(r.question),
          options: Array.isArray(r.options) ? r.options.map((o) => this.sanitizeUtf8ForDisplay(String(o))) : [],
          correctAnswer: r.correctAnswer,
        });
        if (unique.length >= n) break;
      }
      return unique;
    };

    const sampledRows = await this.questionPoolRepository
      .createQueryBuilder('q')
      .orderBy('RANDOM()')
      .limit(Math.max(n * 10, 50))
      .getMany();

    let unique = collectUnique(sampledRows);
    if (unique.length < n) {
      const allRows = await this.questionPoolRepository.find();
      unique = collectUnique(this.shuffle(allRows));
    }

    if (unique.length < n) {
      throw new BadRequestException(`Недостаточно уникальных вопросов для генерации турнира: нужно ${n}, найдено ${unique.length}.`);
    }
    return unique.slice(0, n);
  }

  private async pickRandomQuestions(
    n: number,
    excludedQuestionKeys: Set<string> = new Set(),
  ): Promise<Omit<Question, 'id' | 'tournament' | 'roundIndex'>[]> {
    return this.pickFromDB(n, excludedQuestionKeys);
  }

  private async pickQuestionsForSemi(): Promise<{
    semi1: Omit<Question, 'id' | 'tournament' | 'roundIndex'>[];
    semi2: Omit<Question, 'id' | 'tournament' | 'roundIndex'>[];
  }> {
    const semiQuestions = await this.pickFromDB(20);
    return {
      semi1: semiQuestions.slice(0, 10),
      semi2: semiQuestions.slice(10, 20),
    };
  }

  private async pickQuestionsForFinal(tournamentId: number): Promise<Omit<Question, 'id' | 'tournament' | 'roundIndex'>[]> {
    const excludedKeys = await this.getTournamentQuestionKeySet(tournamentId);
    return this.pickFromDB(10, excludedKeys);
  }

  /** Тренировка: присоединиться к существующему турниру или создать новый (до 4 игроков, как money-режим, но без ставки). */
  async startTraining(userId: number): Promise<{
    tournamentId: number;
    gameStartedAt: string;
    deadline: string | null;
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

    const reusableTournaments = await this.tournamentRepository.find({
      where: [
        { status: TournamentStatus.WAITING, gameType: 'training' },
        { status: TournamentStatus.ACTIVE, gameType: 'training' },
      ],
      relations: ['players'],
      order: { id: 'ASC' },
    });
    const waitingIds = reusableTournaments.map((t) => t.id);
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
    const waitingTournament = reusableTournaments.find((t) => {
      if (t.players.some((p) => p.id === userId)) return false;
      if (t.players.length >= 4) return false;
      return true;
    });

    let tournament: Tournament;
    let playerSlot: number;
    let isCreator: boolean;
    const joinedAt = new Date();

    if (waitingTournament) {
      tournament = waitingTournament;
      await this.ensureTournamentPlayer(tournament.id, user.id);
      const newOrder = [...(tournament.playerOrder ?? []), user.id];
      await this.tournamentRepository.update({ id: tournament.id }, { playerOrder: newOrder });
      tournament.playerOrder = newOrder;
      playerSlot = newOrder.length - 1;
      isCreator = false;
      await this.tournamentEntryRepository.save(
        this.tournamentEntryRepository.create({ tournament, user, joinedAt }),
      );
      await this.syncSemiPairStartOnJoin(tournament.id, newOrder, playerSlot, joinedAt);
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
      id: q.id,
      question: this.sanitizeUtf8ForDisplay(q.question),
      options: (Array.isArray(q.options) ? q.options : []).map((o) => this.sanitizeUtf8ForDisplay(String(o))),
      correctAnswer: q.correctAnswer,
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

    return {
      tournamentId: tournament.id,
      gameStartedAt: joinedAt.toISOString(),
      deadline: null,
      questionsSemi1,
      questionsSemi2,
      questionsFinal: [],
      playerSlot,
      totalPlayers: (tournament.playerOrder ?? []).length || tournament.players?.length || 0,
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
      await this.ensureTournamentPlayer(tournament.id, user.id);
      const newOrder = [...(tournament.playerOrder ?? []), user.id];
      await this.tournamentRepository.update({ id: tournament.id }, { playerOrder: newOrder });
      playerSlot = newOrder.length - 1;
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
    deadline: string | null;
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

    const reusableTournaments = await this.tournamentRepository.find({
      where: [
        { status: TournamentStatus.WAITING, gameType: 'money', leagueAmount },
        { status: TournamentStatus.ACTIVE, gameType: 'money', leagueAmount },
      ],
      relations: ['players'],
      order: { id: 'ASC' },
    });
    const moneyWaitingIds = reusableTournaments.map((t) => t.id);
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
    const waitingTournament = reusableTournaments.find((t) => {
      if (t.players.some((p) => p.id === userId)) return false;
      if (t.players.length >= 4) return false;
      return true;
    });

    let tournament: Tournament;
    let playerSlot: number;
    let isCreator: boolean;

    const joinedAt = new Date();

    if (waitingTournament) {
      tournament = waitingTournament;
      await this.ensureTournamentPlayer(tournament.id, user.id);
      const newOrder = [...(tournament.playerOrder ?? []), user.id];
      await this.tournamentRepository.update({ id: tournament.id }, { playerOrder: newOrder });
      tournament.playerOrder = newOrder;
      playerSlot = newOrder.length - 1;
      isCreator = false;
      await this.tournamentEntryRepository.save(
        this.tournamentEntryRepository.create({ tournament, user, joinedAt }),
      );
      await this.syncSemiPairStartOnJoin(tournament.id, newOrder, playerSlot, joinedAt);
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
        const conn = this.tournamentRepository.manager.connection;
        await conn.query(
          'DELETE FROM tournament_players_user WHERE "tournamentId" = $1 AND "userId" = $2',
          [tournament.id, userId],
        ).catch(() => {});
        const newOrder = (tournament.playerOrder ?? []).filter((id) => id !== userId);
        await this.tournamentRepository.update({ id: tournament.id }, { playerOrder: newOrder });
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
      totalPlayers: (tournament.playerOrder ?? []).length || tournament.players?.length || 0,
      semiIndex,
      positionInSemi,
      isCreator,
      gameStartedAt: joinedAt.toISOString(),
      deadline: null,
    };
  }

  /** DTO элемента списка активных/завершённых турниров. */
  async getMyTournaments(
    userId: number,
    mode?: 'training' | 'money',
    currentTournamentId?: number,
  ): Promise<{
    active: TournamentListItemDto[];
    completed: TournamentListItemDto[];
  }> {
    // Старые записи: gameType IS NULL — если есть leagueAmount, то money, иначе training (не затирать денежные турниры)
    await this.tournamentRepository.update(
      { gameType: IsNull(), leagueAmount: Not(IsNull()) },
      { gameType: 'money' },
    );
    await this.tournamentRepository.update(
      { gameType: IsNull(), leagueAmount: IsNull() },
      { gameType: 'training' },
    );
    // Восстановить денежные турниры, ошибочно помеченные как training (например после старого UPDATE)
    await this.tournamentRepository.update(
      { gameType: 'training', leagueAmount: Not(IsNull()) },
      { gameType: 'money' },
    );

    await this.backfillTournamentPlayersFromEntry().catch(() => {});
    if (mode === 'money') {
      await this.processAllExpiredEscrows().catch((e) => this.logger.warn('[getMyTournaments] processAllExpiredEscrows', (e as Error)?.message));
      await this.syncTournamentPlayersFromEntry(userId).catch((e) => this.logger.warn('[getMyTournaments] syncTournamentPlayersFromEntry', (e as Error)?.message));
    }

    const tids = new Set<number>();

    try {
      const fromProgress = await this.tournamentProgressRepository.find({
        where: { userId },
        select: ['tournamentId'],
      });
      for (const p of fromProgress) if (p.tournamentId > 0) tids.add(p.tournamentId);
    } catch (e) {
      this.logger.warn('[getMyTournaments] fromProgress', (e as Error)?.message);
    }
    try {
      const fromEntry = await this.tournamentEntryRepository.find({
        where: { user: { id: userId } },
        relations: ['tournament'],
      });
      for (const e of fromEntry) {
        const tid = (e.tournament as Tournament)?.id ?? (e as { tournamentId?: number }).tournamentId;
        if (tid && tid > 0) tids.add(tid);
      }
    } catch (e) {
      this.logger.warn('[getMyTournaments] fromEntry', (e as Error)?.message);
    }
    try {
      const fromPlayers = await this.tournamentRepository
        .createQueryBuilder('t')
        .innerJoin('t.players', 'p', 'p.id = :userId', { userId })
        .select('t.id')
        .getMany();
      for (const t of fromPlayers) if (t.id > 0) tids.add(t.id);
    } catch (e) {
      this.logger.warn('[getMyTournaments] fromPlayers', (e as Error)?.message);
    }
    try {
      const rawPlayerOrder = await this.tournamentRepository.manager.connection.query(
        `SELECT t.id
         FROM tournament t
         WHERE EXISTS (
           SELECT 1
           FROM json_array_elements_text(
             CASE
               WHEN t."playerOrder" IS NULL OR t."playerOrder" IN ('', 'null') THEN '[]'::json
               ELSE t."playerOrder"::json
             END
           ) AS ord(value)
           WHERE (ord.value)::int = $1
         )`,
        [userId],
      );
      for (const row of (Array.isArray(rawPlayerOrder) ? rawPlayerOrder : [])) {
        if (row?.id > 0) tids.add(Number(row.id));
      }
    } catch (e) {
      this.logger.warn('[getMyTournaments] fromPlayerOrder', (e as Error)?.message);
      try {
        const rawPlayerOrderSnake = await this.tournamentRepository.manager.connection.query(
          `SELECT t.id
           FROM tournament t
           WHERE EXISTS (
             SELECT 1
             FROM json_array_elements_text(
               CASE
                 WHEN t.player_order IS NULL OR t.player_order IN ('', 'null') THEN '[]'::json
                 ELSE t.player_order::json
               END
             ) AS ord(value)
             WHERE (ord.value)::int = $1
           )`,
          [userId],
        );
        for (const row of (Array.isArray(rawPlayerOrderSnake) ? rawPlayerOrderSnake : [])) {
          if (row?.id > 0) tids.add(Number(row.id));
        }
      } catch (_) {}
    }

    if (tids.size === 0) {
      const conn = this.tournamentRepository.manager.connection;
      const addIdsFromRaw = (raw: unknown): void => {
        const res = raw as { rows?: unknown[] };
        const rows = Array.isArray(raw) ? raw : (res?.rows ?? []) as { id?: number; tournamentId?: number }[];
        for (const r of rows) {
          const id = r?.id ?? r?.tournamentId;
          if (id != null && id > 0) tids.add(Number(id));
        }
      };
      try {
        const rawCamel = await conn.query(
          `(SELECT p."tournamentId" AS id FROM tournament_progress p WHERE p."userId" = $1)
           UNION
           (SELECT e."tournamentId" AS id FROM tournament_entry e WHERE e."userId" = $1)
           UNION
           (SELECT tpu."tournamentId" AS id FROM tournament_players_user tpu WHERE tpu."userId" = $1)`,
          [userId],
        );
        addIdsFromRaw(rawCamel);
      } catch (_) {}
      if (tids.size === 0) {
        try {
          const rawSnake = await conn.query(
            `(SELECT p.tournament_id AS id FROM tournament_progress p WHERE p.user_id = $1)
             UNION
             (SELECT e.tournament_id AS id FROM tournament_entry e WHERE e.user_id = $1)
             UNION
             (SELECT tpu.tournament_id AS id FROM tournament_players_user tpu WHERE tpu.user_id = $1)`,
            [userId],
          );
          addIdsFromRaw(rawSnake);
        } catch (_) {}
      }
    }

    const ids = [...tids];

    let tournaments: Tournament[];
    if (ids.length === 0) {
      tournaments = [];
    } else {
      const list = await this.tournamentRepository.find({
        where: { id: In(ids) },
        relations: ['players'],
        order: { createdAt: 'DESC' },
      });
      if (mode === 'money') {
        tournaments = list.filter(
          (t) => t.gameType === 'money' || (t.gameType == null && t.leagueAmount != null),
        );
      } else {
        tournaments = list.filter(
          (t) => t.gameType === 'training' || (t.gameType == null && t.leagueAmount == null),
        );
      }
    }

    const allIds = tournaments.map((t) => t.id);
    if (allIds.length > 0) {
      await this.backfillTournamentResultCompletedAt(allIds).catch(() => {});
    }
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

    const deadlineByTournamentId: Record<number, string | null> = {};
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
        const t = tournaments.find((t2) => t2.id === tid);
        const sharedStart = t && myProg ? this.getCurrentRoundSharedStart(t, userId, myProg, allProgress) : null;
        deadlineByTournamentId[tid] = sharedStart
          ? this.getRoundDeadline(sharedStart)
          : null;
        const ownStart = myProg?.roundStartedAt ?? null;
        roundStartedAtByTid.set(tid, ownStart ? (ownStart instanceof Date ? ownStart.toISOString() : String(ownStart)) : null);
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
        const semiState = this.getSemiHeadToHeadState(
          pr1.questionsAnsweredCount ?? 0,
          pr1.semiFinalCorrectCount,
          pr1.tiebreakerRoundsCorrect,
          pr2.questionsAnsweredCount ?? 0,
          pr2.semiFinalCorrectCount,
          pr2.tiebreakerRoundsCorrect,
        );
        return semiState.result === 'won' || semiState.result === 'lost';
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
          const semiState = this.getSemiHeadToHeadState(
            myQ,
            mySemi,
            myProg.tiebreakerRoundsCorrect,
            oppProg.questionsAnsweredCount ?? 0,
            oppProg.semiFinalCorrectCount,
            oppProg.tiebreakerRoundsCorrect,
          );
          if (semiState.result === 'won') {
            if (myQ < mySemiTotal) { playerRoundFinished.set(tid, true); }
            else if (myQ >= mySemiTotal + 10) { playerRoundFinished.set(tid, true); }
            else { playerRoundFinished.set(tid, false); }
          } else if (semiState.result === 'lost') {
            playerRoundFinished.set(tid, true);
          } else {
            const tbRound = semiState.tiebreakerRound ?? 1;
            const roundEnd = 10 + tbRound * 10;
            playerRoundFinished.set(tid, myQ >= roundEnd);
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

    type ProgressData = {
      userId: number;
      q: number;
      semiCorrect: number | null;
      totalCorrect: number;
      currentIndex: number;
      tiebreakerRounds: number[];
      finalTiebreakerRounds: number[];
      roundStartedAt: Date | null;
      leftAt: Date | null;
    };
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
          userId: p.userId,
          q: adjustedQ,
          semiCorrect: p.semiFinalCorrectCount,
          totalCorrect: p.correctAnswersCount ?? 0,
          currentIndex: p.currentQuestionIndex,
          tiebreakerRounds: Array.isArray(p.tiebreakerRoundsCorrect) ? p.tiebreakerRoundsCorrect : [],
          finalTiebreakerRounds: Array.isArray((p as any).finalTiebreakerRoundsCorrect) ? (p as any).finalTiebreakerRoundsCorrect : [],
          roundStartedAt: p.roundStartedAt ?? null,
          leftAt: p.leftAt ?? null,
        };
        if (p.userId === userId) progressByTid.set(p.tournamentId, data);
        if (!progressByTidAndUser.has(p.tournamentId)) {
          progressByTidAndUser.set(p.tournamentId, new Map());
        }
        progressByTidAndUser.get(p.tournamentId)!.set(p.userId, data);
      }
    }

    const lostSemiByTid = new Map<number, boolean>();

    const getPlayerCount = (t: Tournament): number =>
      t.playerOrder?.length ?? t.players?.length ?? 0;

    const getMoneySemiResult = (
      t: Tournament,
    ): { result: 'won' | 'lost' | 'tie' | 'incomplete'; tiebreakerRound?: number; noOpponent?: boolean } => {
      const order = t.playerOrder;
      if (!order || order.length < 2) return { result: 'incomplete' };
      const playerSlot = order.indexOf(userId);
      if (playerSlot < 0) return { result: 'incomplete' };
      const opponentSlot = playerSlot % 2 === 0 ? playerSlot + 1 : playerSlot - 1;

      const noOpponent =
        opponentSlot < 0 ||
        opponentSlot >= order.length ||
        (order[opponentSlot] ?? -1) <= 0;

      // В паре нет соперника (ожидание игрока) — не считаем победой, турнир остаётся в активных.
      if (noOpponent) return { result: 'incomplete', noOpponent: true };

      const opponentId = order[opponentSlot];

      const myProgress = progressByTidAndUser.get(t.id)?.get(userId);
      const oppProgress = progressByTidAndUser.get(t.id)?.get(opponentId);
      const myQ = myProgress?.q ?? 0;
      const oppQ = oppProgress?.q ?? 0;
      const mySemi = myProgress?.semiCorrect ?? 0;
      const oppSemi = oppProgress?.semiCorrect ?? 0;
      const myTB = myProgress?.tiebreakerRounds ?? [];
      const oppTB = oppProgress?.tiebreakerRounds ?? [];
      const semiState = this.getSemiHeadToHeadState(
        myQ,
        mySemi,
        myTB,
        oppQ,
        oppSemi,
        oppTB,
        t.status === TournamentStatus.FINISHED,
      );
      if (semiState.result === 'tie' && semiState.tiebreakerRound != null && isTimeExpired(t)) {
        const roundEnd = QUESTIONS_PER_ROUND + semiState.tiebreakerRound * TIEBREAKER_QUESTIONS;
        if (myQ >= roundEnd && oppQ < roundEnd) return { result: 'won', tiebreakerRound: semiState.tiebreakerRound };
        if (myQ < roundEnd && oppQ >= roundEnd) return { result: 'lost' };
      }
      return semiState;
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
        const semiState = this.getSemiHeadToHeadState(
          prog1?.q ?? 0,
          prog1?.semiCorrect,
          prog1?.tiebreakerRounds,
          prog2?.q ?? 0,
          prog2?.semiCorrect,
          prog2?.tiebreakerRounds,
          t.status === TournamentStatus.FINISHED,
        );
        if (semiState.result === 'won') return prog1!;
        if (semiState.result === 'lost') return prog2!;
        return null;
      }

      const soloId = p1Valid ? p1Id : p2Id;
      const soloProg = progressByTidAndUser.get(t.id)?.get(soloId);
      if (!soloProg || (soloProg.q ?? 0) < QUESTIONS_PER_ROUND) return null;
      return soloProg;
    };

    const didOppositeSemiBothLoseByTimeout = (t: Tournament): boolean => {
      const order = t.playerOrder;
      if (!order || order.length <= 2) return false;
      const playerSlot = order.indexOf(userId);
      if (playerSlot < 0) return false;
      const otherSlots: [number, number] = playerSlot < 2 ? [2, 3] : [0, 1];
      const p1Id = otherSlots[0] < order.length ? order[otherSlots[0]] : -1;
      const p2Id = otherSlots[1] < order.length ? order[otherSlots[1]] : -1;
      if (!(p1Id > 0) || !(p2Id > 0)) return false;
      const prog1 = progressByTidAndUser.get(t.id)?.get(p1Id);
      const prog2 = progressByTidAndUser.get(t.id)?.get(p2Id);
      return (prog1?.q ?? 0) < QUESTIONS_PER_ROUND && (prog2?.q ?? 0) < QUESTIONS_PER_ROUND;
    };

    const now = new Date();

    const toDate = (value: Date | string | null | undefined): Date | null => {
      if (!value) return null;
      const dt = value instanceof Date ? value : new Date(value);
      return Number.isNaN(dt.getTime()) ? null : dt;
    };

    const maxDate = (...values: (Date | string | null | undefined)[]): Date | null => {
      const dates = values
        .map((value) => toDate(value))
        .filter((value): value is Date => value instanceof Date);
      if (dates.length === 0) return null;
      return new Date(Math.max(...dates.map((value) => value.getTime())));
    };

    const getCompletionDateFromUsers = (
      t: Tournament,
      ids: number[],
    ): Date | null => {
      const dates: Date[] = [];
      for (const uid of ids) {
        if (!(uid > 0)) continue;
        const prog = progressByTidAndUser.get(t.id)?.get(uid);
        if (!prog) continue;
        const la = toDate(prog.leftAt);
        if (la) dates.push(la);
        else {
          const rs = toDate(prog.roundStartedAt);
          if (rs) dates.push(rs);
        }
      }
      if (dates.length === 0) return null;
      const result = new Date(Math.max(...dates.map((d) => d.getTime())));
      return result > now ? now : result;
    };

    const getTournamentCompletionDate = (t: Tournament): Date | null => {
      const order = t.playerOrder ?? [];
      return getCompletionDateFromUsers(
        t,
        order.filter((id): id is number => Number(id) > 0),
      );
    };

    /** Количество вопросов в полуфинальной фазе (10 + тайбрейкеры) */
    const semiPhaseQuestions = (prog: ProgressData): number =>
      QUESTIONS_PER_ROUND + prog.tiebreakerRounds.length * TIEBREAKER_QUESTIONS;

    /** Корректный расчёт верных в финале (без учёта полуфинальных тайбрейкеров) */
    const computeFinalCorrect = (prog: ProgressData): number => {
      const semiTBSum = prog.tiebreakerRounds.reduce((a, b) => a + b, 0);
      return prog.totalCorrect - (prog.semiCorrect ?? 0) - semiTBSum;
    };

    const isVictoryLabel = (label: string): boolean => label.startsWith('Победа');
    const isDefeatLabel = (label: string): boolean => label.startsWith('Поражение') || label === 'Время истекло';
    const formatTimeoutDefeatLabel = (): string => 'Поражение, время истекло';
    const formatScoreLabel = (base: 'Победа' | 'Поражение', score: { my: number; opp: number } | null): string =>
      score ? `${base} ${score.my}-${score.opp}` : base;

    const getSemiScore = (t: Tournament): { my: number; opp: number } | null => {
      const order = t.playerOrder ?? [];
      const playerSlot = order.indexOf(userId);
      if (playerSlot < 0) return null;
      const opponentSlot = playerSlot % 2 === 0 ? playerSlot + 1 : playerSlot - 1;
      const opponentId = opponentSlot >= 0 && opponentSlot < order.length ? (order[opponentSlot] ?? -1) : -1;
      if (!(opponentId > 0)) return null;
      const myProg = progressByTid.get(t.id);
      const oppProg = progressByTidAndUser.get(t.id)?.get(opponentId);
      if (!myProg || !oppProg) return null;
      const resolved = this.resolveStageTotals(
        myProg.q ?? 0,
        myProg.semiCorrect ?? 0,
        myProg.tiebreakerRounds,
        oppProg.q ?? 0,
        oppProg.semiCorrect ?? 0,
        oppProg.tiebreakerRounds,
        t.status === TournamentStatus.FINISHED,
      );
      return { my: resolved.myTotal, opp: resolved.oppTotal };
    };

    const getFinalScore = (t: Tournament, myProg?: ProgressData | null): { my: number; opp: number } | null => {
      const me = myProg ?? progressByTid.get(t.id);
      const otherFin = getOtherFinalist(t);
      if (!me || !otherFin) return null;
      const myFinalTotal = computeFinalCorrect(me);
      const oppFinalTotal = computeFinalCorrect(otherFin);
      const myFinalBase = myFinalTotal - me.finalTiebreakerRounds.reduce((a, b) => a + b, 0);
      const oppFinalBase = oppFinalTotal - otherFin.finalTiebreakerRounds.reduce((a, b) => a + b, 0);
      const resolved = this.resolveStageTotals(
        Math.max(0, me.q - semiPhaseQuestions(me)),
        myFinalBase,
        me.finalTiebreakerRounds,
        Math.max(0, otherFin.q - semiPhaseQuestions(otherFin)),
        oppFinalBase,
        otherFin.finalTiebreakerRounds,
        t.status === TournamentStatus.FINISHED,
      );
      return { my: resolved.myTotal, opp: resolved.oppTotal };
    };

    /** Результат финала: won/lost/tie/incomplete */
    const getFinalResult = (
      t: Tournament,
      myProg: ProgressData,
    ): 'won' | 'lost' | 'tie' | 'incomplete' => {
      const otherFin = getOtherFinalist(t);
      if (!otherFin) {
        if (didOppositeSemiBothLoseByTimeout(t)) {
          const mySemiTotal = semiPhaseQuestions(myProg);
          const myFinalAnswered = Math.max(0, myProg.q - mySemiTotal);
          const myFinalCorrect = computeFinalCorrect(myProg);
          if (myFinalAnswered >= QUESTIONS_PER_ROUND) return myFinalCorrect > 0 ? 'won' : 'lost';
          if (isTimeExpired(t)) return myFinalCorrect > 0 ? 'won' : 'lost';
        }
        return 'incomplete';
      }
      const mySemiTotal = semiPhaseQuestions(myProg);
      const oppSemiTotal = QUESTIONS_PER_ROUND + otherFin.tiebreakerRounds.length * TIEBREAKER_QUESTIONS;
      const myFinalAnswered = Math.max(0, myProg.q - mySemiTotal);
      const oppFinalAnswered = Math.max(0, otherFin.q - oppSemiTotal);
      const myFinalTotal = computeFinalCorrect(myProg);
      const oppFinalTotal = computeFinalCorrect(otherFin);
      const myFinalBase = myFinalTotal - myProg.finalTiebreakerRounds.reduce((a, b) => a + b, 0);
      const oppFinalBase = oppFinalTotal - otherFin.finalTiebreakerRounds.reduce((a, b) => a + b, 0);
      if (t.status === TournamentStatus.FINISHED) {
        const myFinishedBaseFinal = myFinalAnswered >= QUESTIONS_PER_ROUND;
        const oppFinishedBaseFinal = oppFinalAnswered >= QUESTIONS_PER_ROUND;
        if (myFinishedBaseFinal && !oppFinishedBaseFinal) {
          return myFinalTotal > 0 ? 'won' : 'tie';
        }
        if (!myFinishedBaseFinal && oppFinishedBaseFinal) {
          return oppFinalTotal > 0 ? 'lost' : 'tie';
        }
      }
      return this.compareStageTotals(
        myFinalAnswered,
        myFinalBase,
        myProg.finalTiebreakerRounds,
        oppFinalAnswered,
        oppFinalBase,
        otherFin.finalTiebreakerRounds,
        t.status === TournamentStatus.FINISHED,
      ).result;
    };

    const isWaitingForFinalOpponent = (
      t: Tournament,
      myProg?: ProgressData | null,
    ): boolean => {
      if (!myProg) return false;
      if (getMoneySemiResult(t).result !== 'won') return false;
      const mySemiTotal = semiPhaseQuestions(myProg);
      if ((myProg.q ?? 0) < mySemiTotal + QUESTIONS_PER_ROUND) return false;
      if (getFinalResult(t, myProg) !== 'incomplete') return false;
      return !getOtherFinalist(t) && !didOppositeSemiBothLoseByTimeout(t);
    };

    for (const t of tournaments) {
      const userProgress = progressByTid.get(t.id);
      const answered = userProgress?.q ?? 0;
      let passed: boolean;
      let userCompleted = t.status === TournamentStatus.FINISHED;
      const order = t.playerOrder ?? [];
      const playerSlot = order.indexOf(userId);
      const opponentSlot = playerSlot >= 0 ? (playerSlot % 2 === 0 ? playerSlot + 1 : playerSlot - 1) : -1;
      const opponentId = opponentSlot >= 0 && opponentSlot < order.length ? (order[opponentSlot] ?? -1) : -1;
      const rawDeadline = deadlineByTournamentId[t.id];
      const deadlineAt = rawDeadline ? (toDate(rawDeadline) ?? now) : new Date('2099-01-01');
      let row = await this.tournamentResultRepository.findOne({ where: { userId, tournamentId: t.id } });
      let completionDate = maxDate(row?.completedAt ?? null);

      const semiResult = getMoneySemiResult(t);

      if (semiResult.result === 'lost') {
        lostSemiByTid.set(t.id, true);
        passed = false;
        userCompleted = true;
        completionDate = completionDate ?? getCompletionDateFromUsers(t, [userId, opponentId]);
      } else if (semiResult.result === 'tie') {
        passed = false;
        if (deadlineAt < now) {
          userCompleted = true;
          completionDate = completionDate ?? getCompletionDateFromUsers(t, [userId, opponentId]);
        }
      } else if (semiResult.result === 'won' && userProgress) {
        const mySemiTotal = semiPhaseQuestions(userProgress);
        const semiWinCompletionDate = getCompletionDateFromUsers(t, [userId, opponentId]);
        if (answered >= mySemiTotal + QUESTIONS_PER_ROUND) {
          const fr = getFinalResult(t, userProgress);
          if (fr === 'won') {
            passed = true;
            userCompleted = true;
            const otherFinalist = getOtherFinalist(t);
            completionDate = completionDate ?? getCompletionDateFromUsers(t, [userId, otherFinalist?.userId ?? -1]);
          } else if (fr === 'lost') {
            passed = false;
            userCompleted = true;
            const otherFinalist = getOtherFinalist(t);
            completionDate = completionDate ?? getCompletionDateFromUsers(t, [userId, otherFinalist?.userId ?? -1]);
          } else {
            passed = false;
            userCompleted = true;
            completionDate = completionDate ?? semiWinCompletionDate;
          }
        } else {
          passed = false;
          userCompleted = true;
          completionDate = completionDate ?? semiWinCompletionDate;
        }
      } else if (semiResult.result === 'incomplete' && semiResult.noOpponent) {
        passed = false;
        userCompleted = false;
      } else {
        if (deadlineAt < now && answered >= QUESTIONS_PER_ROUND) {
          passed = true;
          userCompleted = true;
          completionDate = completionDate ?? getCompletionDateFromUsers(t, [userId, opponentId]);
        } else {
          passed = row?.passed === 1 ? true : false;
          if (deadlineAt < now) {
            userCompleted = true;
            completionDate = completionDate ?? getCompletionDateFromUsers(t, [userId, opponentId]);
          }
        }
      }

      if (row) {
        row.passed = passed ? 1 : 0;
        if (userCompleted) row.completedAt = completionDate ?? row.completedAt ?? now;
        if (!userCompleted && row.completedAt) row.completedAt = null as any;
        await this.tournamentResultRepository.save(row);
      } else {
        row = this.tournamentResultRepository.create({
          userId, tournamentId: t.id, passed: passed ? 1 : 0,
          ...(userCompleted ? { completedAt: completionDate ?? now } : {}),
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

    /** В истории этап только «Полуфинал» или «Финал», без «Доп. раунд». */
    const getStage = (t: Tournament): string => {
      const semiResult = getMoneySemiResult(t);
      if (semiResult.result === 'tie') return 'Полуфинал';
      if (semiResult.result === 'won') {
        const prog = progressByTid.get(t.id);
        if (prog) {
          const mySemiTotal = semiPhaseQuestions(prog);
          const answered = prog.q ?? 0;
          if (answered >= mySemiTotal + QUESTIONS_PER_ROUND) {
            const fr = getFinalResult(t, prog);
            if (fr === 'tie') return 'Финал';
          }
        }
        return 'Финал';
      }
      return 'Полуфинал';
    };

    const toItem = (
      t: Tournament,
      deadline: string | null,
      userStatus: 'passed' | 'not_passed',
      resultLabel: string,
      roundForQuestions?: 'semi' | 'final',
      stageOverride?: string,
      forCompletedList?: boolean,
    ) => {
      const prog = progressByTid.get(t.id);
      const answered = prog?.q ?? 0;
      const semiCorrect = prog?.semiCorrect ?? (answered <= QUESTIONS_PER_ROUND ? (prog?.totalCorrect ?? 0) : 0);
      const tbRounds = prog?.tiebreakerRounds ?? [];
      const stage = stageOverride ?? getStage(t);
      const semiRes = getMoneySemiResult(t);
      const inSemiPhase = semiRes.result !== 'won';
      const round: 'semi' | 'final' =
        roundForQuestions ?? (inSemiPhase ? 'semi' : 'final');
      const order = t.playerOrder ?? [];
      const playerSlot = order.indexOf(userId);
      const opponentSlot = playerSlot >= 0 ? (playerSlot % 2 === 0 ? playerSlot + 1 : playerSlot - 1) : -1;
      const opponentId = opponentSlot >= 0 && opponentSlot < order.length ? (order[opponentSlot] ?? -1) : -1;
      const opponentProg = opponentId > 0 ? progressByTidAndUser.get(t.id)?.get(opponentId) : null;

      let questionsAnsweredInRound: number;
      let questionsTotal: number;
      let correctAnswersInRound: number;

      const semiResultForDisplay = getMoneySemiResult(t);
      const isSemiTiebreaker = semiResultForDisplay.result === 'tie';

      if (round === 'semi') {
        if (prog && opponentProg) {
          const semiResolved = this.resolveStageTotals(
            prog.q ?? 0,
            prog.semiCorrect ?? 0,
            prog.tiebreakerRounds,
            opponentProg.q ?? 0,
            opponentProg.semiCorrect ?? 0,
            opponentProg.tiebreakerRounds,
            t.status === TournamentStatus.FINISHED,
          );
          questionsTotal = QUESTIONS_PER_ROUND + semiResolved.roundsUsed * TIEBREAKER_QUESTIONS;
          questionsAnsweredInRound = Math.min(answered, questionsTotal);
          correctAnswersInRound = semiResolved.myTotal;
        } else {
          const completedTBRounds = tbRounds.length;
          const tbCorrectSum = tbRounds.reduce((a, b) => a + b, 0);
          questionsTotal = QUESTIONS_PER_ROUND + completedTBRounds * TIEBREAKER_QUESTIONS;
          questionsAnsweredInRound = Math.min(answered, questionsTotal);
          correctAnswersInRound = semiCorrect + tbCorrectSum;
        }
      } else {
        const semiTBCount = tbRounds.length;
        const semiTotal = QUESTIONS_PER_ROUND + semiTBCount * TIEBREAKER_QUESTIONS;
        const finalAnswered = Math.max(0, answered - semiTotal);
        const otherFinalist = getOtherFinalist(t);
        if (prog && otherFinalist) {
          const myFinalTotal = computeFinalCorrect(prog);
          const oppFinalTotal = computeFinalCorrect(otherFinalist);
          const myFinalBase = myFinalTotal - prog.finalTiebreakerRounds.reduce((a, b) => a + b, 0);
          const oppFinalBase = oppFinalTotal - otherFinalist.finalTiebreakerRounds.reduce((a, b) => a + b, 0);
          const finalResolved = this.resolveStageTotals(
            finalAnswered,
            myFinalBase,
            prog.finalTiebreakerRounds,
            Math.max(0, (otherFinalist.q ?? 0) - semiPhaseQuestions(otherFinalist)),
            oppFinalBase,
            otherFinalist.finalTiebreakerRounds,
            t.status === TournamentStatus.FINISHED,
          );
          questionsTotal = QUESTIONS_PER_ROUND + finalResolved.roundsUsed * TIEBREAKER_QUESTIONS;
          questionsAnsweredInRound = Math.min(finalAnswered, questionsTotal);
          correctAnswersInRound = finalResolved.myTotal;
        } else {
          const finalTBRounds = prog?.finalTiebreakerRounds ?? [];
          questionsTotal = QUESTIONS_PER_ROUND + finalTBRounds.length * TIEBREAKER_QUESTIONS;
          questionsAnsweredInRound = Math.min(finalAnswered, questionsTotal);
          correctAnswersInRound = prog ? computeFinalCorrect(prog) : 0;
        }
      }
      let completedAtVal: string | null = completedAtByTid.get(t.id) ?? (t.createdAt ? (t.createdAt instanceof Date ? t.createdAt.toISOString() : String(t.createdAt)) : null);
      const roundStartedAtDisplay: string | null = roundStartedAtByTid.get(t.id) ?? null;
      // Если старт раунда позже даты завершения — берём реальную дату завершения по паре (leftAt/roundStartedAt); при отсутствии данных завершаем по старту раунда.
      if (completedAtVal && roundStartedAtDisplay) {
        const rs = new Date(roundStartedAtDisplay).getTime();
        const ca = new Date(completedAtVal).getTime();
        if (rs > ca) {
          const order = t.playerOrder ?? [];
          const playerSlot = order.indexOf(userId);
          const opponentSlot = playerSlot % 2 === 0 ? playerSlot + 1 : playerSlot - 1;
          const opponentId = opponentSlot >= 0 && opponentSlot < order.length ? (order[opponentSlot] ?? -1) : -1;
          const ids = opponentId > 0 ? [userId, opponentId] : [userId];
          const realCompletion = getCompletionDateFromUsers(t, ids);
          const useCompletion = realCompletion
            ? new Date(Math.max(realCompletion.getTime(), rs))
            : new Date(rs);
          completedAtVal = (useCompletion > now ? now : useCompletion).toISOString();
        }
      }
      const displayStatus = forCompletedList
        ? TournamentStatus.FINISHED
        : resultLabel === 'Ожидание соперника'
          ? TournamentStatus.WAITING
          : TournamentStatus.ACTIVE;
      return {
        id: t.id,
        status: displayStatus,
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
        completedAt: completedAtVal,
        roundFinished: playerRoundFinished.get(t.id) ?? false,
        roundStartedAt: roundStartedAtDisplay,
        tournament: {
          id: t.id,
          name: getTournamentDisplayName(t),
          type: t.gameType ?? null,
          status: displayStatus,
          leagueAmount: t.leagueAmount ?? null,
        },
      };
    };

    const getResultLabel = (t: Tournament): string => {
      const prog = progressByTid.get(t.id);
      const answered = prog?.q ?? 0;
      if (t.status === TournamentStatus.FINISHED) {
        if (answered < QUESTIONS_PER_ROUND) return formatTimeoutDefeatLabel();
        if (resultByTournamentId.get(t.id) === true) {
          const progWin = progressByTid.get(t.id);
          return formatScoreLabel('Победа', progWin ? getFinalScore(t, progWin) : null);
        }
        const semiResFin = getMoneySemiResult(t);
        if (semiResFin.result === 'won') {
          const progFin = progressByTid.get(t.id);
          if (progFin) {
            if (isWaitingForFinalOpponent(t, progFin)) return 'Ожидание соперника';
            const finalResult = getFinalResult(t, progFin);
            if (finalResult === 'won') return formatScoreLabel('Победа', getFinalScore(t, progFin));
            if (finalResult === 'lost') return formatScoreLabel('Поражение', getFinalScore(t, progFin));
            if (finalResult === 'tie') return formatTimeoutDefeatLabel();
            if ((progFin.q ?? 0) < semiPhaseQuestions(progFin) + QUESTIONS_PER_ROUND) return 'Этап не пройден';
          }
        }
        return formatScoreLabel('Поражение', getSemiScore(t));
      }

      if (answered < QUESTIONS_PER_ROUND) return 'Этап не пройден';

      const semiResult = getMoneySemiResult(t);
      if (semiResult.result === 'incomplete') return 'Ожидание соперника';
      if (semiResult.result === 'tie') {
        const tbRound = semiResult.tiebreakerRound ?? 1;
        const roundEnd = QUESTIONS_PER_ROUND + tbRound * TIEBREAKER_QUESTIONS;
        if (answered >= roundEnd) return 'Ожидание соперника';
        return 'Этап не пройден';
      }
      if (semiResult.result === 'lost') return formatScoreLabel('Поражение', getSemiScore(t));
      if (semiResult.result === 'won') {
        if (!prog) return 'Этап не пройден';
        if (isWaitingForFinalOpponent(t, prog)) return 'Ожидание соперника';
        const mySemiTotal = semiPhaseQuestions(prog);
        const fr = getFinalResult(t, prog);
        if (fr === 'won') return formatScoreLabel('Победа', getFinalScore(t, prog));
        if (fr === 'lost') return formatScoreLabel('Поражение', getFinalScore(t, prog));
        if (fr === 'tie') return 'Этап не пройден';
        if (answered < mySemiTotal + QUESTIONS_PER_ROUND) return 'Этап не пройден';
        return 'Ожидание соперника';
      }
      return 'Ожидание соперника';
    };

    const getUserStatus = (t: Tournament): 'passed' | 'not_passed' => {
      const prog = progressByTid.get(t.id);
      if (!prog) return 'not_passed';

      const semiResult = getMoneySemiResult(t);
      if (semiResult.result !== 'won') return 'not_passed';

      const otherFinalist = getOtherFinalist(t);
      if (!otherFinalist && t.status === TournamentStatus.FINISHED && resultByTournamentId.get(t.id) === true) {
        return 'passed';
      }

      const mySemiTotal = semiPhaseQuestions(prog);
      if ((prog.q ?? 0) < mySemiTotal + QUESTIONS_PER_ROUND) return 'not_passed';

      return getFinalResult(t, prog) === 'won' ? 'passed' : 'not_passed';
    };

    function isTimeExpired(t: Tournament): boolean {
      const deadline = deadlineByTournamentId[t.id];
      if (!deadline) return false;
      return new Date(deadline) < now;
    }

    const belongsToHistory = (t: Tournament): boolean => {
      if (t.status === TournamentStatus.FINISHED) {
        const label = getResultLabel(t);
        if (label === 'Ожидание соперника') return false;
        const semiRes = getMoneySemiResult(t);
        if (semiRes.result === 'won') {
          const prog = progressByTid.get(t.id);
          if (prog) {
            const finalResult = getFinalResult(t, prog);
            if (finalResult === 'won' || finalResult === 'lost') return true;
            const mySemiTotal = semiPhaseQuestions(prog);
            if ((prog.q ?? 0) < mySemiTotal + QUESTIONS_PER_ROUND) return false;
          }
        }
        return true;
      }
      const label = getResultLabel(t);
      if (label === 'Время истекло' || isDefeatLabel(label) || isVictoryLabel(label)) return true;
      if (label === 'Ожидание соперника') return isTimeExpired(t);
      if (playerRoundFinished.get(t.id) && !isTimeExpired(t)) return false;
      if (currentTournamentId === t.id && !isTimeExpired(t)) return false;
      return isTimeExpired(t);
    };

    const getDisplayResultLabel = (t: Tournament, inCompleted: boolean): string => {
      const label = getResultLabel(t);
      if (t.status === TournamentStatus.FINISHED) {
        return label;
      }
      if (inCompleted && isTimeExpired(t) && !isDefeatLabel(label) && !isVictoryLabel(label)) {
        const prog2 = progressByTid.get(t.id);
        const answered2 = prog2?.q ?? 0;
        if (answered2 >= QUESTIONS_PER_ROUND) {
          const semiRes2 = getMoneySemiResult(t);
          if (semiRes2.result === 'won') return formatScoreLabel('Победа', getSemiScore(t));
          if (semiRes2.result === 'incomplete') return semiRes2.noOpponent ? 'Ожидание соперника' : formatScoreLabel('Победа', getSemiScore(t));
          if (semiRes2.result === 'tie') {
            const tbRound2 = semiRes2.tiebreakerRound ?? 1;
            const roundEnd2 = QUESTIONS_PER_ROUND + tbRound2 * TIEBREAKER_QUESTIONS;
            if (answered2 >= roundEnd2) return formatScoreLabel('Победа', getSemiScore(t));
            const ord2 = t.playerOrder ?? [];
            const sl2 = ord2.indexOf(userId);
            const os2 = sl2 >= 0 ? (sl2 % 2 === 0 ? sl2 + 1 : sl2 - 1) : -1;
            const oid2 = os2 >= 0 && os2 < ord2.length ? ord2[os2] : -1;
            if (oid2 > 0) {
              const opPr2 = progressByTidAndUser.get(t.id)?.get(oid2);
              if ((opPr2?.q ?? 0) >= roundEnd2) return formatScoreLabel('Поражение', getSemiScore(t));
            }
          }
        }
        return formatTimeoutDefeatLabel();
      }
      return label;
    };

    const activeTournamentsRaw = tournaments.filter((t) => !belongsToHistory(t));
    const completedTournamentsRaw = tournaments.filter((t) => belongsToHistory(t));

    // Если выиграл полуфинал — турнир и в активных (есть финал), и в истории как пройденный этап ПФ,
    // но сам турнир ещё не считается пройденным до победы в финале.
    const moneySemiWonFinalPending = tournaments.filter(
      (t) =>
        getMoneySemiResult(t).result === 'won' &&
        !belongsToHistory(t),
    );
    const semiWonCompletedItems = moneySemiWonFinalPending.map((t) =>
      toItem(t, deadlineByTournamentId[t.id] ?? null, 'not_passed', formatScoreLabel('Победа', getSemiScore(t)), 'semi', 'Полуфинал', true),
    );

    const activeRaw = activeTournamentsRaw.map((t) =>
      toItem(t, deadlineByTournamentId[t.id] ?? null, getUserStatus(t), getDisplayResultLabel(t, false)),
    );
    const active = activeRaw.slice().sort((a, b) => {
      const tA = new Date(a.createdAt).getTime();
      const tB = new Date(b.createdAt).getTime();
      if (tA !== tB) return tB - tA;
      return b.id - a.id;
    });

    const completedRaw = [
      ...completedTournamentsRaw.map((t) =>
        toItem(t, deadlineByTournamentId[t.id] ?? null, getUserStatus(t), getDisplayResultLabel(t, true), undefined, undefined, true),
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

  /** Восстановить связи участников турниров из entry, progress и playerOrder. */
  async backfillTournamentPlayersFromEntry(): Promise<{ inserted: number }> {
    const dataSource = this.tournamentRepository.manager.connection;
    let totalInserted = 0;
    try {
      const qEntry = `
        INSERT INTO tournament_players_user ("tournamentId", "userId")
        SELECT te."tournamentId", te."userId"
        FROM tournament_entry te
        WHERE NOT EXISTS (
          SELECT 1 FROM tournament_players_user tpu
          WHERE tpu."tournamentId" = te."tournamentId" AND tpu."userId" = te."userId"
        )
      `;
      const rEntry = await dataSource.query(qEntry);
      const nEntry = typeof rEntry?.rowCount === 'number' ? rEntry.rowCount : (Array.isArray(rEntry) ? rEntry.length : 0);
      totalInserted += Number(nEntry) || 0;
    } catch (e) {
      this.logger.warn('[backfillTournamentPlayersFromEntry] entry', (e as Error)?.message);
      try {
        const qEntrySnake = `
          INSERT INTO tournament_players_user (tournament_id, user_id)
          SELECT te.tournament_id, te.user_id FROM tournament_entry te
          WHERE NOT EXISTS (
            SELECT 1 FROM tournament_players_user tpu
            WHERE tpu.tournament_id = te.tournament_id AND tpu.user_id = te.user_id
          )
        `;
        const r = await dataSource.query(qEntrySnake);
        totalInserted += Number(typeof r?.rowCount === 'number' ? r.rowCount : (Array.isArray(r) ? r.length : 0)) || 0;
      } catch (_) {}
    }
    try {
      const qProgress = `
        INSERT INTO tournament_players_user ("tournamentId", "userId")
        SELECT p."tournamentId", p."userId"
        FROM tournament_progress p
        WHERE NOT EXISTS (
          SELECT 1 FROM tournament_players_user tpu
          WHERE tpu."tournamentId" = p."tournamentId" AND tpu."userId" = p."userId"
        )
      `;
      const rProgress = await dataSource.query(qProgress);
      const nProgress = typeof rProgress?.rowCount === 'number' ? rProgress.rowCount : (Array.isArray(rProgress) ? rProgress.length : 0);
      totalInserted += Number(nProgress) || 0;
    } catch (e) {
      this.logger.warn('[backfillTournamentPlayersFromEntry] progress', (e as Error)?.message);
      try {
        const qProgressSnake = `
          INSERT INTO tournament_players_user (tournament_id, user_id)
          SELECT p.tournament_id, p.user_id FROM tournament_progress p
          WHERE NOT EXISTS (
            SELECT 1 FROM tournament_players_user tpu
            WHERE tpu.tournament_id = p.tournament_id AND tpu.user_id = p.user_id
          )
        `;
        const r = await dataSource.query(qProgressSnake);
        totalInserted += Number(typeof r?.rowCount === 'number' ? r.rowCount : (Array.isArray(r) ? r.length : 0)) || 0;
      } catch (_) {}
    }
    try {
      const qOrderPlayers = `
        INSERT INTO tournament_players_user ("tournamentId", "userId")
        SELECT t.id, (ord.value)::int
        FROM tournament t
        CROSS JOIN LATERAL json_array_elements_text(
          CASE
            WHEN t."playerOrder" IS NULL OR t."playerOrder" IN ('', 'null') THEN '[]'::json
            ELSE t."playerOrder"::json
          END
        ) AS ord(value)
        WHERE (ord.value)::int > 0
          AND NOT EXISTS (
            SELECT 1 FROM tournament_players_user tpu
            WHERE tpu."tournamentId" = t.id AND tpu."userId" = (ord.value)::int
          )
      `;
      const rOrderPlayers = await dataSource.query(qOrderPlayers);
      totalInserted += Number(typeof rOrderPlayers?.rowCount === 'number' ? rOrderPlayers.rowCount : (Array.isArray(rOrderPlayers) ? rOrderPlayers.length : 0)) || 0;
    } catch (e) {
      this.logger.warn('[backfillTournamentPlayersFromEntry] playerOrder->players', (e as Error)?.message);
      try {
        const qOrderPlayersSnake = `
          INSERT INTO tournament_players_user (tournament_id, user_id)
          SELECT t.id, (ord.value)::int
          FROM tournament t
          CROSS JOIN LATERAL json_array_elements_text(
            CASE
              WHEN t.player_order IS NULL OR t.player_order IN ('', 'null') THEN '[]'::json
              ELSE t.player_order::json
            END
          ) AS ord(value)
          WHERE (ord.value)::int > 0
            AND NOT EXISTS (
              SELECT 1 FROM tournament_players_user tpu
              WHERE tpu.tournament_id = t.id AND tpu.user_id = (ord.value)::int
            )
        `;
        const r = await dataSource.query(qOrderPlayersSnake);
        totalInserted += Number(typeof r?.rowCount === 'number' ? r.rowCount : (Array.isArray(r) ? r.length : 0)) || 0;
      } catch (_) {}
    }
    try {
      const qOrderEntries = `
        INSERT INTO tournament_entry ("tournamentId", "userId", "joinedAt")
        SELECT t.id, (ord.value)::int, COALESCE(t."createdAt", NOW())
        FROM tournament t
        CROSS JOIN LATERAL json_array_elements_text(
          CASE
            WHEN t."playerOrder" IS NULL OR t."playerOrder" IN ('', 'null') THEN '[]'::json
            ELSE t."playerOrder"::json
          END
        ) AS ord(value)
        WHERE (ord.value)::int > 0
          AND NOT EXISTS (
            SELECT 1 FROM tournament_entry te
            WHERE te."tournamentId" = t.id AND te."userId" = (ord.value)::int
          )
      `;
      const rOrderEntries = await dataSource.query(qOrderEntries);
      totalInserted += Number(typeof rOrderEntries?.rowCount === 'number' ? rOrderEntries.rowCount : (Array.isArray(rOrderEntries) ? rOrderEntries.length : 0)) || 0;
    } catch (e) {
      this.logger.warn('[backfillTournamentPlayersFromEntry] playerOrder->entry', (e as Error)?.message);
      try {
        const qOrderEntriesSnake = `
          INSERT INTO tournament_entry (tournament_id, user_id, joined_at)
          SELECT t.id, (ord.value)::int, COALESCE(t.created_at, NOW())
          FROM tournament t
          CROSS JOIN LATERAL json_array_elements_text(
            CASE
              WHEN t.player_order IS NULL OR t.player_order IN ('', 'null') THEN '[]'::json
              ELSE t.player_order::json
            END
          ) AS ord(value)
          WHERE (ord.value)::int > 0
            AND NOT EXISTS (
              SELECT 1 FROM tournament_entry te
              WHERE te.tournament_id = t.id AND te.user_id = (ord.value)::int
            )
        `;
        const r = await dataSource.query(qOrderEntriesSnake);
        totalInserted += Number(typeof r?.rowCount === 'number' ? r.rowCount : (Array.isArray(r) ? r.length : 0)) || 0;
      } catch (_) {}
    }
    if (totalInserted > 0) this.logger.log(`[backfillTournamentPlayersFromEntry] inserted ${totalInserted} rows`);
    return { inserted: totalInserted };
  }

  /** Добавить пару (tournamentId, userId) в join-таблицу без перезаписи связи. Использовать вместо players.push + save(tournament). */
  private async ensureTournamentPlayer(tournamentId: number, userId: number): Promise<void> {
    const dataSource = this.tournamentRepository.manager.connection;
    try {
      await dataSource.query(
        `INSERT INTO tournament_players_user ("tournamentId", "userId")
         SELECT $1, $2 WHERE NOT EXISTS (
           SELECT 1 FROM tournament_players_user WHERE "tournamentId" = $1 AND "userId" = $2
         )`,
        [tournamentId, userId],
      );
    } catch (e) {
      this.logger.warn('[ensureTournamentPlayer]', (e as Error)?.message);
    }
  }

  /** Для админки: все участия в турнирах по всем игрокам — все поля как у игрока + userId, userNickname, phase, tournament. */
  async getAllParticipationsForAdmin(): Promise<
    {
      tournamentId: number; status: string; createdAt: string; playersCount: number; leagueAmount: number | null;
      deadline: string | null; userStatus: string; stage?: string; resultLabel?: string; roundForQuestions: string;
      questionsAnswered: number; questionsTotal: number; correctAnswersInRound: number;
      completedAt?: string | null; roundFinished?: boolean; roundStartedAt?: string | null;
      userId: number; userNickname: string; phase: 'active' | 'history';
      gameType?: 'training' | 'money' | null;
      tournament: { id: number; name: string; type: string | null; status: string };
    }[]
  > {
    await this.backfillTournamentPlayersFromEntry();
    const progressList = await this.tournamentProgressRepository.find({
      select: ['userId', 'tournamentId'],
    });
    const userIds = [...new Set(progressList.map((p) => p.userId))].filter((id) => id > 0);
    if (userIds.length === 0) return [];

    const users = await this.userRepository.find({
      where: { id: In(userIds) },
      select: ['id', 'username'],
    });
    const nicknameByUserId = new Map(users.map((u) => [u.id, u.username ?? `Игрок ${u.id}`]));

    const result: {
      tournamentId: number; status: string; createdAt: string; playersCount: number; leagueAmount: number | null;
      deadline: string | null; userStatus: string; stage?: string; resultLabel?: string; roundForQuestions: string;
      questionsAnswered: number; questionsTotal: number; correctAnswersInRound: number;
      completedAt?: string | null; roundFinished?: boolean; roundStartedAt?: string | null;
      userId: number; userNickname: string; phase: 'active' | 'history';
      gameType?: 'training' | 'money' | null;
      tournament: { id: number; name: string; type: string | null; status: string };
    }[] = [];
    for (const userId of userIds) {
      try {
        const { active: activeT, completed: completedT } = await this.getMyTournaments(userId, 'training');
        const { active: activeM, completed: completedM } = await this.getMyTournaments(userId, 'money');
        const active = [...activeT, ...activeM];
        const completed = [...completedT, ...completedM];
        const seenIds = new Set<number>();
        const nickname = nicknameByUserId.get(userId) ?? `Игрок ${userId}`;
        for (const item of active) {
          if (seenIds.has(item.id)) continue;
          seenIds.add(item.id);
          result.push({
            tournamentId: item.id,
            status: item.status ?? '',
            createdAt: item.createdAt ?? '',
            playersCount: item.playersCount ?? 0,
            leagueAmount: item.leagueAmount ?? null,
            deadline: item.deadline ?? null,
            userStatus: item.userStatus ?? 'not_passed',
            stage: item.stage,
            resultLabel: item.resultLabel,
            roundForQuestions: item.roundForQuestions ?? 'semi',
            questionsAnswered: item.questionsAnswered ?? 0,
            questionsTotal: item.questionsTotal ?? 0,
            correctAnswersInRound: item.correctAnswersInRound ?? 0,
            roundFinished: item.roundFinished,
            roundStartedAt: item.roundStartedAt ?? null,
            userId,
            userNickname: nickname,
            phase: 'active',
            gameType: (item.tournament?.type as 'training' | 'money' | null | undefined) ?? null,
            tournament: item.tournament,
          });
        }
        for (const item of completed) {
          if (seenIds.has(item.id)) continue;
          seenIds.add(item.id);
          result.push({
            tournamentId: item.id,
            status: item.status ?? '',
            createdAt: item.createdAt ?? '',
            playersCount: item.playersCount ?? 0,
            leagueAmount: item.leagueAmount ?? null,
            deadline: null,
            userStatus: item.userStatus ?? 'not_passed',
            stage: item.stage,
            resultLabel: item.resultLabel,
            roundForQuestions: item.roundForQuestions ?? 'semi',
            questionsAnswered: item.questionsAnswered ?? 0,
            questionsTotal: item.questionsTotal ?? 0,
            correctAnswersInRound: item.correctAnswersInRound ?? 0,
            tournament: item.tournament,
            completedAt: item.completedAt ?? null,
            roundStartedAt: item.roundStartedAt ?? null,
            userId,
            userNickname: nickname,
            phase: 'history',
            gameType: (item.tournament?.type as 'training' | 'money' | null | undefined) ?? null,
          });
        }
      } catch (e) {
        // Один пользователь не должен ломать весь список
        console.warn('[getAllParticipationsForAdmin] skip user', userId, e);
      }
    }
    result.sort((a, b) => {
      if (a.tournamentId !== b.tournamentId) return a.tournamentId - b.tournamentId;
      return a.userId - b.userId;
    });
    return result;
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
    deadline: string | null;
    tiebreakerRound?: number;
    tiebreakerQuestions?: { id: number; question: string; options: string[]; correctAnswer: number }[];
  }> {
    const tournament = await this.tournamentRepository.findOne({
      where: { id: tournamentId },
      relations: ['players'],
    });
    if (!tournament) throw new NotFoundException('Tournament not found');
    this.sortPlayersByOrder(tournament);
    const order = tournament.playerOrder ?? [];
    if (tournament.status !== TournamentStatus.WAITING && tournament.status !== TournamentStatus.ACTIVE) {
      if (tournament.status === TournamentStatus.FINISHED) {
        const progressState = await this.tournamentProgressRepository.findOne({ where: { userId, tournamentId } });
        const wonSemi = progressState && await this.didUserWinSemiFinal(tournament, userId);
        const mySemiTotalState = progressState
          ? 10 + (progressState.tiebreakerRoundsCorrect?.length ?? 0) * 10
          : 10;
        if (wonSemi && (progressState?.questionsAnsweredCount ?? 0) < mySemiTotalState + 10) {
          // Доступ к финалу сохранён — не бросаем.
        } else {
          throw new BadRequestException('Tournament is not active');
        }
      } else {
        throw new BadRequestException('Tournament is not active');
      }
    }
    const playerSlot = order.indexOf(userId);
    if (playerSlot < 0) throw new BadRequestException('You are not in this tournament');

    const semiIndex = playerSlot < 2 ? 0 : 1;
    const positionInSemi = playerSlot % 2;
    const isCreator = playerSlot === 0;

    const progress = await this.tournamentProgressRepository.findOne({ where: { userId, tournamentId } });
    const opponentSlot = playerSlot % 2 === 0 ? playerSlot + 1 : playerSlot - 1;
    const oppIdState = opponentSlot >= 0 && opponentSlot < order.length ? order[opponentSlot] : -1;
    const opponent = oppIdState > 0 ? (tournament.players?.find((p) => p.id === oppIdState) ?? null) : null;
    let deadline: string | null = null;
    let tiebreakerRound = 0;
    let tiebreakerQuestions: { id: number; question: string; options: string[]; correctAnswer: number }[] = [];

    if (opponent && progress) {
      const allProgress = await this.tournamentProgressRepository.find({ where: { tournamentId } });
      const oppProgress = await this.tournamentProgressRepository.findOne({
        where: { userId: opponent.id, tournamentId },
      });
      const sharedStart = this.getCurrentRoundSharedStart(tournament, userId, progress, allProgress);
      deadline = sharedStart ? this.getRoundDeadline(sharedStart) : null;
      const myQ = progress.questionsAnsweredCount ?? 0;
      const oppQ = oppProgress?.questionsAnsweredCount ?? 0;
      const semiState = this.getSemiHeadToHeadState(
        myQ,
        progress.semiFinalCorrectCount,
        progress.tiebreakerRoundsCorrect,
        oppQ,
        oppProgress?.semiFinalCorrectCount,
        oppProgress?.tiebreakerRoundsCorrect,
      );

      if (semiState.result === 'tie') {
        tiebreakerRound = semiState.tiebreakerRound ?? 1;
        const roundIndex = 2 + tiebreakerRound;
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
            const qText = this.sanitizeUtf8ForDisplay(q.question);
            return { id: q.id, question: qText, options: fixed.options.map((o) => this.sanitizeUtf8ForDisplay(String(o))), correctAnswer: fixed.correctAnswer };
          });
        } else if (existing.length < this.TIEBREAKER_QUESTIONS && (myQ > this.QUESTIONS_PER_ROUND || oppQ > this.QUESTIONS_PER_ROUND)) {
          const excludedQuestionKeys = await this.getTournamentQuestionKeySet(tournamentId);
          const pool = await this.pickRandomQuestions(this.TIEBREAKER_QUESTIONS, excludedQuestionKeys);
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
            const qText = this.sanitizeUtf8ForDisplay(q.question);
            return { id: q.id, question: qText, options: fixed.options.map((o) => this.sanitizeUtf8ForDisplay(String(o))), correctAnswer: fixed.correctAnswer };
          });
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
        } else if ((tournament.playerOrder?.filter((id) => id > 0).length ?? 0) < 4) {
          effectivePassed = true;
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
            const myProgress = await this.tournamentProgressRepository.findOne({ where: { userId, tournamentId } });
            const oppProg1 = opp1 ? await this.tournamentProgressRepository.findOne({ where: { userId: opp1.id, tournamentId } }) : null;
            const oppProg2 = opp2 ? await this.tournamentProgressRepository.findOne({ where: { userId: opp2.id, tournamentId } }) : null;
            if (this.didSemiPairBothLoseByTimeout(oppProg1, oppProg2)) {
              const soloFinal = this.getSoloFinalOutcome(
                myProgress,
                this.isRoundDeadlinePassed(myProgress?.roundStartedAt ?? null),
              );
              effectivePassed = soloFinal.result === 'won';
            } else {
              effectivePassed = false;
            }
          } else {
            const myProgress = await this.tournamentProgressRepository.findOne({ where: { userId, tournamentId } });
            const finalState = this.getFinalHeadToHeadState(myProgress, finalistProgress);
            effectivePassed = finalState.result === 'won';
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
    deadline: string | null;
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
      const questionText = this.sanitizeUtf8ForDisplay(q.question);
      const fixed = this.ensureQuestionOptions(questionText, q.options, q.correctAnswer);
      return {
        id: q.id,
        question: questionText,
        options: fixed.options.map((o) => this.sanitizeUtf8ForDisplay(String(o))),
        correctAnswer: fixed.correctAnswer,
      };
    };
    const questionsSemi1 = questions.filter((q) => q.roundIndex === 0).map(toDto);
    const questionsSemi2 = questions.filter((q) => q.roundIndex === 1).map(toDto);
    let questionsFinal = questions.filter((q) => q.roundIndex === 2).map(toDto);
    let createdFinalQuestions = false;

    // Lazy-создание финальных вопросов: только когда определён победитель полуфинала
    if (questionsFinal.length === 0) {
      const wonSemi = await this.didUserWinSemiFinal(tournament, userId);
      if (wonSemi) {
        const finalPool = await this.pickQuestionsForFinal(tournamentId);
        const created: typeof questionsFinal = [];
        for (const q of finalPool) {
          const row = this.questionRepository.create({ ...q, tournament, roundIndex: 2 });
          await this.questionRepository.save(row);
          created.push(toDto(row));
        }
        questionsFinal = created;
        createdFinalQuestions = true;
      }
    }

    const progress = await this.tournamentProgressRepository.findOne({
      where: { userId, tournamentId },
    });
    let allProgress = await this.tournamentProgressRepository.find({ where: { tournamentId } });
    let sharedStart = this.getCurrentRoundSharedStart(tournament, userId, progress, allProgress);
    // Как только второй финалист зашёл в финал — запускаем таймеры у обоих (кроме того, кто уже ответил на все вопросы финала).
    if (questionsFinal.length > 0 && progress && !sharedStart && this.isPlayerInFinalPhase(progress, allProgress, tournament)) {
      const order = tournament.playerOrder ?? [];
      const playerSlot = order.indexOf(userId);
      const otherSlots: [number, number] = playerSlot < 2 ? [2, 3] : [0, 1];
      const id1 = otherSlots[0] < order.length ? order[otherSlots[0]] : -1;
      const id2 = otherSlots[1] < order.length ? order[otherSlots[1]] : -1;
      const p1 = id1 > 0 ? allProgress.find((p) => p.userId === id1) : null;
      const p2 = id2 > 0 ? allProgress.find((p) => p.userId === id2) : null;
      let otherFinalist: TournamentProgress | null = null;
      if (p1 && p2) {
        const st = this.getSemiHeadToHeadState(
          p1.questionsAnsweredCount ?? 0,
          p1.semiFinalCorrectCount,
          p1.tiebreakerRoundsCorrect,
          p2.questionsAnsweredCount ?? 0,
          p2.semiFinalCorrectCount,
          p2.tiebreakerRoundsCorrect,
        );
        if (st.result === 'won') otherFinalist = p1;
        else if (st.result === 'lost') otherFinalist = p2;
      } else {
        otherFinalist = p1 ?? p2 ?? null;
      }
      if (otherFinalist && this.isPlayerInFinalPhase(otherFinalist, allProgress, tournament)) {
        const nowStart = new Date();
        const mySemiTotalHere = this.QUESTIONS_PER_ROUND + (progress.tiebreakerRoundsCorrect?.length ?? 0) * this.TIEBREAKER_QUESTIONS;
        const otherSemiTotal = this.QUESTIONS_PER_ROUND + (otherFinalist.tiebreakerRoundsCorrect?.length ?? 0) * this.TIEBREAKER_QUESTIONS;
        if ((progress.questionsAnsweredCount ?? 0) < mySemiTotalHere + this.QUESTIONS_PER_ROUND) {
          progress.roundStartedAt = nowStart;
        }
        if ((otherFinalist.questionsAnsweredCount ?? 0) < otherSemiTotal + this.QUESTIONS_PER_ROUND) {
          otherFinalist.roundStartedAt = nowStart;
          await this.tournamentProgressRepository.save(otherFinalist);
        }
        await this.tournamentProgressRepository.save(progress);
        allProgress = await this.tournamentProgressRepository.find({ where: { tournamentId } });
        sharedStart = this.getCurrentRoundSharedStart(tournament, userId, progress, allProgress);
      } else {
        const soloFinalist = this.getSoloFinalistByOppositeSemiTimeout(tournament, allProgress);
        const mySemiTotalHere = this.QUESTIONS_PER_ROUND + (progress.tiebreakerRoundsCorrect?.length ?? 0) * this.TIEBREAKER_QUESTIONS;
        if (
          soloFinalist?.userId === userId
          && createdFinalQuestions
          && (progress.questionsAnsweredCount ?? 0) < mySemiTotalHere + this.QUESTIONS_PER_ROUND
        ) {
          progress.roundStartedAt = new Date();
          await this.tournamentProgressRepository.save(progress);
          allProgress = await this.tournamentProgressRepository.find({ where: { tournamentId } });
          sharedStart = this.getCurrentRoundSharedStart(tournament, userId, progress, allProgress);
        }
      }
    }
    const deadline: string | null = sharedStart ? this.getRoundDeadline(sharedStart) : null;
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
      const oppSlotTB = playerSlotForSemi % 2 === 0 ? playerSlotForSemi + 1 : playerSlotForSemi - 1;
      const oppIdTB = oppSlotTB >= 0 && oppSlotTB < (tournament.playerOrder?.length ?? 0) ? (tournament.playerOrder![oppSlotTB] ?? -1) : -1;
      const oppProgress = oppIdTB > 0
        ? await this.tournamentProgressRepository.findOne({ where: { userId: oppIdTB, tournamentId } })
        : null;
      const myQ = questionsAnsweredCount;
      const oppQ = oppProgress?.questionsAnsweredCount ?? 0;
      const semiState = this.getSemiHeadToHeadState(
        myQ,
        progress.semiFinalCorrectCount,
        progress.tiebreakerRoundsCorrect,
        oppQ,
        oppProgress?.semiFinalCorrectCount,
        oppProgress?.tiebreakerRoundsCorrect,
      );

      tiebreakerRound = semiState.tiebreakerRound ?? 1;
      tiebreakerBase = this.QUESTIONS_PER_ROUND + (tiebreakerRound - 1) * this.TIEBREAKER_QUESTIONS;
      const roundIndex = 2 + tiebreakerRound;
      let existing = await this.questionRepository.find({
        where: { tournament: { id: tournamentId }, roundIndex },
        order: { id: 'ASC' },
      });
      if (existing.length < this.TIEBREAKER_QUESTIONS) {
        const excludedQuestionKeys = await this.getTournamentQuestionKeySet(tournamentId);
        const pool = await this.pickRandomQuestions(this.TIEBREAKER_QUESTIONS, excludedQuestionKeys);
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
            const finalState = this.getFinalHeadToHeadState(progress, finalistProgress);
            if (finalState.result === 'tie') {
              tiebreakerPhase = 'final';
              const ftbRound = finalState.tiebreakerRound ?? 1;
              tiebreakerRound = ftbRound;
              tiebreakerBase = mySemiTotal + this.QUESTIONS_PER_ROUND + (ftbRound - 1) * this.TIEBREAKER_QUESTIONS;
              const roundIndex = 100 + ftbRound;
              let existing = await this.questionRepository.find({
                where: { tournament: { id: tournamentId }, roundIndex },
                order: { id: 'ASC' },
              });
              if (existing.length < this.TIEBREAKER_QUESTIONS) {
                const excludedQuestionKeys = await this.getTournamentQuestionKeySet(tournamentId);
                const pool = await this.pickRandomQuestions(this.TIEBREAKER_QUESTIONS, excludedQuestionKeys);
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
   * Исправляет отображение текста при неправильной интерпретации кодировки (UTF-8 как Latin-1).
   * Пробует одинарную и двойную перекодировку; возвращает вариант с большим количеством кириллицы.
   */
  private sanitizeUtf8ForDisplay(s: string): string {
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

  private findSemiWinner(
    p1: TournamentProgress | null,
    p2: TournamentProgress | null,
    allowUnevenResolved = false,
  ): TournamentProgress | null {
    if (!p1 || !p2) return p1 || p2;
    const semiState = this.getSemiHeadToHeadState(
      p1.questionsAnsweredCount ?? 0,
      p1.semiFinalCorrectCount,
      p1.tiebreakerRoundsCorrect,
      p2.questionsAnsweredCount ?? 0,
      p2.semiFinalCorrectCount,
      p2.tiebreakerRoundsCorrect,
      allowUnevenResolved,
    );
    if (semiState.result === 'won') return p1;
    if (semiState.result === 'lost') return p2;
    return null;
  }

  private didSemiPairBothLoseByTimeout(
    p1: TournamentProgress | null | undefined,
    p2: TournamentProgress | null | undefined,
  ): boolean {
    if (!p1 || !p2) return false;
    const p1Answered = p1.questionsAnsweredCount ?? 0;
    const p2Answered = p2.questionsAnsweredCount ?? 0;
    return p1Answered < this.QUESTIONS_PER_ROUND && p2Answered < this.QUESTIONS_PER_ROUND;
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
    const realPlayerCount = order.filter((id) => id > 0).length;
    if (tournament.gameType === 'money' && realPlayerCount < 4) return false;
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
    const semiState = this.getSemiHeadToHeadState(
      myQ,
      myProgress?.semiFinalCorrectCount,
      myProgress?.tiebreakerRoundsCorrect,
      oppQ,
      oppProgress?.semiFinalCorrectCount,
      oppProgress?.tiebreakerRoundsCorrect,
    );
    return semiState.result === 'won';
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
    if (oppId == null || oppId <= 0) return 'waiting';

    const oppProgress = await this.tournamentProgressRepository.findOne({ where: { userId: oppId, tournamentId: tournament.id } });
    const oppQ = oppProgress?.questionsAnsweredCount ?? 0;

    if (oppQ < this.QUESTIONS_PER_ROUND) return 'waiting';
    const semiState = this.getSemiHeadToHeadState(
      myQ,
      myProgress?.semiFinalCorrectCount,
      myProgress?.tiebreakerRoundsCorrect,
      oppQ,
      oppProgress?.semiFinalCorrectCount,
      oppProgress?.tiebreakerRoundsCorrect,
    );
    if (semiState.result === 'won') return 'won';
    if (semiState.result === 'lost') return 'lost';
    return 'tie';
  }

  /** Подсчитать количество верных ответов на основе answersChosen и вопросов турнира.
   *  answersChosen хранится в реальном порядке игры:
   *  [semi, semi-tiebreakers..., final, final-tiebreakers...].
   *  Нужно сравнивать с вопросами нужного полуфинала (по semiRoundIndex),
   *  затем с полуфинальными допраундами, потом с финалом и только потом с финальными допраундами. */
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
    const semiTiebreakerQuestions = questions
      .filter((q) => q.roundIndex >= 3 && q.roundIndex < 100)
      .sort((a, b) => a.roundIndex - b.roundIndex || a.id - b.id);
    const finalQuestions = questions.filter((q) => q.roundIndex === 2).sort((a, b) => a.id - b.id);
    const finalTiebreakerQuestions = questions
      .filter((q) => q.roundIndex >= 100)
      .sort((a, b) => a.roundIndex - b.roundIndex || a.id - b.id);
    const playerQuestions = [...semiQuestions, ...semiTiebreakerQuestions, ...finalQuestions, ...finalTiebreakerQuestions];
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
        const finalTBLen = (progress.finalTiebreakerRoundsCorrect ?? []).length;
        for (let r = 1; r <= finalTBLen; r++) {
          boundaries.push(fStart + this.QUESTIONS_PER_ROUND + r * this.TIEBREAKER_QUESTIONS);
        }
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
      const freshSemiState = this.getSemiHeadToHeadState(
        freshMy.questionsAnsweredCount ?? 0,
        freshMy.semiFinalCorrectCount,
        freshMy.tiebreakerRoundsCorrect,
        freshOpp.questionsAnsweredCount ?? 0,
        freshOpp.semiFinalCorrectCount,
        freshOpp.tiebreakerRoundsCorrect,
      );
      if (freshSemiState.result === 'tie' || freshSemiState.result === 'incomplete') return;
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

    const realPlayerCount = order.filter((id) => id > 0).length;
    if (tournament.gameType === 'money' && realPlayerCount < 4) return;

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
    if (!finalistProgress) {
      if (this.didSemiPairBothLoseByTimeout(p1, p2)) {
        const soloFinal = this.getSoloFinalOutcome(myProgress, false);
        if (soloFinal.result === 'incomplete') return;
        await saveResult(userId, soloFinal.result === 'won');
        await this.tournamentRepository.update({ id: tournamentId }, { status: TournamentStatus.FINISHED });
      }
      return;
    }

    const finalistId = finalistProgress.userId;
    const finalState = this.getFinalHeadToHeadState(myProgress, finalistProgress);
    if (finalState.result === 'incomplete' || finalState.result === 'tie') return;
    const myWon = finalState.result === 'won';

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
    final: { players: { id: number; username: string; nickname?: string | null; semiScore?: number; questionsAnswered?: number; correctAnswersCount?: number; finalScore?: number; finalAnswered?: number; finalCorrect?: number }[] };
    finalWinnerId?: number | null;
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
    const viewerProgress = progressByUser.get(userId);
    const viewerSharedStart = viewerProgress
      ? this.getCurrentRoundSharedStart(tournament, userId, viewerProgress, progressList)
      : null;
    const activeRoundDeadline = viewerSharedStart ? this.getRoundDeadline(viewerSharedStart) : null;

    const isTimeExpired = activeRoundDeadline ? new Date(activeRoundDeadline) < new Date() : false;
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
      const tbRounds = prog?.tiebreakerRoundsCorrect ?? [];
      const semiBaseCorrect = prog?.semiFinalCorrectCount != null && prog.semiFinalCorrectCount <= this.QUESTIONS_PER_ROUND
        ? prog.semiFinalCorrectCount
        : q <= this.QUESTIONS_PER_ROUND
          ? (prog?.correctAnswersCount ?? 0)
          : 0;
      const semiTiebreakerCorrectTotal = tbRounds.reduce((a: number, b: number) => a + b, 0);
      const inFinalPhase = prog ? this.isPlayerInFinalPhase(prog, progressList, tournament) : false;
      const completedSemiQuestions = this.QUESTIONS_PER_ROUND + tbRounds.length * this.TIEBREAKER_QUESTIONS;
      let semiAnswered = Math.min(q, completedSemiQuestions);
      if (!inFinalPhase && q > completedSemiQuestions) {
        semiAnswered = Math.min(q, completedSemiQuestions + this.TIEBREAKER_QUESTIONS);
      }
      const semiScore = q > 0
        ? inFinalPhase
          ? semiBaseCorrect + semiTiebreakerCorrectTotal
          : (prog?.correctAnswersCount ?? 0)
        : undefined;

      let tiebreakerRound = 0;
      let tiebreakerAnswered = 0;
      let tiebreakerCorrect: number | undefined;
      if (!inFinalPhase && q > this.QUESTIONS_PER_ROUND && prog?.semiFinalCorrectCount != null) {
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
        questionsAnswered: semiAnswered,
        correctAnswersCount: semiScore ?? 0,
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
      const semiState = this.getSemiHeadToHeadState(
        prog0?.questionsAnsweredCount ?? 0,
        prog0?.semiFinalCorrectCount,
        prog0?.tiebreakerRoundsCorrect,
        prog1?.questionsAnsweredCount ?? 0,
        prog1?.semiFinalCorrectCount,
        prog1?.tiebreakerRoundsCorrect,
        isCompleted,
      );
      if (semiState.result === 'won') return 1;
      if (semiState.result === 'lost') return 0;
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
      const semiResolved = this.resolveStageTotals(
        prog0?.questionsAnsweredCount ?? 0,
        prog0?.semiFinalCorrectCount ?? 0,
        prog0?.tiebreakerRoundsCorrect,
        prog1?.questionsAnsweredCount ?? 0,
        prog1?.semiFinalCorrectCount ?? 0,
        prog1?.tiebreakerRoundsCorrect,
        isCompleted,
      );
      const sharedAnswered = this.QUESTIONS_PER_ROUND + semiResolved.roundsUsed * this.TIEBREAKER_QUESTIONS;
      const player0 = {
        ...toPlayer(p0, loserIndex === 0),
        questionsAnswered: sharedAnswered,
        semiScore: semiResolved.myTotal,
        correctAnswersCount: semiResolved.myTotal,
      };
      const player1 = {
        ...toPlayer(p1, loserIndex === 1),
        questionsAnswered: sharedAnswered,
        semiScore: semiResolved.oppTotal,
        correctAnswersCount: semiResolved.oppTotal,
      };
      return [
        player0,
        player1,
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
      const finalAnswered = q > semiPhase ? Math.max(0, q - semiPhase) : 0;
      const finalCorrect = q > semiPhase ? Math.max(0, totalCorrect - semiCorrect - semiTBSum) : 0;
      const finalScore = finalAnswered > 0 ? finalCorrect : undefined;
      return {
        ...toPlayer(pl, false),
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

    const finalPlayers: { id: number; username: string; nickname?: string | null; semiScore?: number; questionsAnswered?: number; correctAnswersCount?: number; finalScore?: number; finalAnswered?: number; finalCorrect?: number }[] = [];
    if (order.length >= 2) {
      const winner1 = semiWinner(0, 1);
      if (winner1) finalPlayers.push(enrichFinalPlayer(winner1, progressByUser.get(winner1.id)));
    }
    if (order.length >= 4) {
      const winner2 = semiWinner(2, 3);
      if (winner2) finalPlayers.push(enrichFinalPlayer(winner2, progressByUser.get(winner2.id)));
    }

    const getBracketFinalWinnerId = (): number | null => {
      if (finalPlayers.length === 1) {
        const finalistId = finalPlayers[0]?.id ?? null;
        if (!finalistId) return null;
        const soloFinalist = this.getSoloFinalistByOppositeSemiTimeout(tournament, progressList);
        if (soloFinalist?.userId !== finalistId) return null;
        const soloOutcome = this.getSoloFinalOutcome(
          soloFinalist,
          tournament.status === TournamentStatus.FINISHED,
        );
        return soloOutcome.result === 'won' ? finalistId : null;
      }
      if (finalPlayers.length < 2) return null;

      const fp0 = finalPlayers[0];
      const fp1 = finalPlayers[1];
      if (!fp0 || !fp1) return null;

      const prog0 = progressByUser.get(fp0.id);
      const prog1 = progressByUser.get(fp1.id);
      if (!prog0 || !prog1) return null;
      const finalState = this.getFinalHeadToHeadState(prog0, prog1, isCompleted);
      if (finalState.result === 'won') return fp0.id;
      if (finalState.result === 'lost') return fp1.id;
      return null;
    };

    if (finalPlayers.length >= 2) {
      const p0 = finalPlayers[0];
      const p1 = finalPlayers[1];
      const prog0 = p0 ? progressByUser.get(p0.id) : undefined;
      const prog1 = p1 ? progressByUser.get(p1.id) : undefined;
      if (p0 && p1 && prog0 && prog1) {
        const finalResolved = this.resolveStageTotals(
          Math.max(0, (prog0.questionsAnsweredCount ?? 0) - (this.QUESTIONS_PER_ROUND + (prog0.tiebreakerRoundsCorrect?.length ?? 0) * this.TIEBREAKER_QUESTIONS)),
          this.getFinalStageBaseCorrect(prog0),
          prog0.finalTiebreakerRoundsCorrect ?? [],
          Math.max(0, (prog1.questionsAnsweredCount ?? 0) - (this.QUESTIONS_PER_ROUND + (prog1.tiebreakerRoundsCorrect?.length ?? 0) * this.TIEBREAKER_QUESTIONS)),
          this.getFinalStageBaseCorrect(prog1),
          prog1.finalTiebreakerRoundsCorrect ?? [],
          isCompleted,
        );
        const sharedFinalAnswered = this.QUESTIONS_PER_ROUND + finalResolved.roundsUsed * this.TIEBREAKER_QUESTIONS;
        finalPlayers[0] = { ...p0, finalAnswered: sharedFinalAnswered, finalScore: finalResolved.myTotal, finalCorrect: finalResolved.myTotal };
        finalPlayers[1] = { ...p1, finalAnswered: sharedFinalAnswered, finalScore: finalResolved.oppTotal, finalCorrect: finalResolved.oppTotal };
      }
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
      finalWinnerId: getBracketFinalWinnerId(),
    };
  }

  /** Синхронизирует tournament_players_user из tournament_entry: только INSERT недостающих пар (tournamentId, userId). Не трогаем существующие строки — save(tournament) перезаписывал бы всю связь и удалял других игроков (баг после ввода админской сводки). */
  private async syncTournamentPlayersFromEntry(userId: number): Promise<void> {
    const entries = await this.tournamentEntryRepository.find({
      where: { user: { id: userId } },
      relations: ['tournament'],
    });
    const tids = [...new Set(entries.map((e) => (e.tournament as any)?.id ?? (e as any).tournamentId).filter((id): id is number => typeof id === 'number' && id > 0))];
    if (tids.length === 0) return;
    const dataSource = this.tournamentRepository.manager.connection;
    for (const tid of tids) {
      try {
        await dataSource.query(
          `INSERT INTO tournament_players_user ("tournamentId", "userId")
           SELECT $1, $2 WHERE NOT EXISTS (
             SELECT 1 FROM tournament_players_user WHERE "tournamentId" = $1 AND "userId" = $2
           )`,
          [tid, userId],
        );
      } catch (e) {
        this.logger.warn('[syncTournamentPlayersFromEntry]', (e as Error)?.message);
      }
    }
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