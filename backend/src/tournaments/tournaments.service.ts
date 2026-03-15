import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository, In, IsNull, Not } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  Tournament,
  TournamentStatus,
  ROUND_DEADLINE_HOURS,
} from './tournament.entity';
import { Question } from './question.entity';
import { QuestionPoolItem } from './question-pool.entity';
import { TournamentEntry } from './tournament-entry.entity';
import { TournamentResult } from './tournament-result.entity';
import { TournamentProgress } from './tournament-progress.entity';
import { TournamentEscrow } from './tournament-escrow.entity';
import {
  TournamentRoundResolution,
  TournamentResolutionOutcome,
  TournamentResolutionReason,
  TournamentResolutionSource,
  TournamentResolutionStage,
} from './tournament-round-resolution.entity';
import { User } from '../users/user.entity';
import { Transaction } from '../users/transaction.entity';
import { UsersService } from '../users/users.service';
import {
  LEAGUE_AMOUNTS,
  LEAGUE_WINS_TO_UNLOCK,
  QUESTIONS_PER_ROUND,
  TIEBREAKER_QUESTIONS,
  getLeagueName,
  getLeaguePrize,
  getMinBalanceForLeague,
  getTournamentDisplayName,
} from './domain/constants';
import {
  getOpponentSlot,
  getSemiPairIndexBySlot as getSemiPairIndexBySlotFromOrder,
  getSemiPairUserIds as getSemiPairUserIdsFromOrder,
} from './domain/player-order';
import {
  buildTournamentViewMeta,
  type TournamentListBucket,
  type TournamentResultKind,
  type TournamentResultTone,
  type TournamentStageKind,
} from './domain/view-model';
import {
  canReuseTournamentCandidate,
  isTournamentStructurallyFinishable,
  pickResumeTournamentId,
  pickReusableTournamentCandidate,
  shouldTournamentBeActive,
} from './domain/reusable-tournament';
import { buildTrainingReviewRounds } from './domain/training-review';
import {
  type TournamentBracketDto,
  type TournamentInfoDto,
  type TournamentListItemDto,
  type TournamentListResponseDto,
  type TournamentQuestionDto,
  type TournamentReusablePreviewDto,
  type TournamentReusablePreviewItemDto,
  type TournamentStateDto,
  type TournamentTrainingStateDto,
} from './dto/tournament-read.dto';

interface TournamentListResultState {
  label: string;
  kind: TournamentResultKind;
}

interface ReusableTournamentPoolEntry {
  id: number;
  playerCount: number;
  hasCurrentUser: boolean;
  progressCount: number;
  tournament: Tournament;
}

export type MoneyTournamentSettlementResolution = {
  settlementType: 'unresolved' | 'paid_to_winner' | 'forfeited';
  winnerId: number | null;
  participantCount: number;
};

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
    @InjectRepository(TournamentRoundResolution)
    private readonly tournamentRoundResolutionRepository: Repository<TournamentRoundResolution>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    @Inject(forwardRef(() => UsersService))
    private readonly usersService: UsersService,
  ) {}

  private readonly logger = new Logger(TournamentsService.name);

  private async loadReusableTournamentPool(
    manager: EntityManager,
    args: {
      gameType: 'training' | 'money';
      userId?: number;
      leagueAmount?: number | null;
      lockRows?: boolean;
    },
  ): Promise<ReusableTournamentPoolEntry[]> {
    const tournamentRepository = manager.getRepository(Tournament);
    const query = tournamentRepository
      .createQueryBuilder('t')
      .leftJoinAndSelect('t.players', 'player')
      .where('t.gameType = :gameType', { gameType: args.gameType })
      .andWhere('t.status IN (:...statuses)', {
        statuses: [TournamentStatus.WAITING, TournamentStatus.ACTIVE],
      })
      .orderBy('t.id', 'ASC');

    if (args.leagueAmount != null) {
      query.andWhere('t.leagueAmount = :leagueAmount', {
        leagueAmount: args.leagueAmount,
      });
    }
    if (args.lockRows) {
      query.setLock('pessimistic_write', undefined, ['t']);
    }

    const tournaments = await query.getMany();
    const tournamentIds = tournaments.map((tournament) => tournament.id);
    const progressRows =
      tournamentIds.length > 0
        ? await manager.getRepository(TournamentProgress).find({
            where: { tournamentId: In(tournamentIds) },
            select: ['tournamentId'],
          })
        : [];
    const progressCountByTournamentId = new Map<number, number>();
    for (const row of progressRows) {
      progressCountByTournamentId.set(
        row.tournamentId,
        (progressCountByTournamentId.get(row.tournamentId) ?? 0) + 1,
      );
    }

    return tournaments.map((tournament) => ({
      id: tournament.id,
      playerCount: this.getTournamentPlayerCount(tournament),
      hasCurrentUser:
        args.userId != null
          ? tournament.players.some((player) => player.id === args.userId)
          : false,
      progressCount: progressCountByTournamentId.get(tournament.id) ?? 0,
      tournament,
    }));
  }

  private pickReusableTournamentEntry(
    entries: ReusableTournamentPoolEntry[],
  ): ReusableTournamentPoolEntry | null {
    return pickReusableTournamentCandidate(entries);
  }

  private toReusableTournamentPreviewItem(
    entry: ReusableTournamentPoolEntry,
  ): TournamentReusablePreviewItemDto {
    return {
      id: entry.id,
      status: entry.tournament.status,
      playerCount: entry.playerCount,
      progressCount: entry.progressCount,
      hasCurrentUser: entry.hasCurrentUser,
      canReuse: canReuseTournamentCandidate(entry),
      leagueAmount: entry.tournament.leagueAmount ?? null,
    };
  }

  async previewReusableTournamentSelection(args: {
    mode: 'training' | 'money';
    userId?: number;
    leagueAmount?: number | null;
  }): Promise<TournamentReusablePreviewDto> {
    const entries = await this.loadReusableTournamentPool(
      this.tournamentRepository.manager,
      {
        gameType: args.mode,
        userId: args.userId,
        leagueAmount: args.leagueAmount ?? null,
      },
    );
    const candidate = this.pickReusableTournamentEntry(entries);
    return {
      mode: args.mode,
      userId: args.userId ?? null,
      leagueAmount: args.leagueAmount ?? null,
      candidateTournamentId: candidate?.id ?? null,
      candidates: entries.map((entry) => this.toReusableTournamentPreviewItem(entry)),
    };
  }

  private getResolutionMapKey(
    tournamentId: number,
    stage: TournamentResolutionStage,
    pairIndex: number,
  ): string {
    return `${tournamentId}:${stage}:${pairIndex}`;
  }

  private buildLatestResolutionMap(
    rows: TournamentRoundResolution[],
  ): Map<string, TournamentRoundResolution> {
    const map = new Map<string, TournamentRoundResolution>();
    for (const row of rows) {
      const key = this.getResolutionMapKey(
        row.tournamentId,
        row.stage,
        row.pairIndex,
      );
      const prev = map.get(key);
      if (
        !prev ||
        row.roundNumber > prev.roundNumber ||
        (row.roundNumber === prev.roundNumber &&
          (row.resolvedAt?.getTime?.() ?? 0) >
            (prev.resolvedAt?.getTime?.() ?? 0))
      ) {
        map.set(key, row);
      }
    }
    return map;
  }

  private getLatestResolutionFromMap(
    map: Map<string, TournamentRoundResolution>,
    tournamentId: number,
    stage: TournamentResolutionStage,
    pairIndex: number,
  ): TournamentRoundResolution | null {
    return (
      map.get(this.getResolutionMapKey(tournamentId, stage, pairIndex)) ?? null
    );
  }

  private getRoundDeadlineDate(
    sharedStart: Date | null | undefined,
  ): Date | null {
    if (!(sharedStart instanceof Date)) return null;
    return new Date(sharedStart.getTime() + ROUND_DEADLINE_HOURS * 3600000);
  }

  private getSemiPairIndexBySlot(playerSlot: number): 0 | 1 | null {
    return getSemiPairIndexBySlotFromOrder(playerSlot);
  }

  private getSemiPairUserIds(
    order: number[] | null | undefined,
    pairIndex: 0 | 1,
  ): [number, number] {
    return getSemiPairUserIdsFromOrder(order, pairIndex);
  }

  private getSemiCurrentRoundNumber(
    p1:
      | Pick<
          TournamentProgress,
          | 'questionsAnsweredCount'
          | 'semiFinalCorrectCount'
          | 'tiebreakerRoundsCorrect'
        >
      | null
      | undefined,
    p2:
      | Pick<
          TournamentProgress,
          | 'questionsAnsweredCount'
          | 'semiFinalCorrectCount'
          | 'tiebreakerRoundsCorrect'
        >
      | null
      | undefined,
  ): number {
    const semiState = this.getSemiHeadToHeadState(
      p1?.questionsAnsweredCount ?? 0,
      p1?.semiFinalCorrectCount,
      p1?.tiebreakerRoundsCorrect,
      p2?.questionsAnsweredCount ?? 0,
      p2?.semiFinalCorrectCount,
      p2?.tiebreakerRoundsCorrect,
    );
    return semiState.result === 'tie' ? (semiState.tiebreakerRound ?? 1) : 0;
  }

  private getFinalCurrentRoundNumber(
    p1: TournamentProgress | null | undefined,
    p2: TournamentProgress | null | undefined,
  ): number {
    const finalState = this.getFinalHeadToHeadState(p1, p2);
    return finalState.result === 'tie' ? (finalState.tiebreakerRound ?? 1) : 0;
  }

  private getTimeoutOutcomeForUser(
    resolution: TournamentRoundResolution | null | undefined,
    userId: number,
  ): 'won' | 'lost' | 'both_lost' | null {
    if (!resolution || resolution.reason !== TournamentResolutionReason.TIMEOUT)
      return null;
    if (resolution.outcome === TournamentResolutionOutcome.BOTH_LOST)
      return 'both_lost';
    if (resolution.winnerUserId === userId) return 'won';
    if (resolution.loserUserId === userId) return 'lost';
    return null;
  }

  private normalizeProgressSnapshot(
    progress: TournamentProgress | null | undefined,
    applyCurrentIndexFixes = false,
  ): {
    q: number;
    semiCorrect: number | null;
    totalCorrect: number;
    currentIndex: number;
    tiebreakerRounds: number[];
    finalTiebreakerRounds: number[];
    roundStartedAt: Date | null;
    leftAt: Date | null;
    timeLeftSeconds: number | null;
    answersChosen: number[];
    lockedAnswerCount: number;
  } {
    if (!progress) {
      return {
        q: 0,
        semiCorrect: null,
        totalCorrect: 0,
        currentIndex: 0,
        tiebreakerRounds: [],
        finalTiebreakerRounds: [],
        roundStartedAt: null,
        leftAt: null,
        timeLeftSeconds: null,
        answersChosen: [],
        lockedAnswerCount: 0,
      };
    }

    let adjustedQ = progress.questionsAnsweredCount ?? 0;
    let adjustedSemiCorrect = progress.semiFinalCorrectCount ?? null;

    if (applyCurrentIndexFixes) {
      if (
        adjustedQ === QUESTIONS_PER_ROUND - 1 &&
        progress.currentQuestionIndex === QUESTIONS_PER_ROUND - 1
      ) {
        adjustedQ = QUESTIONS_PER_ROUND;
      } else if (
        adjustedQ === 2 * QUESTIONS_PER_ROUND - 1 &&
        progress.currentQuestionIndex === 2 * QUESTIONS_PER_ROUND - 1
      ) {
        adjustedQ = 2 * QUESTIONS_PER_ROUND;
      } else if (
        progress.currentQuestionIndex >= QUESTIONS_PER_ROUND - 1 &&
        adjustedQ < QUESTIONS_PER_ROUND
      ) {
        adjustedQ = QUESTIONS_PER_ROUND;
      } else if (
        progress.currentQuestionIndex >= 2 * QUESTIONS_PER_ROUND - 1 &&
        adjustedQ < 2 * QUESTIONS_PER_ROUND
      ) {
        adjustedQ = 2 * QUESTIONS_PER_ROUND;
      }

      if (progress.currentQuestionIndex > 0) {
        adjustedQ = Math.max(adjustedQ, progress.currentQuestionIndex);
      }

      if (
        progress.semiFinalCorrectCount != null &&
        adjustedQ < QUESTIONS_PER_ROUND &&
        (progress.questionsAnsweredCount ?? 0) >= QUESTIONS_PER_ROUND - 2
      ) {
        adjustedQ = Math.max(adjustedQ, QUESTIONS_PER_ROUND);
      }
    }

    if (
      adjustedSemiCorrect == null &&
      adjustedQ >= QUESTIONS_PER_ROUND &&
      progress.correctAnswersCount != null
    ) {
      adjustedSemiCorrect = Math.min(
        QUESTIONS_PER_ROUND,
        progress.correctAnswersCount,
      );
    }

    if (
      adjustedQ === QUESTIONS_PER_ROUND + 1 &&
      (progress.currentQuestionIndex ?? 0) >= QUESTIONS_PER_ROUND &&
      adjustedSemiCorrect != null &&
      (progress.lockedAnswerCount ?? 0) <= QUESTIONS_PER_ROUND
    ) {
      adjustedQ = QUESTIONS_PER_ROUND;
    }

    return {
      q: adjustedQ,
      semiCorrect: adjustedSemiCorrect,
      totalCorrect: progress.correctAnswersCount ?? 0,
      currentIndex: progress.currentQuestionIndex ?? 0,
      tiebreakerRounds: Array.isArray(progress.tiebreakerRoundsCorrect)
        ? progress.tiebreakerRoundsCorrect
        : [],
      finalTiebreakerRounds: Array.isArray(
        (progress as any).finalTiebreakerRoundsCorrect,
      )
        ? (progress as any).finalTiebreakerRoundsCorrect
        : [],
      roundStartedAt: progress.roundStartedAt ?? null,
      leftAt: progress.leftAt ?? null,
      timeLeftSeconds: progress.timeLeftSeconds ?? null,
      answersChosen: this.normalizeAnswersChosen(progress.answersChosen),
      lockedAnswerCount: progress.lockedAnswerCount ?? 0,
    };
  }

  private async upsertTimeoutResolution(params: {
    tournamentId: number;
    stage: TournamentResolutionStage;
    pairIndex: number;
    roundNumber: number;
    slotAUserId: number;
    slotBUserId: number;
    outcome: TournamentResolutionOutcome;
    winnerUserId: number | null;
    loserUserId: number | null;
    sharedRoundStartedAt: Date | null;
    deadlineAt: Date | null;
    source: TournamentResolutionSource;
    meta?: Record<string, unknown> | null;
  }): Promise<TournamentRoundResolution> {
    let row = await this.tournamentRoundResolutionRepository.findOne({
      where: {
        tournamentId: params.tournamentId,
        stage: params.stage,
        pairIndex: params.pairIndex,
        roundNumber: params.roundNumber,
      },
    });

    if (!row) {
      row = this.tournamentRoundResolutionRepository.create({
        tournamentId: params.tournamentId,
        stage: params.stage,
        pairIndex: params.pairIndex,
        roundNumber: params.roundNumber,
        slotAUserId: params.slotAUserId,
        slotBUserId: params.slotBUserId,
        outcome: params.outcome,
        reason: TournamentResolutionReason.TIMEOUT,
        winnerUserId: params.winnerUserId,
        loserUserId: params.loserUserId,
        sharedRoundStartedAt: params.sharedRoundStartedAt,
        deadlineAt: params.deadlineAt,
        source: params.source,
        meta: params.meta ?? null,
      });
      return this.tournamentRoundResolutionRepository.save(row);
    }

    row.slotAUserId = params.slotAUserId;
    row.slotBUserId = params.slotBUserId;
    row.outcome = params.outcome;
    row.reason = TournamentResolutionReason.TIMEOUT;
    row.winnerUserId = params.winnerUserId;
    row.loserUserId = params.loserUserId;
    row.sharedRoundStartedAt = params.sharedRoundStartedAt;
    row.deadlineAt = params.deadlineAt;
    row.source = params.source;
    row.meta = params.meta ?? null;
    return this.tournamentRoundResolutionRepository.save(row);
  }

  private async getTournamentTimeoutResolutionMap(
    tournamentId: number,
  ): Promise<Map<string, TournamentRoundResolution>> {
    const rows = await this.tournamentRoundResolutionRepository.find({
      where: {
        tournamentId,
        reason: TournamentResolutionReason.TIMEOUT,
      },
    });
    return this.buildLatestResolutionMap(rows);
  }

  async getMoneyTournamentSettlementResolution(
    tournamentId: number,
    now: Date = new Date(),
  ): Promise<MoneyTournamentSettlementResolution> {
    const tournament = await this.tournamentRepository.findOne({
      where: { id: tournamentId },
      relations: ['players'],
    });
    if (!tournament || tournament.gameType !== 'money') {
      return {
        settlementType: 'unresolved',
        winnerId: null,
        participantCount: 0,
      };
    }

    this.sortPlayersByOrder(tournament);
    const participantIds = (tournament.playerOrder ?? []).filter(
      (id): id is number => id > 0,
    );
    const allProgress = await this.tournamentProgressRepository.find({
      where: { tournamentId },
    });
    const timeoutResolutionMap =
      await this.getTournamentTimeoutResolutionMap(tournamentId);
    const resolved = this.resolveTournamentOutcome(
      tournament,
      allProgress,
      timeoutResolutionMap,
      now,
      true,
    );

    if (!resolved.finished) {
      return {
        settlementType: 'unresolved',
        winnerId: null,
        participantCount: participantIds.length,
      };
    }

    return {
      settlementType: resolved.winnerId ? 'paid_to_winner' : 'forfeited',
      winnerId: resolved.winnerId,
      participantCount: participantIds.length,
    };
  }

  private getOwnSemiTimeoutResolutionFromMap(
    tournament: Tournament,
    userId: number,
    map: Map<string, TournamentRoundResolution>,
  ): TournamentRoundResolution | null {
    const order = tournament.playerOrder ?? [];
    const playerSlot = order.indexOf(userId);
    const pairIndex = this.getSemiPairIndexBySlot(playerSlot);
    if (pairIndex == null) return null;
    return this.getLatestResolutionFromMap(
      map,
      tournament.id,
      TournamentResolutionStage.SEMI,
      pairIndex,
    );
  }

  private getOppositeSemiTimeoutResolutionFromMap(
    tournament: Tournament,
    userId: number,
    map: Map<string, TournamentRoundResolution>,
  ): TournamentRoundResolution | null {
    const order = tournament.playerOrder ?? [];
    const playerSlot = order.indexOf(userId);
    if (playerSlot < 0 || order.length <= 2) return null;
    const pairIndex: 0 | 1 = playerSlot < 2 ? 1 : 0;
    return this.getLatestResolutionFromMap(
      map,
      tournament.id,
      TournamentResolutionStage.SEMI,
      pairIndex,
    );
  }

  private getFinalTimeoutResolutionFromMap(
    tournament: Tournament,
    map: Map<string, TournamentRoundResolution>,
  ): TournamentRoundResolution | null {
    return this.getLatestResolutionFromMap(
      map,
      tournament.id,
      TournamentResolutionStage.FINAL,
      0,
    );
  }

  private getCurrentRoundTimeoutResolution(
    tournament: Tournament,
    userId: number,
    progress: TournamentProgress | null | undefined,
    allProgress: TournamentProgress[],
    resolutionMap: Map<string, TournamentRoundResolution>,
  ): TournamentRoundResolution | null {
    const inFinal = this.isPlayerInFinalPhase(
      progress,
      allProgress,
      tournament,
      resolutionMap,
    );
    return inFinal
      ? this.getFinalTimeoutResolutionFromMap(tournament, resolutionMap)
      : this.getOwnSemiTimeoutResolutionFromMap(tournament, userId, resolutionMap);
  }

  private async assertTournamentProgressWritable(
    tournament: Tournament,
    userId: number,
    progress: TournamentProgress | null | undefined,
    allProgress: TournamentProgress[],
    now: Date,
  ): Promise<void> {
    const timeoutResolutionMap = await this.synchronizeTournamentTimingState(
      tournament,
      allProgress,
      now,
    );
    const blockReason = this.getTournamentProgressWriteBlockReason(
      tournament,
      userId,
      progress,
      allProgress,
      timeoutResolutionMap,
      now,
    );
    if (blockReason) {
      throw new BadRequestException(blockReason);
    }
  }

  private async synchronizeTournamentTimingState(
    tournament: Tournament,
    allProgress: TournamentProgress[],
    now: Date,
  ): Promise<Map<string, TournamentRoundResolution>> {
    await this.backfillTimeoutRoundResolutions([tournament.id]);
    const timeoutResolutionMap = await this.getTournamentTimeoutResolutionMap(
      tournament.id,
    );
    await this.finalizeTournamentIfResolved(
      tournament,
      allProgress,
      timeoutResolutionMap,
      now,
      true,
    );
    return timeoutResolutionMap;
  }

  private getTournamentProgressWriteBlockReason(
    tournament: Tournament,
    userId: number,
    progress: TournamentProgress | null | undefined,
    allProgress: TournamentProgress[],
    timeoutResolutionMap: Map<string, TournamentRoundResolution>,
    now: Date,
  ): string | null {
    if (tournament.status === TournamentStatus.FINISHED) {
      return 'Tournament is finished';
    }

    const timeoutResolution = this.getCurrentRoundTimeoutResolution(
      tournament,
      userId,
      progress,
      allProgress,
      timeoutResolutionMap,
    );
    if (this.getTimeoutOutcomeForUser(timeoutResolution, userId)) {
      return 'Round deadline expired';
    }

    const currentRoundStartedAt = this.getCurrentRoundSharedStart(
      tournament,
      userId,
      progress,
      allProgress,
      timeoutResolutionMap,
    );
    if (this.isRoundDeadlinePassed(currentRoundStartedAt, now)) {
      return 'Round deadline expired';
    }
    return null;
  }

  async onModuleInit(): Promise<void> {
    this.logger.log(
      'Tournament startup backfills are disabled by default; use explicit maintenance actions when needed.',
    );
  }

  /**
   * Дозаполняет completedAt у записей tournament_result, где дата отсутствует.
   * Берёт момент по паре: max(leftAt | roundStartedAt) по обоим участникам пары; если нет — tournament.createdAt или now.
   * @param onlyTournamentIds если задан — обрабатывать только эти турниры (для вызова из getMyTournaments).
   */
  async backfillTournamentResultCompletedAt(
    onlyTournamentIds?: number[],
  ): Promise<{ updated: number }> {
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
    const progressByTidAndUser = new Map<
      number,
      Map<number, { leftAt: Date | null; roundStartedAt: Date | null }>
    >();
    for (const p of progressRows) {
      if (!progressByTidAndUser.has(p.tournamentId))
        progressByTidAndUser.set(p.tournamentId, new Map());
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
      const fallbackDate =
        t.createdAt instanceof Date
          ? t.createdAt
          : (toDate((t as any).createdAt) ?? now);
      let completedAt: Date = fallbackDate;
      const order = t.playerOrder;
      if (order?.length && order.indexOf(row.userId) >= 0) {
        const playerSlot = order.indexOf(row.userId);
        const opponentSlot = getOpponentSlot(playerSlot, order.length);
        const opponentId =
          opponentSlot != null ? (order[opponentSlot] ?? -1) : -1;
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
    if (updated > 0)
      this.logger.log(
        `backfillTournamentResultCompletedAt: updated ${updated} rows`,
      );
    return { updated };
  }

  async backfillResolvedHeadToHeadResults(): Promise<{
    updatedResults: number;
    updatedStatuses: number;
  }> {
    const repaired =
      await this.reactivateStructurallyUnfinishedFinishedTournaments();
    return {
      updatedResults: repaired.deletedResultRows,
      updatedStatuses: repaired.reactivatedTournamentIds.length,
    };
  }

  async backfillTimeoutRoundResolutions(
    onlyTournamentIds?: number[],
  ): Promise<{ inserted: number }> {
    const where: any = {};
    if (onlyTournamentIds?.length) {
      where.id = In(onlyTournamentIds);
    }

    const tournaments = await this.tournamentRepository.find({
      where,
      relations: ['players'],
    });
    if (tournaments.length === 0) return { inserted: 0 };

    const tournamentIds = tournaments.map((t) => t.id);
    const allProgress = await this.tournamentProgressRepository.find({
      where: { tournamentId: In(tournamentIds) },
    });
    const timeoutResolutionRows =
      await this.tournamentRoundResolutionRepository.find({
        where: {
          tournamentId: In(tournamentIds),
          reason: TournamentResolutionReason.TIMEOUT,
        },
      });
    const timeoutResolutionMap = this.buildLatestResolutionMap(
      timeoutResolutionRows,
    );
    const progressByTournament = new Map<
      number,
      Map<number, TournamentProgress>
    >();
    for (const progress of allProgress) {
      if (!progressByTournament.has(progress.tournamentId)) {
        progressByTournament.set(progress.tournamentId, new Map());
      }
      progressByTournament
        .get(progress.tournamentId)!
        .set(progress.userId, progress);
    }

    let inserted = 0;
    const rememberResolution = (row: TournamentRoundResolution) => {
      timeoutResolutionMap.set(
        this.getResolutionMapKey(row.tournamentId, row.stage, row.pairIndex),
        row,
      );
      inserted++;
    };

    const getPairWinnerProgress = (
      tournament: Tournament,
      pairIndex: 0 | 1,
      progressByUser: Map<number, TournamentProgress>,
    ): TournamentProgress | null => {
      const pairResolution = this.getLatestResolutionFromMap(
        timeoutResolutionMap,
        tournament.id,
        TournamentResolutionStage.SEMI,
        pairIndex,
      );
      if (pairResolution?.winnerUserId) {
        return progressByUser.get(pairResolution.winnerUserId) ?? null;
      }
      if (pairResolution?.outcome === TournamentResolutionOutcome.BOTH_LOST) {
        return null;
      }
      const [slotAUserId, slotBUserId] = this.getSemiPairUserIds(
        tournament.playerOrder ?? [],
        pairIndex,
      );
      return this.findSemiWinner(
        progressByUser.get(slotAUserId) ?? null,
        progressByUser.get(slotBUserId) ?? null,
        true,
      );
    };

    for (const tournament of tournaments) {
      this.sortPlayersByOrder(tournament);
      const order = tournament.playerOrder ?? [];
      const realCount = order.filter((id) => id > 0).length;
      if (realCount < 2) continue;

      const progressByUser =
        progressByTournament.get(tournament.id) ??
        new Map<number, TournamentProgress>();

      for (const pairIndex of [0, 1] as const) {
        if (pairIndex === 1 && order.length < 4) continue;
        if (
          this.getLatestResolutionFromMap(
            timeoutResolutionMap,
            tournament.id,
            TournamentResolutionStage.SEMI,
            pairIndex,
          )
        ) {
          continue;
        }

        const [slotAUserId, slotBUserId] = this.getSemiPairUserIds(
          order,
          pairIndex,
        );
        if (!(slotAUserId > 0) || !(slotBUserId > 0)) continue;

        const p1 = progressByUser.get(slotAUserId) ?? null;
        const p2 = progressByUser.get(slotBUserId) ?? null;
        const deadlinePassed = this.isSemiPairDeadlinePassed(p1, p2);
        const timeoutOutcome = this.getSemiPairTimeoutOutcome(
          p1,
          p2,
          deadlinePassed,
        );
        if (timeoutOutcome === 'none') continue;

        const row = await this.upsertTimeoutResolution({
          tournamentId: tournament.id,
          stage: TournamentResolutionStage.SEMI,
          pairIndex,
          roundNumber: this.getSemiCurrentRoundNumber(p1, p2),
          slotAUserId,
          slotBUserId,
          outcome:
            timeoutOutcome === 'p1_wins'
              ? TournamentResolutionOutcome.SLOT_A_WINS
              : timeoutOutcome === 'p2_wins'
                ? TournamentResolutionOutcome.SLOT_B_WINS
                : TournamentResolutionOutcome.BOTH_LOST,
          winnerUserId:
            timeoutOutcome === 'p1_wins'
              ? slotAUserId
              : timeoutOutcome === 'p2_wins'
                ? slotBUserId
                : null,
          loserUserId:
            timeoutOutcome === 'p1_wins'
              ? slotBUserId
              : timeoutOutcome === 'p2_wins'
                ? slotAUserId
                : null,
          sharedRoundStartedAt: this.getSharedRoundStartForPair(p1, p2),
          deadlineAt: this.getRoundDeadlineDate(
            this.getSharedRoundStartForPair(p1, p2),
          ),
          source: TournamentResolutionSource.BACKFILL,
        });
        rememberResolution(row);
      }

      if (realCount < 4) continue;
      if (
        this.getLatestResolutionFromMap(
          timeoutResolutionMap,
          tournament.id,
          TournamentResolutionStage.FINAL,
          0,
        )
      ) {
        continue;
      }

      const finalist1 = getPairWinnerProgress(tournament, 0, progressByUser);
      const finalist2 = getPairWinnerProgress(tournament, 1, progressByUser);
      if (!finalist1 || !finalist2) continue;

      const finalSharedStart = this.getSharedRoundStartForPair(
        finalist1,
        finalist2,
      );
      if (!this.isRoundDeadlinePassed(finalSharedStart)) continue;

      const finalTargets = this.getFinalCurrentRoundTargets(
        finalist1,
        finalist2,
      );
      const f1Finished =
        (finalist1.questionsAnsweredCount ?? 0) >= finalTargets.p1Target;
      const f2Finished =
        (finalist2.questionsAnsweredCount ?? 0) >= finalTargets.p2Target;
      if (f1Finished && f2Finished) continue;

      let outcome: TournamentResolutionOutcome | null = null;
      let winnerUserId: number | null = null;
      let loserUserId: number | null = null;

      if (f1Finished && !f2Finished) {
        const f1Correct = this.getFinalStageCorrectTotal(finalist1);
        if (f1Correct > 0) {
          outcome = TournamentResolutionOutcome.SLOT_A_WINS;
          winnerUserId = finalist1.userId;
          loserUserId = finalist2.userId;
        } else {
          outcome = TournamentResolutionOutcome.BOTH_LOST;
        }
      } else if (f2Finished && !f1Finished) {
        const f2Correct = this.getFinalStageCorrectTotal(finalist2);
        if (f2Correct > 0) {
          outcome = TournamentResolutionOutcome.SLOT_B_WINS;
          winnerUserId = finalist2.userId;
          loserUserId = finalist1.userId;
        } else {
          outcome = TournamentResolutionOutcome.BOTH_LOST;
        }
      } else if (!f1Finished && !f2Finished) {
        outcome = TournamentResolutionOutcome.BOTH_LOST;
      }

      if (!outcome) continue;

      const row = await this.upsertTimeoutResolution({
        tournamentId: tournament.id,
        stage: TournamentResolutionStage.FINAL,
        pairIndex: 0,
        roundNumber: this.getFinalCurrentRoundNumber(finalist1, finalist2),
        slotAUserId: finalist1.userId,
        slotBUserId: finalist2.userId,
        outcome,
        winnerUserId,
        loserUserId,
        sharedRoundStartedAt: finalSharedStart,
        deadlineAt: this.getRoundDeadlineDate(finalSharedStart),
        source: TournamentResolutionSource.BACKFILL,
      });
      rememberResolution(row);
    }

    if (inserted > 0) {
      this.logger.log(
        `backfillTimeoutRoundResolutions: inserted ${inserted} rows`,
      );
    }
    return { inserted };
  }

  async repairTournamentConsistency(): Promise<{
    backfilledTimeoutResolutionRows: number;
    activatedWaitingTournamentIds: number[];
    reactivatedFinishedTournamentIds: number[];
    deletedResultRows: number;
    convertedLegacyMoneyTournamentIds: number[];
  }> {
    const timeoutBackfill = await this.backfillTimeoutRoundResolutions();
    const waitingResult = await this.backfillWaitingTournamentsToActive();
    const finishedResult =
      await this.reactivateStructurallyUnfinishedFinishedTournaments();
    const legacyMoneyResult =
      await this.convertLegacyMoneyTournamentsWithoutLeagueToTraining();
    return {
      backfilledTimeoutResolutionRows: timeoutBackfill.inserted,
      activatedWaitingTournamentIds: waitingResult.updatedTournamentIds,
      reactivatedFinishedTournamentIds: finishedResult.reactivatedTournamentIds,
      deletedResultRows: finishedResult.deletedResultRows,
      convertedLegacyMoneyTournamentIds:
        legacyMoneyResult.convertedTournamentIds,
    };
  }

  async backfillResolvedBracketResults(): Promise<{
    updatedResults: number;
    updatedStatuses: number;
  }> {
    const tournaments = await this.tournamentRepository.find({
      where: { status: TournamentStatus.FINISHED },
      relations: ['players'],
    });

    let updatedResults = 0;
    let updatedStatuses = 0;
    const touchedTournamentIds = new Set<number>();

    const upsertResult = async (
      tournamentId: number,
      userId: number,
      passed: boolean,
      now: Date,
    ): Promise<void> => {
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
      const progressByUser = new Map(
        progressList.map((progress) => [progress.userId, progress]),
      );

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
        true,
      );
      const semi2BothLost = this.didSemiPairBothLoseByTimeout(
        progressByUser.get(order[2]) ?? null,
        progressByUser.get(order[3]) ?? null,
        true,
      );

      let winnerId: number | null = null;
      if (semiWinner1 && semiWinner2) {
        const finalState = this.getFinalHeadToHeadState(
          semiWinner1,
          semiWinner2,
          true,
        );
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
      await this.backfillTournamentResultCompletedAt([
        ...touchedTournamentIds,
      ]).catch(() => {});
      this.logger.log(
        `backfillResolvedBracketResults: updated ${updatedResults} result rows and ${updatedStatuses} tournament statuses`,
      );
    }

    return { updatedResults, updatedStatuses };
  }

  async reactivateStructurallyUnfinishedFinishedTournaments(): Promise<{
    reactivatedTournamentIds: number[];
    deletedResultRows: number;
  }> {
    const finishedTournaments = await this.tournamentRepository.find({
      where: { status: TournamentStatus.FINISHED },
      relations: ['players'],
      order: { id: 'ASC' },
    });

    const affectedTournaments = finishedTournaments.filter(
      (tournament) => !this.isTournamentStructurallyFinishable(tournament),
    );
    const affectedIds = affectedTournaments.map((tournament) => tournament.id);
    if (affectedIds.length === 0) {
      return {
        reactivatedTournamentIds: [],
        deletedResultRows: 0,
      };
    }

    const moneyIds = affectedTournaments
      .filter((tournament) => tournament.gameType === 'money')
      .map((tournament) => tournament.id);
    if (moneyIds.length > 0) {
      throw new BadRequestException(
        `Cannot auto-reactivate underfilled finished money tournaments without explicit finance rollback: ${moneyIds.join(', ')}`,
      );
    }

    const deleteResult = await this.tournamentResultRepository.delete({
      tournamentId: In(affectedIds),
    });
    await this.tournamentRepository.update(
      { id: In(affectedIds) },
      { status: TournamentStatus.ACTIVE },
    );

    this.logger.log(
      `reactivateStructurallyUnfinishedFinishedTournaments: reactivated ${affectedIds.length} tournaments and deleted ${deleteResult.affected ?? 0} stale result rows`,
    );
    return {
      reactivatedTournamentIds: affectedIds,
      deletedResultRows: deleteResult.affected ?? 0,
    };
  }

  async convertLegacyMoneyTournamentsWithoutLeagueToTraining(): Promise<{
    convertedTournamentIds: number[];
  }> {
    const legacyMoneyTournaments = await this.tournamentRepository.find({
      where: {
        gameType: 'money',
        leagueAmount: IsNull(),
      },
      relations: ['players'],
      order: { id: 'ASC' },
    });

    if (legacyMoneyTournaments.length === 0) {
      return { convertedTournamentIds: [] };
    }

    const tournamentIds = legacyMoneyTournaments.map((tournament) => tournament.id);
    const escrowRows = await this.tournamentEscrowRepository.find({
      where: { tournamentId: In(tournamentIds) },
      select: ['tournamentId'],
    });
    const transactionRows = await this.transactionRepository.find({
      where: { tournamentId: In(tournamentIds) },
      select: ['tournamentId'],
    });

    const escrowTournamentIds = new Set(
      escrowRows.map((row) => Number(row.tournamentId)).filter((id) => id > 0),
    );
    const transactionTournamentIds = new Set(
      transactionRows
        .map((row) => Number(row.tournamentId))
        .filter((id) => id > 0),
    );

    const convertibleIds = legacyMoneyTournaments
      .filter((tournament) => {
        if (escrowTournamentIds.has(tournament.id)) return false;
        if (transactionTournamentIds.has(tournament.id)) return false;
        return true;
      })
      .map((tournament) => tournament.id);

    if (convertibleIds.length === 0) {
      return { convertedTournamentIds: [] };
    }

    await this.tournamentRepository.update(
      { id: In(convertibleIds) },
      { gameType: 'training' },
    );

    this.logger.log(
      `convertLegacyMoneyTournamentsWithoutLeagueToTraining: converted ${convertibleIds.length} tournaments (${convertibleIds.join(', ')})`,
    );

    return { convertedTournamentIds: convertibleIds };
  }

  private getRoundDeadline(from: Date): string {
    return new Date(
      from.getTime() + ROUND_DEADLINE_HOURS * 3600000,
    ).toISOString();
  }

  private resolveStageTotals(
    myAnswered: number,
    myBaseCorrect: number,
    myExtraRounds: number[] | null | undefined,
    oppAnswered: number,
    oppBaseCorrect: number,
    oppExtraRounds: number[] | null | undefined,
    allowUnevenResolved = false,
  ): {
    result: 'won' | 'lost' | 'tie' | 'incomplete';
    tiebreakerRound?: number;
    myTotal: number;
    oppTotal: number;
    roundsUsed: number;
  } {
    if (
      myAnswered < this.QUESTIONS_PER_ROUND ||
      oppAnswered < this.QUESTIONS_PER_ROUND
    ) {
      return {
        result: 'incomplete',
        myTotal: myBaseCorrect,
        oppTotal: oppBaseCorrect,
        roundsUsed: 0,
      };
    }

    const myRounds = myExtraRounds ?? [];
    const oppRounds = oppExtraRounds ?? [];
    let myTotal = myBaseCorrect;
    let oppTotal = oppBaseCorrect;
    if (myTotal > oppTotal)
      return { result: 'won', myTotal, oppTotal, roundsUsed: 0 };
    if (myTotal < oppTotal)
      return { result: 'lost', myTotal, oppTotal, roundsUsed: 0 };

    for (let r = 1; r <= 50; r++) {
      const roundEnd = this.QUESTIONS_PER_ROUND + r * this.TIEBREAKER_QUESTIONS;
      const myHasRound = myAnswered >= roundEnd || myRounds.length >= r;
      const oppHasRound = oppAnswered >= roundEnd || oppRounds.length >= r;

      if (!myHasRound && !oppHasRound) {
        return {
          result: 'tie',
          tiebreakerRound: r,
          myTotal,
          oppTotal,
          roundsUsed: r - 1,
        };
      }

      if (!allowUnevenResolved && (!myHasRound || !oppHasRound)) {
        return {
          result: 'tie',
          tiebreakerRound: r,
          myTotal,
          oppTotal,
          roundsUsed: r - 1,
        };
      }

      myTotal += myHasRound ? (myRounds[r - 1] ?? 0) : 0;
      oppTotal += oppHasRound ? (oppRounds[r - 1] ?? 0) : 0;

      if (myTotal > oppTotal)
        return { result: 'won', myTotal, oppTotal, roundsUsed: r };
      if (myTotal < oppTotal)
        return { result: 'lost', myTotal, oppTotal, roundsUsed: r };
    }

    return {
      result: 'tie',
      tiebreakerRound: 50,
      myTotal,
      oppTotal,
      roundsUsed: 50,
    };
  }

  private compareStageTotals(
    myAnswered: number,
    myBaseCorrect: number,
    myExtraRounds: number[] | null | undefined,
    oppAnswered: number,
    oppBaseCorrect: number,
    oppExtraRounds: number[] | null | undefined,
    allowUnevenResolved = false,
  ): {
    result: 'won' | 'lost' | 'tie' | 'incomplete';
    tiebreakerRound?: number;
  } {
    const resolved = this.resolveStageTotals(
      myAnswered,
      myBaseCorrect,
      myExtraRounds,
      oppAnswered,
      oppBaseCorrect,
      oppExtraRounds,
      allowUnevenResolved,
    );
    return {
      result: resolved.result,
      tiebreakerRound: resolved.tiebreakerRound,
    };
  }

  private getSemiHeadToHeadState(
    myQ: number,
    mySemi: number | null | undefined,
    myTB: number[] | null | undefined,
    oppQ: number,
    oppSemi: number | null | undefined,
    oppTB: number[] | null | undefined,
    allowUnevenResolved = false,
  ): {
    result: 'won' | 'lost' | 'tie' | 'incomplete';
    tiebreakerRound?: number;
  } {
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

  private getFinalStageBaseCorrect(
    prog: TournamentProgress | null | undefined,
  ): number {
    if (!prog) return 0;
    const semiTBSum = (prog.tiebreakerRoundsCorrect ?? []).reduce(
      (a: number, b: number) => a + b,
      0,
    );
    const finalTBSum = (prog.finalTiebreakerRoundsCorrect ?? []).reduce(
      (a: number, b: number) => a + b,
      0,
    );
    return Math.max(
      0,
      (prog.correctAnswersCount ?? 0) -
        (prog.semiFinalCorrectCount ?? 0) -
        semiTBSum -
        finalTBSum,
    );
  }

  private getFinalStageCorrectTotal(
    prog: TournamentProgress | null | undefined,
  ): number {
    if (!prog) return 0;
    return (
      this.getFinalStageBaseCorrect(prog) +
      (prog.finalTiebreakerRoundsCorrect ?? []).reduce(
        (a: number, b: number) => a + b,
        0,
      )
    );
  }

  private getFinalHeadToHeadState(
    myProg: TournamentProgress | null | undefined,
    oppProg: TournamentProgress | null | undefined,
    allowUnevenResolved = false,
  ): {
    result: 'won' | 'lost' | 'tie' | 'incomplete';
    tiebreakerRound?: number;
  } {
    if (!myProg || !oppProg) return { result: 'incomplete' };

    const mySemiTotal =
      this.QUESTIONS_PER_ROUND +
      (myProg.tiebreakerRoundsCorrect?.length ?? 0) * this.TIEBREAKER_QUESTIONS;
    const oppSemiTotal =
      this.QUESTIONS_PER_ROUND +
      (oppProg.tiebreakerRoundsCorrect?.length ?? 0) *
        this.TIEBREAKER_QUESTIONS;
    const myAnswered = Math.max(
      0,
      (myProg.questionsAnsweredCount ?? 0) - mySemiTotal,
    );
    const oppAnswered = Math.max(
      0,
      (oppProg.questionsAnsweredCount ?? 0) - oppSemiTotal,
    );
    const myFinalTotal = this.getFinalStageCorrectTotal(myProg);
    const oppFinalTotal = this.getFinalStageCorrectTotal(oppProg);

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
    return (
      now.getTime() - roundStartedAt.getTime() > ROUND_DEADLINE_HOURS * 3600000
    );
  }

  private getSharedRoundStartForPair(
    p1: Pick<TournamentProgress, 'roundStartedAt'> | null | undefined,
    p2: Pick<TournamentProgress, 'roundStartedAt'> | null | undefined,
  ): Date | null {
    if (!p1 || !p2) return null;
    const s1 = p1.roundStartedAt;
    const s2 = p2.roundStartedAt;
    if (!(s1 instanceof Date) || !(s2 instanceof Date)) return null;
    return new Date(Math.max(s1.getTime(), s2.getTime()));
  }

  private isSemiPairDeadlinePassed(
    p1: Pick<TournamentProgress, 'roundStartedAt'> | null | undefined,
    p2: Pick<TournamentProgress, 'roundStartedAt'> | null | undefined,
    now: Date = new Date(),
  ): boolean {
    const sharedStart = this.getSharedRoundStartForPair(p1, p2);
    return this.isRoundDeadlinePassed(sharedStart, now);
  }

  private getSoloFinalOutcome(
    prog: TournamentProgress | null | undefined,
    deadlinePassed = false,
  ): {
    result: 'won' | 'lost' | 'incomplete';
    finalAnswered: number;
    finalCorrect: number;
  } {
    if (!prog)
      return { result: 'incomplete', finalAnswered: 0, finalCorrect: 0 };
    const semiTotal = this.getSemiPhaseQuestionCount(prog);
    const finalAnswered = Math.max(
      0,
      (prog.questionsAnsweredCount ?? 0) - semiTotal,
    );
    const finalCorrect = this.getFinalStageCorrectTotal(prog);
    if (finalAnswered >= this.QUESTIONS_PER_ROUND) {
      return {
        result: finalCorrect > 0 ? 'won' : 'lost',
        finalAnswered,
        finalCorrect,
      };
    }
    if (deadlinePassed) {
      return {
        result: finalCorrect > 0 ? 'won' : 'lost',
        finalAnswered,
        finalCorrect,
      };
    }
    return { result: 'incomplete', finalAnswered, finalCorrect };
  }

  private getSoloFinalistByOppositeSemiTimeout(
    tournament: Tournament,
    allProgress: TournamentProgress[],
    resolutionMap?: Map<string, TournamentRoundResolution>,
  ): TournamentProgress | null {
    this.sortPlayersByOrder(tournament);
    const order = tournament.playerOrder ?? [];
    if (order.filter((id) => id > 0).length < 4) return null;

    const progressByUser = new Map(
      allProgress.map((progress) => [progress.userId, progress]),
    );

    const getPairResolvedState = (
      pairIndex: 0 | 1,
    ): { winner: TournamentProgress | null; bothLost: boolean } => {
      const [slotAUserId, slotBUserId] = this.getSemiPairUserIds(
        order,
        pairIndex,
      );
      const pairResolution = resolutionMap
        ? this.getLatestResolutionFromMap(
            resolutionMap,
            tournament.id,
            TournamentResolutionStage.SEMI,
            pairIndex,
          )
        : null;
      if (pairResolution) {
        if (pairResolution.outcome === TournamentResolutionOutcome.BOTH_LOST) {
          return { winner: null, bothLost: true };
        }
        const winnerId = pairResolution.winnerUserId;
        return {
          winner: winnerId ? (progressByUser.get(winnerId) ?? null) : null,
          bothLost: false,
        };
      }

      const p1 = progressByUser.get(slotAUserId ?? -1) ?? null;
      const p2 = progressByUser.get(slotBUserId ?? -1) ?? null;
      return {
        winner: this.findSemiWinner(p1, p2, true),
        bothLost: this.didSemiPairBothLoseByTimeout(
          p1,
          p2,
          this.isSemiPairDeadlinePassed(p1, p2),
        ),
      };
    };

    const pair1 = getPairResolvedState(0);
    const pair2 = getPairResolvedState(1);

    if (pair1.winner && !pair2.winner && pair2.bothLost) return pair1.winner;
    if (!pair1.winner && pair2.winner && pair1.bothLost) return pair2.winner;
    return null;
  }

  private getSemiPhaseQuestionCount(
    prog:
      | Pick<TournamentProgress, 'tiebreakerRoundsCorrect'>
      | null
      | undefined,
  ): number {
    return (
      this.QUESTIONS_PER_ROUND +
      (prog?.tiebreakerRoundsCorrect?.length ?? 0) * this.TIEBREAKER_QUESTIONS
    );
  }

  private getSemiCurrentRoundTargets(
    p1:
      | Pick<
          TournamentProgress,
          | 'questionsAnsweredCount'
          | 'semiFinalCorrectCount'
          | 'tiebreakerRoundsCorrect'
        >
      | null
      | undefined,
    p2:
      | Pick<
          TournamentProgress,
          | 'questionsAnsweredCount'
          | 'semiFinalCorrectCount'
          | 'tiebreakerRoundsCorrect'
        >
      | null
      | undefined,
  ): { p1Target: number; p2Target: number } {
    const semiState = this.getSemiHeadToHeadState(
      p1?.questionsAnsweredCount ?? 0,
      p1?.semiFinalCorrectCount,
      p1?.tiebreakerRoundsCorrect,
      p2?.questionsAnsweredCount ?? 0,
      p2?.semiFinalCorrectCount,
      p2?.tiebreakerRoundsCorrect,
    );
    const extraRounds =
      semiState.result === 'tie' ? (semiState.tiebreakerRound ?? 1) : 0;
    const target =
      this.QUESTIONS_PER_ROUND + extraRounds * this.TIEBREAKER_QUESTIONS;
    return { p1Target: target, p2Target: target };
  }

  private getSemiPairTimeoutOutcome(
    p1:
      | Pick<
          TournamentProgress,
          | 'questionsAnsweredCount'
          | 'semiFinalCorrectCount'
          | 'tiebreakerRoundsCorrect'
        >
      | null
      | undefined,
    p2:
      | Pick<
          TournamentProgress,
          | 'questionsAnsweredCount'
          | 'semiFinalCorrectCount'
          | 'tiebreakerRoundsCorrect'
        >
      | null
      | undefined,
    deadlinePassed = false,
  ): 'none' | 'p1_wins' | 'p2_wins' | 'both_lost' {
    if (!deadlinePassed || !p1 || !p2) return 'none';
    const semiTargets = this.getSemiCurrentRoundTargets(p1, p2);
    const p1Finished = (p1.questionsAnsweredCount ?? 0) >= semiTargets.p1Target;
    const p2Finished = (p2.questionsAnsweredCount ?? 0) >= semiTargets.p2Target;
    if (p1Finished && !p2Finished) return 'p1_wins';
    if (!p1Finished && p2Finished) return 'p2_wins';
    if (!p1Finished && !p2Finished) return 'both_lost';
    return 'none';
  }

  private getFinalCurrentRoundTargets(
    p1: TournamentProgress | null | undefined,
    p2: TournamentProgress | null | undefined,
  ): { p1Target: number; p2Target: number } {
    const p1SemiTotal = this.getSemiPhaseQuestionCount(p1);
    const p2SemiTotal = this.getSemiPhaseQuestionCount(p2);
    const finalState = this.getFinalHeadToHeadState(p1, p2);
    const extraRounds =
      finalState.result === 'tie' ? (finalState.tiebreakerRound ?? 1) : 0;
    return {
      p1Target:
        p1SemiTotal +
        this.QUESTIONS_PER_ROUND +
        extraRounds * this.TIEBREAKER_QUESTIONS,
      p2Target:
        p2SemiTotal +
        this.QUESTIONS_PER_ROUND +
        extraRounds * this.TIEBREAKER_QUESTIONS,
    };
  }

  private getResolvedSemiPairState(
    tournament: Tournament,
    pairIndex: 0 | 1,
    progressByUser: Map<number, TournamentProgress>,
    resolutionMap?: Map<string, TournamentRoundResolution>,
    now: Date = new Date(),
    allowDerivedTimeout = false,
  ): {
    hasPlayablePair: boolean;
    winnerId: number | null;
    winner: TournamentProgress | null;
    bothLost: boolean;
  } {
    const [slotAUserId, slotBUserId] = this.getSemiPairUserIds(
      tournament.playerOrder ?? [],
      pairIndex,
    );
    const hasPlayablePair = slotAUserId > 0 && slotBUserId > 0;
    if (!hasPlayablePair) {
      return {
        hasPlayablePair: false,
        winnerId: null,
        winner: null,
        bothLost: false,
      };
    }

    const pairResolution = resolutionMap
      ? this.getLatestResolutionFromMap(
          resolutionMap,
          tournament.id,
          TournamentResolutionStage.SEMI,
          pairIndex,
        )
      : null;
    if (pairResolution) {
      if (pairResolution.outcome === TournamentResolutionOutcome.BOTH_LOST) {
        return {
          hasPlayablePair: true,
          winnerId: null,
          winner: null,
          bothLost: true,
        };
      }
      const winnerId = pairResolution.winnerUserId ?? null;
      return {
        hasPlayablePair: true,
        winnerId,
        winner: winnerId ? (progressByUser.get(winnerId) ?? null) : null,
        bothLost: false,
      };
    }

    const p1 = progressByUser.get(slotAUserId) ?? null;
    const p2 = progressByUser.get(slotBUserId) ?? null;
    const winner = this.findSemiWinner(p1, p2);
    if (winner) {
      return {
        hasPlayablePair: true,
        winnerId: winner.userId,
        winner,
        bothLost: false,
      };
    }

    if (allowDerivedTimeout) {
      const timeoutOutcome = this.getSemiPairTimeoutOutcome(
        p1,
        p2,
        this.isSemiPairDeadlinePassed(p1, p2, now),
      );
      if (timeoutOutcome === 'p1_wins') {
        return {
          hasPlayablePair: true,
          winnerId: slotAUserId,
          winner: p1,
          bothLost: false,
        };
      }
      if (timeoutOutcome === 'p2_wins') {
        return {
          hasPlayablePair: true,
          winnerId: slotBUserId,
          winner: p2,
          bothLost: false,
        };
      }
      if (timeoutOutcome === 'both_lost') {
        return {
          hasPlayablePair: true,
          winnerId: null,
          winner: null,
          bothLost: true,
        };
      }
    }

    return {
      hasPlayablePair: true,
      winnerId: null,
      winner: null,
      bothLost: false,
    };
  }

  private resolveTournamentOutcome(
    tournament: Tournament,
    allProgress: TournamentProgress[],
    resolutionMap?: Map<string, TournamentRoundResolution>,
    now: Date = new Date(),
    allowDerivedTimeout = false,
  ): { finished: boolean; winnerId: number | null } {
    this.sortPlayersByOrder(tournament);
    if (!this.isTournamentStructurallyFinishable(tournament)) {
      return { finished: false, winnerId: null };
    }

    const progressByUser = new Map(
      allProgress.map((progress) => [progress.userId, progress]),
    );
    const semi1 = this.getResolvedSemiPairState(
      tournament,
      0,
      progressByUser,
      resolutionMap,
      now,
      allowDerivedTimeout,
    );
    const semi2 = this.getResolvedSemiPairState(
      tournament,
      1,
      progressByUser,
      resolutionMap,
      now,
      allowDerivedTimeout,
    );

    if (!semi1.hasPlayablePair || !semi2.hasPlayablePair) {
      return { finished: false, winnerId: null };
    }
    if (
      (!semi1.winner && !semi1.bothLost) ||
      (!semi2.winner && !semi2.bothLost)
    ) {
      return { finished: false, winnerId: null };
    }
    if (semi1.bothLost && semi2.bothLost) {
      return { finished: true, winnerId: null };
    }

    if (semi1.winner && semi2.winner) {
      const finalResolution = resolutionMap
        ? this.getLatestResolutionFromMap(
            resolutionMap,
            tournament.id,
            TournamentResolutionStage.FINAL,
            0,
          )
        : null;
      if (finalResolution) {
        if (finalResolution.outcome === TournamentResolutionOutcome.BOTH_LOST) {
          return { finished: true, winnerId: null };
        }
        if (finalResolution.winnerUserId && finalResolution.winnerUserId > 0) {
          return { finished: true, winnerId: finalResolution.winnerUserId };
        }
      }

      const finalState = this.getFinalHeadToHeadState(
        semi1.winner,
        semi2.winner,
      );
      if (finalState.result === 'won') {
        return { finished: true, winnerId: semi1.winner.userId };
      }
      if (finalState.result === 'lost') {
        return { finished: true, winnerId: semi2.winner.userId };
      }
      return { finished: false, winnerId: null };
    }

    const soloFinalist =
      semi1.winner && semi2.bothLost
        ? semi1.winner
        : semi2.winner && semi1.bothLost
          ? semi2.winner
          : null;
    if (!soloFinalist) {
      return { finished: false, winnerId: null };
    }

    const soloOutcome = this.getSoloFinalOutcome(
      soloFinalist,
      allowDerivedTimeout &&
        this.isRoundDeadlinePassed(soloFinalist.roundStartedAt ?? null, now),
    );
    if (soloOutcome.result === 'won') {
      return { finished: true, winnerId: soloFinalist.userId };
    }
    if (soloOutcome.result === 'lost') {
      return { finished: true, winnerId: null };
    }
    return { finished: false, winnerId: null };
  }

  private async upsertTournamentResultRow(
    tournamentId: number,
    userId: number,
    passed: boolean,
    completedAt: Date,
  ): Promise<void> {
    const passedValue = passed ? 1 : 0;
    let row = await this.tournamentResultRepository.findOne({
      where: { userId, tournamentId },
    });
    if (row) {
      row.passed = passedValue;
      if (!row.completedAt) row.completedAt = completedAt;
      await this.tournamentResultRepository.save(row);
      return;
    }

    row = this.tournamentResultRepository.create({
      userId,
      tournamentId,
      passed: passedValue,
      completedAt,
    });
    await this.tournamentResultRepository.save(row);
  }

  private async finalizeResolvedTournamentOutcome(
    tournament: Tournament,
    winnerId: number | null,
    completedAt: Date,
  ): Promise<void> {
    const participantIds = [
      ...new Set(
        (tournament.playerOrder ?? []).filter((id): id is number => id > 0),
      ),
    ];
    for (const userId of participantIds) {
      await this.upsertTournamentResultRow(
        tournament.id,
        userId,
        winnerId === userId,
        completedAt,
      );
    }

    if (tournament.status !== TournamentStatus.FINISHED) {
      await this.tournamentRepository.update(
        { id: tournament.id },
        { status: TournamentStatus.FINISHED },
      );
      tournament.status = TournamentStatus.FINISHED;
    }
    if (tournament.gameType === 'money') {
      await this.processTournamentEscrow(tournament.id);
    }
  }

  private async finalizeTournamentIfResolved(
    tournament: Tournament,
    allProgress: TournamentProgress[],
    resolutionMap?: Map<string, TournamentRoundResolution>,
    now: Date = new Date(),
    allowDerivedTimeout = false,
  ): Promise<{ finished: boolean; winnerId: number | null }> {
    const resolved = this.resolveTournamentOutcome(
      tournament,
      allProgress,
      resolutionMap,
      now,
      allowDerivedTimeout,
    );
    if (!resolved.finished) {
      return resolved;
    }
    await this.finalizeResolvedTournamentOutcome(
      tournament,
      resolved.winnerId,
      now,
    );
    return resolved;
  }

  private getSharedSemiTiebreakerStart(
    myProg: TournamentProgress | undefined | null,
    oppProg: TournamentProgress | undefined | null,
  ): Date | null {
    if (!myProg) return null;
    if (!oppProg) return null;
    if (
      !(myProg.roundStartedAt instanceof Date) ||
      !(oppProg.roundStartedAt instanceof Date)
    )
      return null;

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

    const maxStart = (
      ...progs: (TournamentProgress | undefined | null)[]
    ): Date | null => {
      const dates = progs
        .map((p) => p?.roundStartedAt)
        .filter((dt): dt is Date => dt instanceof Date);
      return dates.length > 0
        ? new Date(Math.max(...dates.map((d) => d.getTime())))
        : null;
    };

    if (semiState.result !== 'tie') {
      return maxStart(myProg, oppProg);
    }

    const roundEnd =
      this.QUESTIONS_PER_ROUND +
      (semiState.tiebreakerRound ?? 1) * this.TIEBREAKER_QUESTIONS;
    const activeRoundStarts = [myProg, oppProg]
      .filter((prog) => (prog.questionsAnsweredCount ?? 0) < roundEnd)
      .map((prog) => prog.roundStartedAt)
      .filter((dt): dt is Date => dt instanceof Date);

    if (activeRoundStarts.length > 0) {
      return new Date(Math.max(...activeRoundStarts.map((dt) => dt.getTime())));
    }

    return maxStart(myProg, oppProg);
  }

  private async syncSemiPairStartOnJoinWithManager(
    manager: EntityManager,
    tournamentId: number,
    playerOrder: number[] | null | undefined,
    playerSlot: number,
    joinedAt: Date,
    tournamentCreatedAt?: Date | null,
  ): Promise<void> {
    if (!playerOrder || playerSlot < 0 || playerSlot >= playerOrder.length)
      return;
    const opponentSlot = getOpponentSlot(playerSlot, playerOrder.length);
    if (opponentSlot == null) return;

    const joinedUserId = playerOrder[playerSlot] ?? -1;
    const opponentUserId = playerOrder[opponentSlot] ?? -1;
    if (joinedUserId <= 0 || opponentUserId <= 0) return;

    const progressRepository = manager.getRepository(TournamentProgress);
    const pairUserIds = [joinedUserId, opponentUserId];
    const existing = await progressRepository.find({
      where: { tournamentId, userId: In(pairUserIds) },
    });
    const progressByUserId = new Map(existing.map((row) => [row.userId, row]));
    const effectiveRoundStartedAt =
      tournamentCreatedAt instanceof Date &&
      !Number.isNaN(tournamentCreatedAt.getTime()) &&
      tournamentCreatedAt.getTime() > joinedAt.getTime()
        ? tournamentCreatedAt
        : joinedAt;

    for (const pairUserId of pairUserIds) {
      const existingProgress = progressByUserId.get(pairUserId);
      if (existingProgress) {
        const hasStartedCurrentRound =
          (existingProgress.questionsAnsweredCount ?? 0) > 0 ||
          (existingProgress.lockedAnswerCount ?? 0) > 0 ||
          existingProgress.leftAt instanceof Date;
        if (!hasStartedCurrentRound) {
          existingProgress.roundStartedAt = effectiveRoundStartedAt;
          await progressRepository.save(existingProgress);
        }
        continue;
      }

      const progress = progressRepository.create({
        userId: pairUserId,
        tournamentId,
        questionsAnsweredCount: 0,
        correctAnswersCount: 0,
        currentQuestionIndex: 0,
        lockedAnswerCount: 0,
        roundStartedAt: effectiveRoundStartedAt,
        leftAt: null,
        timeLeftSeconds: null,
      });
      await progressRepository.save(progress);
    }
  }

  private async syncSemiPairStartOnJoin(
    tournamentId: number,
    playerOrder: number[] | null | undefined,
    playerSlot: number,
    joinedAt: Date,
    tournamentCreatedAt?: Date | null,
  ): Promise<void> {
    await this.syncSemiPairStartOnJoinWithManager(
      this.tournamentProgressRepository.manager,
      tournamentId,
      playerOrder,
      playerSlot,
      joinedAt,
      tournamentCreatedAt,
    );
  }

  private getCurrentRoundSharedStart(
    tournament: Tournament,
    userId: number,
    myProg: TournamentProgress | undefined | null,
    allProgress: TournamentProgress[],
    resolutionMap?: Map<string, TournamentRoundResolution>,
  ): Date | null {
    if (!myProg) return null;

    this.sortPlayersByOrder(tournament);
    const playerSlot = tournament.playerOrder?.indexOf(userId) ?? -1;
    if (playerSlot < 0) return null;

    const inFinal = this.isPlayerInFinalPhase(
      myProg,
      allProgress,
      tournament,
      resolutionMap,
    );
    if (inFinal) {
      const oppositePairIndex: 0 | 1 = playerSlot < 2 ? 1 : 0;
      const progressByUser = new Map(
        allProgress.map((progress) => [progress.userId, progress]),
      );
      const oppositeSemiState = this.getResolvedSemiPairState(
        tournament,
        oppositePairIndex,
        progressByUser,
        resolutionMap,
      );
      const finalOppProg = oppositeSemiState.winner;
      if (
        finalOppProg &&
        this.isPlayerInFinalPhase(
          finalOppProg,
          allProgress,
          tournament,
          resolutionMap,
        )
      ) {
        const shared = this.getSharedSemiTiebreakerStart(myProg, finalOppProg);
        if (shared) return shared;
        // Соперник в финале уже ответил на все вопросы финала — у него таймера нет; у входящего (текущий игрок) берём его roundStartedAt, чтобы таймер загорелся у входящего.
        const oppSemiTotal =
          this.QUESTIONS_PER_ROUND +
          (finalOppProg.tiebreakerRoundsCorrect?.length ?? 0) *
            this.TIEBREAKER_QUESTIONS;
        if (
          myProg.roundStartedAt instanceof Date &&
          (finalOppProg.questionsAnsweredCount ?? 0) >=
            oppSemiTotal + this.QUESTIONS_PER_ROUND
        ) {
          return myProg.roundStartedAt;
        }
      }
      const soloFinalist = this.getSoloFinalistByOppositeSemiTimeout(
        tournament,
        allProgress,
        resolutionMap,
      );
      if (
        soloFinalist?.userId === userId &&
        myProg.roundStartedAt instanceof Date
      ) {
        return myProg.roundStartedAt;
      }
      return null;
    }

    const oppSlot = playerSlot % 2 === 0 ? playerSlot + 1 : playerSlot - 1;
    const oppId =
      oppSlot >= 0 &&
      tournament.playerOrder &&
      oppSlot < tournament.playerOrder.length
        ? tournament.playerOrder[oppSlot]
        : null;
    const oppProg =
      oppId != null && oppId > 0
        ? allProgress.find(
            (p) => p.tournamentId === tournament.id && p.userId === oppId,
          )
        : null;
    return this.getSharedSemiTiebreakerStart(myProg, oppProg);
  }

  private isPlayerInFinalPhase(
    myProg: TournamentProgress | undefined | null,
    allProgress: TournamentProgress[],
    tournament: Tournament | undefined,
    resolutionMap?: Map<string, TournamentRoundResolution>,
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
    const oppId =
      tournament.playerOrder &&
      oppSlot >= 0 &&
      oppSlot < tournament.playerOrder.length
        ? tournament.playerOrder[oppSlot]
        : null;

    const myTBLen = (myProg.tiebreakerRoundsCorrect ?? []).length;
    const mySemiTotal =
      this.QUESTIONS_PER_ROUND + myTBLen * this.TIEBREAKER_QUESTIONS;

    const timeoutResolution = resolutionMap
      ? this.getOwnSemiTimeoutResolutionFromMap(
          tournament,
          myProg.userId,
          resolutionMap,
        )
      : null;
    const timeoutOutcome = this.getTimeoutOutcomeForUser(
      timeoutResolution,
      myProg.userId,
    );
    if (timeoutOutcome === 'won') return true;
    if (timeoutOutcome === 'lost' || timeoutOutcome === 'both_lost')
      return false;

    if (oppId == null || oppId <= 0) return false;

    const oppProg = allProgress.find(
      (p) => p.tournamentId === myProg.tournamentId && p.userId === oppId,
    );
    if (!oppProg || oppProg.semiFinalCorrectCount == null) {
      return false;
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

  private async getLastActivityDate(
    tournamentId: number,
    fallback: Date,
  ): Promise<Date> {
    const progressList = await this.tournamentProgressRepository.find({
      where: { tournamentId },
    });
    const entries = await this.tournamentEntryRepository.find({
      where: { tournament: { id: tournamentId } } as any,
    });
    let latest = fallback;
    for (const p of progressList) {
      if (p.leftAt && p.leftAt > latest) latest = p.leftAt;
    }
    for (const e of entries) {
      if (e.joinedAt && e.joinedAt > latest) latest = e.joinedAt;
    }
    return latest;
  }

  private getTournamentPlayerCount(
    tournament: Pick<Tournament, 'playerOrder' | 'players'>,
  ): number {
    return this.getTournamentParticipantIds(tournament).length;
  }

  private getTournamentParticipantIds(
    tournament: Pick<Tournament, 'playerOrder' | 'players'>,
  ): number[] {
    const ids = [
      ...(tournament.playerOrder ?? []),
      ...(tournament.players?.map((player) => player.id) ?? []),
    ].filter((id): id is number => Number.isInteger(id) && id > 0);
    return [...new Set(ids)];
  }

  private isTournamentParticipant(
    tournament: Pick<Tournament, 'playerOrder' | 'players'>,
    userId: number,
  ): boolean {
    return this.getTournamentParticipantIds(tournament).includes(userId);
  }

  private isTournamentStructurallyFinishable(
    tournament: Pick<Tournament, 'playerOrder' | 'players'>,
  ): boolean {
    return isTournamentStructurallyFinishable(
      this.getTournamentPlayerCount(tournament),
    );
  }

  private async syncTournamentActiveStatusWithManager(
    manager: EntityManager,
    tournamentId: number,
  ): Promise<boolean> {
    const tournament = await manager.getRepository(Tournament).findOne({
      where: { id: tournamentId },
      relations: ['players'],
    });
    if (!tournament) return false;
    if (
      !shouldTournamentBeActive({
        status: tournament.status,
        playerCount: this.getTournamentPlayerCount(tournament),
        progressCount: await manager.getRepository(TournamentProgress).count({
          where: { tournamentId },
        }),
      })
    ) {
      return false;
    }
    await manager.getRepository(Tournament).update(
      { id: tournamentId },
      { status: TournamentStatus.ACTIVE },
    );
    return true;
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

  private async promoteWaitingTournamentsToActive(): Promise<number[]> {
    const waitingTournaments = await this.tournamentRepository.find({
      where: { status: TournamentStatus.WAITING },
      relations: ['players'],
      order: { id: 'ASC' },
    });
    const updatedTournamentIds: number[] = [];
    for (const tournament of waitingTournaments) {
      const progressCount = await this.tournamentProgressRepository.count({
        where: { tournamentId: tournament.id },
      });
      if (
        shouldTournamentBeActive({
          status: tournament.status,
          playerCount: this.getTournamentPlayerCount(tournament),
          progressCount,
        })
      ) {
        await this.tournamentRepository.update(
          { id: tournament.id },
          { status: TournamentStatus.ACTIVE },
        );
        updatedTournamentIds.push(tournament.id);
      }
    }
    return updatedTournamentIds;
  }

  /**
   * Поднимает все незавершённые waiting-турниры в active по новому правилу.
   */
  private async cancelUnfilledTournaments(): Promise<void> {
    await this.promoteWaitingTournamentsToActive();
  }

  async backfillWaitingTournamentsToActive(): Promise<{
    updatedTournamentIds: number[];
  }> {
    const updatedTournamentIds = await this.promoteWaitingTournamentsToActive();
    return { updatedTournamentIds };
  }

  /**
   * Проверяет per-round 24ч дедлайны: если игрок не ответил за 24ч — соперник побеждает.
   */
  private async closeTimedOutRounds(): Promise<void> {
    const activeTournaments = await this.tournamentRepository
      .createQueryBuilder('t')
      .where('t.status IN (:...statuses)', {
        statuses: [TournamentStatus.WAITING, TournamentStatus.ACTIVE],
      })
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
        const allProg = await this.tournamentProgressRepository.find({
          where: { tournamentId: tournament.id },
        });
        const timeoutResolutionMap =
          await this.getTournamentTimeoutResolutionMap(tournament.id);

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

        const rememberResolution = (row: TournamentRoundResolution) => {
          timeoutResolutionMap.set(
            this.getResolutionMapKey(
              row.tournamentId,
              row.stage,
              row.pairIndex,
            ),
            row,
          );
        };

        const semiOutcomes: Array<{
          winnerId: number | null;
          bothLost: boolean;
        }> = [
          { winnerId: null, bothLost: false },
          { winnerId: null, bothLost: false },
        ];

        for (const [pairIndex, pair] of (
          [
            [0, 1],
            [2, 3],
          ] as const
        ).entries()) {
          const id1 = pair[0] < order.length ? order[pair[0]] : -1;
          const id2 = pair[1] < order.length ? order[pair[1]] : -1;
          if (id1 <= 0 || id2 <= 0) continue;
          if (!sharedDeadlinePassed(id1, id2)) continue;

          const prog1 = allProg.find((p) => p.userId === id1) ?? null;
          const prog2 = allProg.find((p) => p.userId === id2) ?? null;
          const timeoutOutcome = this.getSemiPairTimeoutOutcome(
            prog1,
            prog2,
            true,
          );
          const sharedStart = this.getSharedRoundStartForPair(prog1, prog2);
          const deadlineAt = this.getRoundDeadlineDate(sharedStart);
          const roundNumber = this.getSemiCurrentRoundNumber(prog1, prog2);

          if (timeoutOutcome === 'p1_wins') {
            rememberResolution(
              await this.upsertTimeoutResolution({
                tournamentId: tournament.id,
                stage: TournamentResolutionStage.SEMI,
                pairIndex,
                roundNumber,
                slotAUserId: id1,
                slotBUserId: id2,
                outcome: TournamentResolutionOutcome.SLOT_A_WINS,
                winnerUserId: id1,
                loserUserId: id2,
                sharedRoundStartedAt: sharedStart,
                deadlineAt,
                source: TournamentResolutionSource.CRON,
              }),
            );
            this.logger.log(
              `[closeTimedOutRounds] T${tournament.id}: player ${id2} timed out, ${id1} wins`,
            );
            semiOutcomes[pairIndex] = { winnerId: id1, bothLost: false };
          } else if (timeoutOutcome === 'p2_wins') {
            rememberResolution(
              await this.upsertTimeoutResolution({
                tournamentId: tournament.id,
                stage: TournamentResolutionStage.SEMI,
                pairIndex,
                roundNumber,
                slotAUserId: id1,
                slotBUserId: id2,
                outcome: TournamentResolutionOutcome.SLOT_B_WINS,
                winnerUserId: id2,
                loserUserId: id1,
                sharedRoundStartedAt: sharedStart,
                deadlineAt,
                source: TournamentResolutionSource.CRON,
              }),
            );
            this.logger.log(
              `[closeTimedOutRounds] T${tournament.id}: player ${id1} timed out, ${id2} wins`,
            );
            semiOutcomes[pairIndex] = { winnerId: id2, bothLost: false };
          } else if (timeoutOutcome === 'both_lost') {
            rememberResolution(
              await this.upsertTimeoutResolution({
                tournamentId: tournament.id,
                stage: TournamentResolutionStage.SEMI,
                pairIndex,
                roundNumber,
                slotAUserId: id1,
                slotBUserId: id2,
                outcome: TournamentResolutionOutcome.BOTH_LOST,
                winnerUserId: null,
                loserUserId: null,
                sharedRoundStartedAt: sharedStart,
                deadlineAt,
                source: TournamentResolutionSource.CRON,
              }),
            );
            this.logger.log(
              `[closeTimedOutRounds] T${tournament.id}: both ${id1} and ${id2} timed out`,
            );
            semiOutcomes[pairIndex] = { winnerId: null, bothLost: true };
          }
        }

        const finalists: number[] = [];
        for (const prog of allProg) {
          if (
            this.isPlayerInFinalPhase(
              prog,
              allProg,
              tournament,
              timeoutResolutionMap,
            )
          ) {
            finalists.push(prog.userId);
          }
        }

        if (finalists.length === 1) {
          const soloFinalistId = finalists[0]!;
          const otherSemiBothLost = semiOutcomes.some(
            (outcome) => outcome.bothLost,
          );
          const winnerSemiResolved = semiOutcomes.some(
            (outcome) => outcome.winnerId === soloFinalistId,
          );
          if (otherSemiBothLost && winnerSemiResolved) {
            const soloProg =
              allProg.find((p) => p.userId === soloFinalistId) ?? null;
            const soloOutcome = this.getSoloFinalOutcome(
              soloProg,
              this.isRoundDeadlinePassed(soloProg?.roundStartedAt ?? null, now),
            );
            if (soloOutcome.result === 'won') {
              this.logger.log(
                `[closeTimedOutRounds] T${tournament.id}: solo finalist ${soloFinalistId} wins with ${soloOutcome.finalCorrect} correct`,
              );
            } else if (soloOutcome.result === 'lost') {
              this.logger.log(
                `[closeTimedOutRounds] T${tournament.id}: solo finalist ${soloFinalistId} loses (${soloOutcome.finalCorrect} correct, ${soloOutcome.finalAnswered}/10 answered)`,
              );
            }
          }
        } else if (finalists.length === 2) {
          const f1 = finalists[0],
            f2 = finalists[1];
          if (!sharedDeadlinePassed(f1, f2)) {
            /* wait */
          } else {
            const f1Prog = allProg.find((p) => p.userId === f1) ?? null;
            const f2Prog = allProg.find((p) => p.userId === f2) ?? null;
            const finalTargets = this.getFinalCurrentRoundTargets(
              f1Prog,
              f2Prog,
            );
            const f1Finished =
              (f1Prog?.questionsAnsweredCount ?? 0) >= finalTargets.p1Target;
            const f2Finished =
              (f2Prog?.questionsAnsweredCount ?? 0) >= finalTargets.p2Target;
            const finalSharedStart = this.getSharedRoundStartForPair(
              f1Prog,
              f2Prog,
            );
            const finalDeadlineAt = this.getRoundDeadlineDate(finalSharedStart);
            const finalRoundNumber = this.getFinalCurrentRoundNumber(
              f1Prog,
              f2Prog,
            );

            if (f1Finished && !f2Finished) {
              const f1c = this.getFinalStageCorrectTotal(f1Prog);
              if (f1c === 0) {
                rememberResolution(
                  await this.upsertTimeoutResolution({
                    tournamentId: tournament.id,
                    stage: TournamentResolutionStage.FINAL,
                    pairIndex: 0,
                    roundNumber: finalRoundNumber,
                    slotAUserId: f1,
                    slotBUserId: f2,
                    outcome: TournamentResolutionOutcome.BOTH_LOST,
                    winnerUserId: null,
                    loserUserId: null,
                    sharedRoundStartedAt: finalSharedStart,
                    deadlineAt: finalDeadlineAt,
                    source: TournamentResolutionSource.CRON,
                  }),
                );
                this.logger.log(
                  `[closeTimedOutRounds] T${tournament.id} final: ${f1} finished with 0 correct, ${f2} timed out → both lose`,
                );
              } else {
                rememberResolution(
                  await this.upsertTimeoutResolution({
                    tournamentId: tournament.id,
                    stage: TournamentResolutionStage.FINAL,
                    pairIndex: 0,
                    roundNumber: finalRoundNumber,
                    slotAUserId: f1,
                    slotBUserId: f2,
                    outcome: TournamentResolutionOutcome.SLOT_A_WINS,
                    winnerUserId: f1,
                    loserUserId: f2,
                    sharedRoundStartedAt: finalSharedStart,
                    deadlineAt: finalDeadlineAt,
                    source: TournamentResolutionSource.CRON,
                  }),
                );
                this.logger.log(
                  `[closeTimedOutRounds] T${tournament.id} final: ${f2} timed out, ${f1} wins (${f1c} correct)`,
                );
              }
            } else if (f2Finished && !f1Finished) {
              const f2c = this.getFinalStageCorrectTotal(f2Prog);
              if (f2c === 0) {
                rememberResolution(
                  await this.upsertTimeoutResolution({
                    tournamentId: tournament.id,
                    stage: TournamentResolutionStage.FINAL,
                    pairIndex: 0,
                    roundNumber: finalRoundNumber,
                    slotAUserId: f1,
                    slotBUserId: f2,
                    outcome: TournamentResolutionOutcome.BOTH_LOST,
                    winnerUserId: null,
                    loserUserId: null,
                    sharedRoundStartedAt: finalSharedStart,
                    deadlineAt: finalDeadlineAt,
                    source: TournamentResolutionSource.CRON,
                  }),
                );
                this.logger.log(
                  `[closeTimedOutRounds] T${tournament.id} final: ${f2} finished with 0 correct, ${f1} timed out → both lose`,
                );
              } else {
                rememberResolution(
                  await this.upsertTimeoutResolution({
                    tournamentId: tournament.id,
                    stage: TournamentResolutionStage.FINAL,
                    pairIndex: 0,
                    roundNumber: finalRoundNumber,
                    slotAUserId: f1,
                    slotBUserId: f2,
                    outcome: TournamentResolutionOutcome.SLOT_B_WINS,
                    winnerUserId: f2,
                    loserUserId: f1,
                    sharedRoundStartedAt: finalSharedStart,
                    deadlineAt: finalDeadlineAt,
                    source: TournamentResolutionSource.CRON,
                  }),
                );
                this.logger.log(
                  `[closeTimedOutRounds] T${tournament.id} final: ${f1} timed out, ${f2} wins (${f2c} correct)`,
                );
              }
            } else if (!f1Finished && !f2Finished) {
              rememberResolution(
                await this.upsertTimeoutResolution({
                  tournamentId: tournament.id,
                  stage: TournamentResolutionStage.FINAL,
                  pairIndex: 0,
                  roundNumber: finalRoundNumber,
                  slotAUserId: f1,
                  slotBUserId: f2,
                  outcome: TournamentResolutionOutcome.BOTH_LOST,
                  winnerUserId: null,
                  loserUserId: null,
                  sharedRoundStartedAt: finalSharedStart,
                  deadlineAt: finalDeadlineAt,
                  source: TournamentResolutionSource.CRON,
                }),
              );
              this.logger.log(
                `[closeTimedOutRounds] T${tournament.id} final: both finalists timed out`,
              );
            }
          }
        }

        const resolved = await this.finalizeTournamentIfResolved(
          tournament,
          allProg,
          timeoutResolutionMap,
          now,
          true,
        );
        if (resolved.finished) {
          this.logger.log(
            `[closeTimedOutRounds] T${tournament.id}: tournament finalized (${resolved.winnerId ? `winner ${resolved.winnerId}` : 'no winner'})`,
          );
        }
      } catch (err) {
        this.logger.error(
          `[closeTimedOutRounds] Error for tournament ${tournament.id}`,
          err,
        );
      }
    }
  }

  /** Находит все турниры за деньги с эскроу в статусе held и дедлайном в прошлом, обрабатывает их (выплата победителю или безвозвратное списание). */
  private async processAllExpiredEscrows(): Promise<void> {
    await this.tournamentEscrowRepository.query(
      "UPDATE tournament_escrow SET status = 'held' WHERE status = 'processing' AND \"createdAt\" < NOW() - INTERVAL '5 minutes'",
    );
    const held = await this.tournamentEscrowRepository.find({
      where: { status: 'held' },
    });
    const tournamentIds = [...new Set(held.map((e) => e.tournamentId))];
    for (const tid of tournamentIds) {
      try {
        const tournament = await this.tournamentRepository.findOne({
          where: { id: tid },
        });
        if (!tournament || tournament.gameType !== 'money') continue;
        if (tournament.status !== TournamentStatus.FINISHED) continue;
        await this.processTournamentEscrow(tid);
      } catch (err) {
        console.error('[processAllExpiredEscrows] tournament', tid, err);
      }
    }
  }

  /** Обрабатывает эскроу: выплата победителю или окончательное списание без возврата. */
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
        "UPDATE tournament_escrow SET status = 'held' WHERE \"tournamentId\" = $1 AND status = 'processing'",
        [tournamentId],
      );
      return;
    }

    const settlement = await this.getMoneyTournamentSettlementResolution(
      tournamentId,
    );
    if (settlement.settlementType === 'unresolved') {
      this.logger.warn(
        `[processTournamentEscrow] Skip unresolved settlement for tournament ${tournamentId} (participants=${settlement.participantCount})`,
      );
      await this.tournamentEscrowRepository.query(
        "UPDATE tournament_escrow SET status = 'held' WHERE \"tournamentId\" = $1 AND status = 'processing'",
        [tournamentId],
      );
      return;
    }

    const existingWinTransactions = await this.transactionRepository.find({
      where: { tournamentId, category: 'win' },
    });
    const leagueAmount = tournament.leagueAmount ?? 0;
    const prize = getLeaguePrize(leagueAmount);

    if (settlement.settlementType === 'paid_to_winner') {
      const winnerId = settlement.winnerId!;
      const winnerAlreadyPaid = existingWinTransactions.some(
        (tx) => tx.userId === winnerId,
      );
      if (prize > 0 && winnerId > 0 && !winnerAlreadyPaid) {
        await this.usersService.addToBalanceL(
          winnerId,
          prize,
          `Выигрыш за турнир, ${getLeagueName(leagueAmount)}, ID ${tournamentId}`,
          'win',
          tournamentId,
        );
        await this.usersService.distributeReferralRewards(
          winnerId,
          leagueAmount,
          tournamentId,
        );
      } else if (winnerAlreadyPaid) {
        this.logger.warn(
          `[processTournamentEscrow] Skip duplicate winner payout for tournament ${tournamentId}, user ${winnerId}`,
        );
      }
      await this.tournamentEscrowRepository.query(
        "UPDATE tournament_escrow SET status = 'paid_to_winner' WHERE \"tournamentId\" = $1 AND status = 'processing'",
        [tournamentId],
      );
    } else {
      await this.tournamentEscrowRepository.query(
        "UPDATE tournament_escrow SET status = 'forfeited' WHERE \"tournamentId\" = $1 AND status = 'processing'",
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
    return this.sanitizeUtf8ForDisplay(String(question ?? ''))
      .trim()
      .toLowerCase();
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
    const collectUnique = (
      rows: QuestionPoolItem[],
    ): { question: string; options: string[]; correctAnswer: number }[] => {
      const seen = new Set<string>(normalizedExcluded);
      const unique: {
        question: string;
        options: string[];
        correctAnswer: number;
      }[] = [];
      for (const r of rows) {
        const key = this.buildQuestionUniqueKey(r.question);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        unique.push({
          question: this.sanitizeUtf8ForDisplay(r.question),
          options: Array.isArray(r.options)
            ? r.options.map((o) => this.sanitizeUtf8ForDisplay(String(o)))
            : [],
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
      throw new BadRequestException(
        `Недостаточно уникальных вопросов для генерации турнира: нужно ${n}, найдено ${unique.length}.`,
      );
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

  private async pickQuestionsForFinal(
    tournamentId: number,
  ): Promise<Omit<Question, 'id' | 'tournament' | 'roundIndex'>[]> {
    const excludedKeys = await this.getTournamentQuestionKeySet(tournamentId);
    return this.pickFromDB(10, excludedKeys);
  }

  /** Тренировка: присоединиться к существующему турниру или создать новый (до 4 игроков, как money-режим, но без ставки). */
  async startTraining(userId: number): Promise<{
    tournamentId: number;
    gameStartedAt: string;
    deadline: string | null;
    questionsSemi1: {
      id: number;
      question: string;
      options: string[];
      correctAnswer: number;
    }[];
    questionsSemi2: {
      id: number;
      question: string;
      options: string[];
      correctAnswer: number;
    }[];
    questionsFinal: {
      id: number;
      question: string;
      options: string[];
      correctAnswer: number;
    }[];
    playerSlot: number;
    totalPlayers: number;
    semiIndex: number;
    isCreator: boolean;
  }> {
    return this.tournamentRepository.manager.transaction(async (manager) => {
      const tournamentRepository = manager.getRepository(Tournament);
      const questionRepository = manager.getRepository(Question);
      const tournamentEntryRepository = manager.getRepository(TournamentEntry);

      const user = await manager
        .createQueryBuilder(User, 'user')
        .setLock('pessimistic_write')
        .where('user.id = :userId', { userId })
        .getOne();
      if (!user) throw new NotFoundException('User not found');

      const reusableTournaments = await this.loadReusableTournamentPool(manager, {
        gameType: 'training',
        userId,
        lockRows: true,
      });
      const waitingTournament =
        this.pickReusableTournamentEntry(reusableTournaments)?.tournament ?? null;

      let tournament: Tournament;
      let playerSlot: number;
      let isCreator: boolean;
      const joinedAt = new Date();

      if (waitingTournament) {
        tournament = waitingTournament;
        this.sortPlayersByOrder(tournament);
        await this.ensureTournamentPlayerWithManager(manager, tournament.id, user.id);
        const newOrder = [...(tournament.playerOrder ?? []), user.id];
        tournament.playerOrder = newOrder;
        await tournamentRepository.save(tournament);
        playerSlot = newOrder.length - 1;
        isCreator = false;
        await tournamentEntryRepository.save(
          tournamentEntryRepository.create({ tournament, user, joinedAt }),
        );
        await this.syncSemiPairStartOnJoinWithManager(
          manager,
          tournament.id,
          newOrder,
          playerSlot,
          joinedAt,
          tournament.createdAt ?? null,
        );
        await this.syncTournamentActiveStatusWithManager(manager, tournament.id);
      } else {
        tournament = tournamentRepository.create({
          status: TournamentStatus.ACTIVE,
          players: [user],
          gameType: 'training',
          playerOrder: [user.id],
        });
        await tournamentRepository.save(tournament);
        playerSlot = 0;
        isCreator = true;
        const { semi1, semi2 } = await this.pickQuestionsForSemi();
        for (const q of semi1) {
          const row = questionRepository.create({
            ...q,
            tournament,
            roundIndex: 0,
          });
          await questionRepository.save(row);
        }
        for (const q of semi2) {
          const row = questionRepository.create({
            ...q,
            tournament,
            roundIndex: 1,
          });
          await questionRepository.save(row);
        }
        await tournamentEntryRepository.save(
          tournamentEntryRepository.create({ tournament, user, joinedAt }),
        );
      }

      const toDto = (q: {
        id: number;
        question: string;
        options: string[];
        correctAnswer: number;
      }) => ({
        id: q.id,
        question: this.sanitizeUtf8ForDisplay(q.question),
        options: (Array.isArray(q.options) ? q.options : []).map((o) =>
          this.sanitizeUtf8ForDisplay(String(o)),
        ),
        correctAnswer: q.correctAnswer,
      });

      let questions = await questionRepository.find({
        where: { tournament: { id: tournament.id } },
        order: { roundIndex: 'ASC', id: 'ASC' },
      });
      if (questions.filter((q) => q.roundIndex === 0).length === 0) {
        const generated = await this.pickQuestionsForSemi();
        for (const q of generated.semi1) {
          const row = questionRepository.create({
            ...q,
            tournament,
            roundIndex: 0,
          });
          await questionRepository.save(row);
        }
        for (const q of generated.semi2) {
          const row = questionRepository.create({
            ...q,
            tournament,
            roundIndex: 1,
          });
          await questionRepository.save(row);
        }
        questions = await questionRepository.find({
          where: { tournament: { id: tournament.id } },
          order: { roundIndex: 'ASC', id: 'ASC' },
        });
      }
      const questionsSemi1 = questions
        .filter((q) => q.roundIndex === 0)
        .map(toDto);
      const questionsSemi2 = questions
        .filter((q) => q.roundIndex === 1)
        .map(toDto);

      const semiIndex = playerSlot < 2 ? 0 : 1;

      return {
        tournamentId: tournament.id,
        gameStartedAt: joinedAt.toISOString(),
        deadline: null,
        questionsSemi1,
        questionsSemi2,
        questionsFinal: [],
        playerSlot,
        totalPlayers:
          (tournament.playerOrder ?? []).length ||
          tournament.players?.length ||
          0,
        semiIndex,
        isCreator,
      };
    });
  }

  async createTournament(
    userId: number,
  ): Promise<{ tournamentId: number; playerSlot: number; questions: any[] }> {
    const training = await this.startTraining(userId);
    const questions = [...training.questionsSemi1, ...training.questionsSemi2];
    return {
      tournamentId: training.tournamentId,
      playerSlot: training.playerSlot,
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
    const balanceMaps = await this.usersService.getComputedBalanceMapsForUsers([
      userId,
    ]);
    const balance = balanceMaps.balanceL.get(userId) ?? 0;
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
    leagueWins.forEach((v, k) => {
      winsObj[k] = v;
    });

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
  private getMaxAllowedLeague(
    balance: number,
    winsByLeague: Map<number, number>,
  ): number | null {
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
      where: [
        { status: TournamentStatus.WAITING, gameType: 'money' },
        { status: TournamentStatus.ACTIVE, gameType: 'money' },
      ],
      relations: ['players'],
    });
    const userIds = new Set<number>();
    for (const t of tournaments.filter((tournament) => this.getTournamentPlayerCount(tournament) < 4)) {
      for (const p of t.players ?? []) {
        userIds.add(p.id);
      }
    }
    if (userIds.size === 0) {
      return LEAGUE_AMOUNTS.reduce<Record<number, number>>(
        (acc, amt) => ({ ...acc, [amt]: 0 }),
        {},
      );
    }
    const users = await this.userRepository.find({
      where: { id: In([...userIds]) },
      select: ['id', 'lastCabinetSeenAt'],
    });
    const now = Date.now();
    const cutoff = new Date(now - TournamentsService.CABINET_ONLINE_MS);
    const inCabinetIds = new Set(
      users
        .filter(
          (u) =>
            u.lastCabinetSeenAt != null &&
            new Date(u.lastCabinetSeenAt) >= cutoff,
        )
        .map((u) => u.id),
    );
    const balanceMaps = await this.usersService.getComputedBalanceMapsForUsers([
      ...userIds,
    ]);
    const balanceByUser = new Map<number, number>();
    for (const uid of userIds) {
      balanceByUser.set(uid, balanceMaps.balanceL.get(uid) ?? 0);
    }
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
    for (const row of winsRows as {
      userId: number;
      leagueAmount: number;
      wins: number;
    }[]) {
      winsByUserAndLeague.set(
        `${row.userId}:${row.leagueAmount}`,
        Number(row.wins) || 0,
      );
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
  async joinOrCreateMoneyTournament(
    userId: number,
    leagueAmount: number,
  ): Promise<{
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
      const minBalance =
        idx >= 0
          ? getMinBalanceForLeague(idx, leagueAmount)
          : leagueAmount * 10;
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
      throw new BadRequestException(
        'Недостаточно средств на балансе для вступления в игру.',
      );
    }

    return this.tournamentRepository.manager.transaction(async (manager) => {
      const tournamentRepository = manager.getRepository(Tournament);
      const questionRepository = manager.getRepository(Question);
      const tournamentEntryRepository = manager.getRepository(TournamentEntry);
      const tournamentEscrowRepository =
        manager.getRepository(TournamentEscrow);
      const transactionRepository = manager.getRepository(Transaction);

      const user = await manager
        .createQueryBuilder(User, 'user')
        .setLock('pessimistic_write')
        .where('user.id = :userId', { userId })
        .getOne();
      if (!user) throw new NotFoundException('User not found');
      if (Number(user.balance ?? 0) < leagueAmount) {
        throw new BadRequestException(
          'Недостаточно средств на балансе для вступления в игру.',
        );
      }

      const reusableTournaments = await this.loadReusableTournamentPool(manager, {
        gameType: 'money',
        userId,
        leagueAmount,
        lockRows: true,
      });
      const waitingTournament =
        this.pickReusableTournamentEntry(reusableTournaments)?.tournament ?? null;

      let tournament: Tournament;
      let playerSlot: number;
      let isCreator: boolean;
      const joinedAt = new Date();

      if (waitingTournament) {
        tournament = waitingTournament;
        this.sortPlayersByOrder(tournament);
        await this.ensureTournamentPlayerWithManager(
          manager,
          tournament.id,
          user.id,
        );
        const newOrder = [...(tournament.playerOrder ?? []), user.id];
        tournament.playerOrder = newOrder;
        await tournamentRepository.save(tournament);
        playerSlot = newOrder.length - 1;
        isCreator = false;
        await tournamentEntryRepository.save(
          tournamentEntryRepository.create({ tournament, user, joinedAt }),
        );
        await this.syncSemiPairStartOnJoinWithManager(
          manager,
          tournament.id,
          newOrder,
          playerSlot,
          joinedAt,
          tournament.createdAt ?? null,
        );
        await this.syncTournamentActiveStatusWithManager(manager, tournament.id);
      } else {
        tournament = tournamentRepository.create({
          status: TournamentStatus.ACTIVE,
          players: [user],
          gameType: 'money',
          leagueAmount,
          playerOrder: [user.id],
        });
        await tournamentRepository.save(tournament);
        playerSlot = 0;
        isCreator = true;
        const { semi1, semi2 } = await this.pickQuestionsForSemi();
        for (const q of semi1) {
          const row = questionRepository.create({
            ...q,
            tournament,
            roundIndex: 0,
          });
          await questionRepository.save(row);
        }
        for (const q of semi2) {
          const row = questionRepository.create({
            ...q,
            tournament,
            roundIndex: 1,
          });
          await questionRepository.save(row);
        }
        await tournamentEntryRepository.save(
          tournamentEntryRepository.create({ tournament, user, joinedAt }),
        );
      }

      user.balance = Number(user.balance ?? 0) - leagueAmount;
      await manager.save(user);
      await transactionRepository.save(
        transactionRepository.create({
          userId,
          amount: -leagueAmount,
          description: `${getLeagueName(leagueAmount)}, ID ${tournament.id}`,
          category: 'loss',
          tournamentId: tournament.id,
        }),
      );

      await tournamentEscrowRepository.save(
        tournamentEscrowRepository.create({
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
        totalPlayers:
          (tournament.playerOrder ?? []).length ||
          tournament.players?.length ||
          0,
        semiIndex,
        positionInSemi,
        isCreator,
        gameStartedAt: joinedAt.toISOString(),
        deadline: null,
      };
    });
  }

  /** DTO элемента списка активных/завершённых турниров. */
  async getMyTournaments(
    userId: number,
    mode?: 'training' | 'money',
    currentTournamentId?: number,
  ): Promise<TournamentListResponseDto> {
    const tids = new Set<number>();

    try {
      const fromProgress = await this.tournamentProgressRepository.find({
        where: { userId },
        select: ['tournamentId'],
      });
      for (const p of fromProgress)
        if (p.tournamentId > 0) tids.add(p.tournamentId);
    } catch (e) {
      this.logger.warn(
        '[getMyTournaments] fromProgress',
        (e as Error)?.message,
      );
    }
    try {
      const fromEntry = await this.tournamentEntryRepository.find({
        where: { user: { id: userId } },
        relations: ['tournament'],
      });
      for (const e of fromEntry) {
        const tid =
          (e.tournament as Tournament)?.id ??
          (e as { tournamentId?: number }).tournamentId;
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
      const rawPlayerOrder =
        await this.tournamentRepository.manager.connection.query(
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
      for (const row of Array.isArray(rawPlayerOrder) ? rawPlayerOrder : []) {
        if (row?.id > 0) tids.add(Number(row.id));
      }
    } catch (e) {
      this.logger.warn(
        '[getMyTournaments] fromPlayerOrder',
        (e as Error)?.message,
      );
      try {
        const rawPlayerOrderSnake =
          await this.tournamentRepository.manager.connection.query(
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
        for (const row of Array.isArray(rawPlayerOrderSnake)
          ? rawPlayerOrderSnake
          : []) {
          if (row?.id > 0) tids.add(Number(row.id));
        }
      } catch (_) {}
    }

    if (tids.size === 0) {
      const conn = this.tournamentRepository.manager.connection;
      const addIdsFromRaw = (raw: unknown): void => {
        const res = raw as { rows?: unknown[] };
        const rows = Array.isArray(raw)
          ? raw
          : ((res?.rows ?? []) as { id?: number; tournamentId?: number }[]);
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

    const getModeForTournament = (t: Tournament): 'training' | 'money' =>
      t.gameType === 'money' || t.leagueAmount != null ? 'money' : 'training';

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
        tournaments = list.filter((t) => getModeForTournament(t) === 'money');
      } else {
        tournaments = list.filter(
          (t) => getModeForTournament(t) === 'training',
        );
      }
    }

    const allIds = tournaments.map((t) => t.id);
    const resultByTournamentId = new Map<number, boolean>();
    const completedAtByTid = new Map<number, string | null>();
    if (allIds.length > 0) {
      const results = await this.tournamentResultRepository.find({
        where: { userId, tournamentId: In(allIds) },
      });
      for (const r of results) {
        resultByTournamentId.set(r.tournamentId, r.passed === 1);
        completedAtByTid.set(
          r.tournamentId,
          r.completedAt
            ? r.completedAt instanceof Date
              ? r.completedAt.toISOString()
              : String(r.completedAt)
            : null,
        );
      }
    }

    const deadlineByTournamentId: Record<number, string | null> = {};
    const roundStartedAtByTid = new Map<number, string | null>();
    const playerRoundFinished = new Map<number, boolean>();
    const timeoutResolutionRows =
      allIds.length > 0
        ? await this.tournamentRoundResolutionRepository.find({
            where: {
              tournamentId: In(allIds),
              reason: TournamentResolutionReason.TIMEOUT,
            },
          })
        : [];
    const timeoutResolutionMap = this.buildLatestResolutionMap(
      timeoutResolutionRows,
    );
    if (allIds.length > 0) {
      const allProgress = await this.tournamentProgressRepository
        .createQueryBuilder('p')
        .where('p.tournamentId IN (:...ids)', { ids: allIds })
        .getMany();
      for (const tid of allIds) {
        const myProg = allProgress.find(
          (p) => p.tournamentId === tid && p.userId === userId,
        );
        const t = tournaments.find((t2) => t2.id === tid);
        const sharedStart =
          t && myProg
            ? this.getCurrentRoundSharedStart(
                t,
                userId,
                myProg,
                allProgress,
                timeoutResolutionMap,
              )
            : null;
        deadlineByTournamentId[tid] = sharedStart
          ? this.getRoundDeadline(sharedStart)
          : null;
        const ownStart = myProg?.roundStartedAt ?? null;
        roundStartedAtByTid.set(
          tid,
          ownStart
            ? ownStart instanceof Date
              ? ownStart.toISOString()
              : String(ownStart)
            : null,
        );
      }

      // Determine if player has finished current round (no timer needed)
      const hasOtherFinalist = (t: Tournament): boolean => {
        const order = t.playerOrder;
        if (!order || order.length < 4) return false;
        const pSlot = order.indexOf(userId);
        if (pSlot < 0) return false;
        const os: [number, number] = pSlot < 2 ? [2, 3] : [0, 1];
        const id1 = order[os[0]];
        const id2 = order[os[1]];
        if (id1 == null || id2 == null || id1 <= 0 || id2 <= 0) return false;
        const pr1 = allProgress.find(
          (p) => p.tournamentId === t.id && p.userId === id1,
        );
        const pr2 = allProgress.find(
          (p) => p.tournamentId === t.id && p.userId === id2,
        );
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
        const myProg = allProgress.find(
          (p) => p.tournamentId === tid && p.userId === userId,
        );
        if (!myProg) {
          playerRoundFinished.set(tid, false);
          continue;
        }
        const t = tournaments.find((t2) => t2.id === tid);
        if (!t) {
          playerRoundFinished.set(tid, false);
          continue;
        }
        this.sortPlayersByOrder(t);
        const playerSlot = t.playerOrder?.indexOf(userId) ?? -1;
        const oppSlot =
          playerSlot >= 0
            ? playerSlot % 2 === 0
              ? playerSlot + 1
              : playerSlot - 1
            : -1;
        const oppId =
          oppSlot >= 0 && t.playerOrder && oppSlot < t.playerOrder.length
            ? t.playerOrder[oppSlot]
            : null;
        const oppProg =
          oppId != null && oppId > 0
            ? allProgress.find(
                (p) => p.tournamentId === tid && p.userId === oppId,
              )
            : null;

        const myQ = myProg.questionsAnsweredCount ?? 0;
        const mySemi = myProg.semiFinalCorrectCount;
        const myTBLen = (myProg.tiebreakerRoundsCorrect ?? []).length;
        const mySemiTotal = 10 + myTBLen * 10;

        if (myQ < 10) {
          playerRoundFinished.set(tid, false);
        } else if (oppId == null || oppId <= 0) {
          const realPlayers =
            t.playerOrder?.filter((id: number) => id > 0).length ?? 0;
          if (realPlayers <= 2) {
            playerRoundFinished.set(tid, myQ >= 10);
          } else {
            if (myQ >= mySemiTotal + 10) {
              playerRoundFinished.set(tid, true);
            } else if (myQ >= 10 && myQ < mySemiTotal + 10) {
              playerRoundFinished.set(tid, false);
            } else {
              playerRoundFinished.set(tid, myQ >= 10);
            }
          }
        } else if (
          mySemi != null &&
          oppProg?.semiFinalCorrectCount != null &&
          mySemi === oppProg.semiFinalCorrectCount
        ) {
          const semiState = this.getSemiHeadToHeadState(
            myQ,
            mySemi,
            myProg.tiebreakerRoundsCorrect,
            oppProg.questionsAnsweredCount ?? 0,
            oppProg.semiFinalCorrectCount,
            oppProg.tiebreakerRoundsCorrect,
          );
          if (semiState.result === 'won') {
            if (myQ < mySemiTotal) {
              playerRoundFinished.set(tid, true);
            } else if (myQ >= mySemiTotal + 10) {
              playerRoundFinished.set(tid, true);
            } else {
              playerRoundFinished.set(tid, false);
            }
          } else if (semiState.result === 'lost') {
            playerRoundFinished.set(tid, true);
          } else {
            const tbRound = semiState.tiebreakerRound ?? 1;
            const roundEnd = 10 + tbRound * 10;
            playerRoundFinished.set(tid, myQ >= roundEnd);
          }
        } else if (
          mySemi != null &&
          oppProg?.semiFinalCorrectCount != null &&
          mySemi > oppProg.semiFinalCorrectCount
        ) {
          if (myQ < mySemiTotal) {
            playerRoundFinished.set(tid, true);
          } else if (myQ >= mySemiTotal + 10) {
            playerRoundFinished.set(tid, true);
          } else {
            playerRoundFinished.set(tid, false);
          }
        } else {
          playerRoundFinished.set(tid, myQ >= 10);
        }
      }
    }

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
      for (const p of allProgressList) {
        let adjustedQ = p.questionsAnsweredCount;
        let adjustedSemiCorrect = p.semiFinalCorrectCount;
        if (p.userId === userId) {
          if (
            p.questionsAnsweredCount === QUESTIONS_PER_ROUND - 1 &&
            p.currentQuestionIndex === QUESTIONS_PER_ROUND - 1
          ) {
            adjustedQ = QUESTIONS_PER_ROUND;
          } else if (
            p.questionsAnsweredCount === 2 * QUESTIONS_PER_ROUND - 1 &&
            p.currentQuestionIndex === 2 * QUESTIONS_PER_ROUND - 1
          ) {
            adjustedQ = 2 * QUESTIONS_PER_ROUND;
          } else if (
            p.currentQuestionIndex >= QUESTIONS_PER_ROUND - 1 &&
            adjustedQ < QUESTIONS_PER_ROUND
          ) {
            adjustedQ = QUESTIONS_PER_ROUND;
          } else if (
            p.currentQuestionIndex >= 2 * QUESTIONS_PER_ROUND - 1 &&
            adjustedQ < 2 * QUESTIONS_PER_ROUND
          ) {
            adjustedQ = 2 * QUESTIONS_PER_ROUND;
          }
          if (p.currentQuestionIndex > 0) {
            adjustedQ = Math.max(adjustedQ, p.currentQuestionIndex);
          }
          if (
            p.semiFinalCorrectCount != null &&
            adjustedQ < QUESTIONS_PER_ROUND &&
            p.questionsAnsweredCount >= QUESTIONS_PER_ROUND - 2
          ) {
            adjustedQ = Math.max(adjustedQ, QUESTIONS_PER_ROUND);
          }
        }
        if (
          adjustedSemiCorrect == null &&
          adjustedQ >= QUESTIONS_PER_ROUND &&
          p.correctAnswersCount != null
        ) {
          adjustedSemiCorrect = Math.min(
            QUESTIONS_PER_ROUND,
            p.correctAnswersCount,
          );
        }
        if (
          adjustedQ === QUESTIONS_PER_ROUND + 1 &&
          (p.currentQuestionIndex ?? 0) >= QUESTIONS_PER_ROUND &&
          adjustedSemiCorrect != null &&
          (p.lockedAnswerCount ?? 0) <= QUESTIONS_PER_ROUND
        ) {
          adjustedQ = QUESTIONS_PER_ROUND;
        }
        const data: ProgressData = {
          userId: p.userId,
          q: adjustedQ,
          semiCorrect: adjustedSemiCorrect,
          totalCorrect: p.correctAnswersCount ?? 0,
          currentIndex: p.currentQuestionIndex,
          tiebreakerRounds: Array.isArray(p.tiebreakerRoundsCorrect)
            ? p.tiebreakerRoundsCorrect
            : [],
          finalTiebreakerRounds: Array.isArray(
            (p as any).finalTiebreakerRoundsCorrect,
          )
            ? (p as any).finalTiebreakerRoundsCorrect
            : [],
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

    const getPlayerCount = (t: Tournament): number =>
      t.playerOrder?.length ?? t.players?.length ?? 0;

    const getOwnSemiTimeoutResolution = (
      t: Tournament,
    ): TournamentRoundResolution | null => {
      const order = t.playerOrder ?? [];
      const playerSlot = order.indexOf(userId);
      const pairIndex = this.getSemiPairIndexBySlot(playerSlot);
      if (pairIndex == null) return null;
      return this.getLatestResolutionFromMap(
        timeoutResolutionMap,
        t.id,
        TournamentResolutionStage.SEMI,
        pairIndex,
      );
    };

    const getOppositeSemiTimeoutResolution = (
      t: Tournament,
    ): TournamentRoundResolution | null => {
      const order = t.playerOrder ?? [];
      const playerSlot = order.indexOf(userId);
      if (playerSlot < 0 || order.length <= 2) return null;
      const pairIndex: 0 | 1 = playerSlot < 2 ? 1 : 0;
      return this.getLatestResolutionFromMap(
        timeoutResolutionMap,
        t.id,
        TournamentResolutionStage.SEMI,
        pairIndex,
      );
    };

    const getFinalTimeoutResolution = (
      t: Tournament,
    ): TournamentRoundResolution | null =>
      this.getLatestResolutionFromMap(
        timeoutResolutionMap,
        t.id,
        TournamentResolutionStage.FINAL,
        0,
      );

    const getMoneySemiResult = (
      t: Tournament,
    ): {
      result: 'won' | 'lost' | 'tie' | 'incomplete';
      tiebreakerRound?: number;
      noOpponent?: boolean;
      timedOut?: boolean;
      bothLost?: boolean;
      resolution?: TournamentRoundResolution | null;
    } => {
      const order = t.playerOrder;
      if (!order || order.length < 2) return { result: 'incomplete' };
      const playerSlot = order.indexOf(userId);
      if (playerSlot < 0) return { result: 'incomplete' };
      const opponentSlot =
        playerSlot % 2 === 0 ? playerSlot + 1 : playerSlot - 1;

      const noOpponent =
        opponentSlot < 0 ||
        opponentSlot >= order.length ||
        (order[opponentSlot] ?? -1) <= 0;

      // В паре нет соперника (ожидание игрока) — не считаем победой, турнир остаётся в активных.
      if (noOpponent) return { result: 'incomplete', noOpponent: true };

      const timeoutResolution = getOwnSemiTimeoutResolution(t);
      const timeoutOutcome = this.getTimeoutOutcomeForUser(
        timeoutResolution,
        userId,
      );
      if (timeoutOutcome === 'won')
        return { result: 'won', timedOut: true, resolution: timeoutResolution };
      if (timeoutOutcome === 'lost')
        return {
          result: 'lost',
          timedOut: true,
          resolution: timeoutResolution,
        };
      if (timeoutOutcome === 'both_lost')
        return {
          result: 'lost',
          timedOut: true,
          bothLost: true,
          resolution: timeoutResolution,
        };

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
      if (
        semiState.result === 'tie' &&
        semiState.tiebreakerRound != null &&
        isTimeExpired(t)
      ) {
        const roundEnd =
          QUESTIONS_PER_ROUND +
          semiState.tiebreakerRound * TIEBREAKER_QUESTIONS;
        if (myQ >= roundEnd && oppQ < roundEnd)
          return { result: 'won', tiebreakerRound: semiState.tiebreakerRound };
        if (myQ < roundEnd && oppQ >= roundEnd) return { result: 'lost' };
      }
      return semiState;
    };

    const getOtherFinalist = (t: Tournament): ProgressData | null => {
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

      const timeoutResolution = getOppositeSemiTimeoutResolution(t);
      if (timeoutResolution) {
        if (timeoutResolution.outcome === TournamentResolutionOutcome.BOTH_LOST)
          return null;
        const winnerId = timeoutResolution.winnerUserId;
        if (!(winnerId && winnerId > 0)) return null;
        return progressByTidAndUser.get(t.id)?.get(winnerId) ?? null;
      }

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

      return null;
    };

    const didOppositeSemiBothLoseByTimeout = (t: Tournament): boolean => {
      const timeoutResolution = getOppositeSemiTimeoutResolution(t);
      if (timeoutResolution) {
        return (
          timeoutResolution.outcome === TournamentResolutionOutcome.BOTH_LOST
        );
      }
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
      const s1 = prog1?.roundStartedAt;
      const s2 = prog2?.roundStartedAt;
      if (!(s1 instanceof Date) || !(s2 instanceof Date)) return false;
      const sharedStart = new Date(Math.max(s1.getTime(), s2.getTime()));
      if (!this.isRoundDeadlinePassed(sharedStart, now)) return false;
      const semiState = this.getSemiHeadToHeadState(
        prog1?.q ?? 0,
        prog1?.semiCorrect,
        prog1?.tiebreakerRounds,
        prog2?.q ?? 0,
        prog2?.semiCorrect,
        prog2?.tiebreakerRounds,
      );
      const extraRounds =
        semiState.result === 'tie' ? (semiState.tiebreakerRound ?? 1) : 0;
      const target = QUESTIONS_PER_ROUND + extraRounds * TIEBREAKER_QUESTIONS;
      return (prog1?.q ?? 0) < target && (prog2?.q ?? 0) < target;
    };

    const now = new Date();

    const toDate = (value: Date | string | null | undefined): Date | null => {
      if (!value) return null;
      const dt = value instanceof Date ? value : new Date(value);
      return Number.isNaN(dt.getTime()) ? null : dt;
    };

    const maxDate = (
      ...values: (Date | string | null | undefined)[]
    ): Date | null => {
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

    const formatTimeoutDefeatLabel = (): string => 'Поражение, время истекло';
    const formatScoreLabel = (
      base: 'Победа' | 'Поражение',
      score: { my: number; opp: number } | null,
    ): string => (score ? `${base} ${score.my}-${score.opp}` : base);

    const getSemiScore = (
      t: Tournament,
    ): { my: number; opp: number } | null => {
      const order = t.playerOrder ?? [];
      const playerSlot = order.indexOf(userId);
      if (playerSlot < 0) return null;
      const opponentSlot =
        playerSlot % 2 === 0 ? playerSlot + 1 : playerSlot - 1;
      const opponentId =
        opponentSlot >= 0 && opponentSlot < order.length
          ? (order[opponentSlot] ?? -1)
          : -1;
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

    const getFinalScore = (
      t: Tournament,
      myProg?: ProgressData | null,
    ): { my: number; opp: number } | null => {
      const me = myProg ?? progressByTid.get(t.id);
      const otherFin = getOtherFinalist(t);
      if (!me || !otherFin) return null;
      const myFinalTotal = computeFinalCorrect(me);
      const oppFinalTotal = computeFinalCorrect(otherFin);
      const myFinalBase =
        myFinalTotal - me.finalTiebreakerRounds.reduce((a, b) => a + b, 0);
      const oppFinalBase =
        oppFinalTotal -
        otherFin.finalTiebreakerRounds.reduce((a, b) => a + b, 0);
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
      const finalTimeoutResolution = getFinalTimeoutResolution(t);
      const finalTimeoutOutcome = this.getTimeoutOutcomeForUser(
        finalTimeoutResolution,
        userId,
      );
      if (finalTimeoutOutcome === 'won') return 'won';
      if (finalTimeoutOutcome === 'lost') return 'lost';
      if (finalTimeoutOutcome === 'both_lost') return 'tie';

      const otherFin = getOtherFinalist(t);
      if (!otherFin) {
        if (didOppositeSemiBothLoseByTimeout(t)) {
          const mySemiTotal = semiPhaseQuestions(myProg);
          const myFinalAnswered = Math.max(0, myProg.q - mySemiTotal);
          const myFinalCorrect = computeFinalCorrect(myProg);
          if (myFinalAnswered >= QUESTIONS_PER_ROUND)
            return myFinalCorrect > 0 ? 'won' : 'lost';
          if (isTimeExpired(t)) return myFinalCorrect > 0 ? 'won' : 'lost';
        }
        return 'incomplete';
      }
      const mySemiTotal = semiPhaseQuestions(myProg);
      const oppSemiTotal =
        QUESTIONS_PER_ROUND +
        otherFin.tiebreakerRounds.length * TIEBREAKER_QUESTIONS;
      const myFinalAnswered = Math.max(0, myProg.q - mySemiTotal);
      const oppFinalAnswered = Math.max(0, otherFin.q - oppSemiTotal);
      const myFinalTotal = computeFinalCorrect(myProg);
      const oppFinalTotal = computeFinalCorrect(otherFin);
      const myFinalBase =
        myFinalTotal - myProg.finalTiebreakerRounds.reduce((a, b) => a + b, 0);
      const oppFinalBase =
        oppFinalTotal -
        otherFin.finalTiebreakerRounds.reduce((a, b) => a + b, 0);
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

    const getDerivedTournamentState = (
      t: Tournament,
    ): { passed: boolean; completedAt: string | null } => {
      const userProgress = progressByTid.get(t.id);
      const answered = userProgress?.q ?? 0;
      const order = t.playerOrder ?? [];
      const playerSlot = order.indexOf(userId);
      const opponentSlot =
        playerSlot >= 0
          ? playerSlot % 2 === 0
            ? playerSlot + 1
            : playerSlot - 1
          : -1;
      const opponentId =
        opponentSlot >= 0 && opponentSlot < order.length
          ? (order[opponentSlot] ?? -1)
          : -1;
      const existingCompletedAt = completedAtByTid.get(t.id) ?? null;
      const semiResult = getMoneySemiResult(t);

      let passed = false;
      let completionDate = maxDate(existingCompletedAt);

      if (semiResult.result === 'lost') {
        completionDate =
          completionDate ?? getCompletionDateFromUsers(t, [userId, opponentId]);
      } else if (semiResult.result === 'tie') {
        if (isTimeExpired(t)) {
          completionDate =
            completionDate ??
            getCompletionDateFromUsers(t, [userId, opponentId]);
        }
      } else if (semiResult.result === 'won' && userProgress) {
        const mySemiTotal = semiPhaseQuestions(userProgress);
        const semiWinCompletionDate = getCompletionDateFromUsers(t, [
          userId,
          opponentId,
        ]);
        if (answered >= mySemiTotal + QUESTIONS_PER_ROUND) {
          const fr = getFinalResult(t, userProgress);
          if (fr === 'won') {
            passed = true;
            const otherFinalist = getOtherFinalist(t);
            completionDate =
              completionDate ??
              getCompletionDateFromUsers(t, [
                userId,
                otherFinalist?.userId ?? -1,
              ]);
          } else if (fr === 'lost' || fr === 'tie') {
            const otherFinalist = getOtherFinalist(t);
            completionDate =
              completionDate ??
              getCompletionDateFromUsers(t, [
                userId,
                otherFinalist?.userId ?? -1,
              ]);
          } else {
            completionDate = completionDate ?? semiWinCompletionDate;
          }
        } else if (answered >= mySemiTotal) {
          completionDate = completionDate ?? semiWinCompletionDate;
        }
      } else if (
        !(semiResult.result === 'incomplete' && semiResult.noOpponent)
      ) {
        if (isTimeExpired(t)) {
          completionDate =
            completionDate ??
            getCompletionDateFromUsers(t, [userId, opponentId]);
        }
      }

      if (!completionDate && t.status === TournamentStatus.FINISHED) {
        completionDate = getTournamentCompletionDate(t);
      }

      return {
        passed,
        completedAt: completionDate
          ? completionDate.toISOString()
          : existingCompletedAt,
      };
    };

    for (const t of tournaments) {
      const derivedState = getDerivedTournamentState(t);
      completedAtByTid.set(t.id, derivedState.completedAt);
      resultByTournamentId.set(t.id, derivedState.passed);
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
      resultState: TournamentListResultState,
      roundForQuestions?: 'semi' | 'final',
      stageOverride?: string,
      forCompletedList?: boolean,
    ) => {
      const resultLabel = resultState.label;
      const prog = progressByTid.get(t.id);
      const answered = prog?.q ?? 0;
      const semiCorrect =
        prog?.semiCorrect ??
        (answered <= QUESTIONS_PER_ROUND ? (prog?.totalCorrect ?? 0) : 0);
      const tbRounds = prog?.tiebreakerRounds ?? [];
      const stage = stageOverride ?? getStage(t);
      const semiRes = getMoneySemiResult(t);
      const inSemiPhase = semiRes.result !== 'won';
      const round: 'semi' | 'final' =
        roundForQuestions ?? (inSemiPhase ? 'semi' : 'final');
      const order = t.playerOrder ?? [];
      const playerSlot = order.indexOf(userId);
      const opponentSlot =
        playerSlot >= 0
          ? playerSlot % 2 === 0
            ? playerSlot + 1
            : playerSlot - 1
          : -1;
      const opponentId =
        opponentSlot >= 0 && opponentSlot < order.length
          ? (order[opponentSlot] ?? -1)
          : -1;
      const opponentProg =
        opponentId > 0 ? progressByTidAndUser.get(t.id)?.get(opponentId) : null;

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
          questionsTotal =
            QUESTIONS_PER_ROUND +
            semiResolved.roundsUsed * TIEBREAKER_QUESTIONS;
          questionsAnsweredInRound = Math.min(answered, questionsTotal);
          correctAnswersInRound = semiResolved.myTotal;
        } else {
          const completedTBRounds = tbRounds.length;
          const tbCorrectSum = tbRounds.reduce((a, b) => a + b, 0);
          questionsTotal =
            QUESTIONS_PER_ROUND + completedTBRounds * TIEBREAKER_QUESTIONS;
          questionsAnsweredInRound = Math.min(answered, questionsTotal);
          correctAnswersInRound = semiCorrect + tbCorrectSum;
        }
      } else {
        const semiTBCount = tbRounds.length;
        const semiTotal =
          QUESTIONS_PER_ROUND + semiTBCount * TIEBREAKER_QUESTIONS;
        const finalAnswered = Math.max(0, answered - semiTotal);
        const otherFinalist = getOtherFinalist(t);
        if (prog && otherFinalist) {
          const myFinalTotal = computeFinalCorrect(prog);
          const oppFinalTotal = computeFinalCorrect(otherFinalist);
          const myFinalBase =
            myFinalTotal -
            prog.finalTiebreakerRounds.reduce((a, b) => a + b, 0);
          const oppFinalBase =
            oppFinalTotal -
            otherFinalist.finalTiebreakerRounds.reduce((a, b) => a + b, 0);
          const finalResolved = this.resolveStageTotals(
            finalAnswered,
            myFinalBase,
            prog.finalTiebreakerRounds,
            Math.max(
              0,
              (otherFinalist.q ?? 0) - semiPhaseQuestions(otherFinalist),
            ),
            oppFinalBase,
            otherFinalist.finalTiebreakerRounds,
            t.status === TournamentStatus.FINISHED,
          );
          questionsTotal =
            QUESTIONS_PER_ROUND +
            finalResolved.roundsUsed * TIEBREAKER_QUESTIONS;
          questionsAnsweredInRound = Math.min(finalAnswered, questionsTotal);
          correctAnswersInRound = finalResolved.myTotal;
        } else {
          const finalTBRounds = prog?.finalTiebreakerRounds ?? [];
          questionsTotal =
            QUESTIONS_PER_ROUND + finalTBRounds.length * TIEBREAKER_QUESTIONS;
          questionsAnsweredInRound = Math.min(finalAnswered, questionsTotal);
          correctAnswersInRound = prog ? computeFinalCorrect(prog) : 0;
        }
      }
      let completedAtVal: string | null =
        completedAtByTid.get(t.id) ??
        (t.createdAt
          ? t.createdAt instanceof Date
            ? t.createdAt.toISOString()
            : String(t.createdAt)
          : null);
      const roundStartedAtDisplay: string | null =
        roundStartedAtByTid.get(t.id) ?? null;
      // Если старт раунда позже даты завершения — берём реальную дату завершения по паре (leftAt/roundStartedAt); при отсутствии данных завершаем по старту раунда.
      if (completedAtVal && roundStartedAtDisplay) {
        const rs = new Date(roundStartedAtDisplay).getTime();
        const ca = new Date(completedAtVal).getTime();
        if (rs > ca) {
          const order = t.playerOrder ?? [];
          const playerSlot = order.indexOf(userId);
          const opponentSlot =
            playerSlot % 2 === 0 ? playerSlot + 1 : playerSlot - 1;
          const opponentId =
            opponentSlot >= 0 && opponentSlot < order.length
              ? (order[opponentSlot] ?? -1)
              : -1;
          const ids = opponentId > 0 ? [userId, opponentId] : [userId];
          const realCompletion = getCompletionDateFromUsers(t, ids);
          const useCompletion = realCompletion
            ? new Date(Math.max(realCompletion.getTime(), rs))
            : new Date(rs);
          completedAtVal = (
            useCompletion > now ? now : useCompletion
          ).toISOString();
        }
      }
      const displayStatus = forCompletedList
        ? TournamentStatus.FINISHED
        : resultState.kind === 'waiting_opponent'
          ? TournamentStatus.WAITING
          : TournamentStatus.ACTIVE;
      const bucket: TournamentListBucket = forCompletedList
        ? 'completed'
        : 'active';
      const stageKind: TournamentStageKind =
        stage === 'Финал' ? 'final' : 'semi';
      const viewMeta = buildTournamentViewMeta(
        {
          stageKind,
          resultKind: resultState.kind,
          userStatus,
          deadline,
          roundFinished: playerRoundFinished.get(t.id) ?? false,
        },
        bucket,
      );
      const resultTone =
        resultLabel === 'Этап не пройден'
          ? 'stage-not-passed'
          : viewMeta.resultTone;
      return {
        id: t.id,
        status: displayStatus,
        createdAt:
          t.createdAt instanceof Date
            ? t.createdAt.toISOString()
            : String(t.createdAt),
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
        stageKind: viewMeta.stageKind,
        resultKind: viewMeta.resultKind,
        resultTone,
        listBucket: viewMeta.listBucket,
        canContinue: viewMeta.canContinue,
        isWaitingOpponent: viewMeta.isWaitingOpponent,
        isTimeoutResult: viewMeta.isTimeoutResult,
        tournament: {
          id: t.id,
          name: getTournamentDisplayName(t),
          type: getModeForTournament(t),
          status: displayStatus,
          leagueAmount: t.leagueAmount ?? null,
        },
      };
    };

    const getResultState = (t: Tournament): TournamentListResultState => {
      const prog = progressByTid.get(t.id);
      const answered = prog?.q ?? 0;
      if (t.status === TournamentStatus.FINISHED) {
        if (answered < QUESTIONS_PER_ROUND) {
          return {
            label: formatTimeoutDefeatLabel(),
            kind: 'timeout_defeat',
          };
        }
        if (resultByTournamentId.get(t.id) === true) {
          const progWin = progressByTid.get(t.id);
          return {
            label: formatScoreLabel(
              'Победа',
              progWin ? getFinalScore(t, progWin) : null,
            ),
            kind: 'victory',
          };
        }
        const semiResFin = getMoneySemiResult(t);
        if (semiResFin.timedOut && semiResFin.result === 'lost')
          return { label: formatTimeoutDefeatLabel(), kind: 'timeout_defeat' };
        if (semiResFin.result === 'won') {
          const progFin = progressByTid.get(t.id);
          if (progFin) {
            if (isWaitingForFinalOpponent(t, progFin))
              return { label: 'Ожидание соперника', kind: 'waiting_opponent' };
            const finalResult = getFinalResult(t, progFin);
            if (finalResult === 'won')
              return {
                label: formatScoreLabel('Победа', getFinalScore(t, progFin)),
                kind: 'victory',
              };
            if (finalResult === 'lost')
              return {
                label: formatScoreLabel('Поражение', getFinalScore(t, progFin)),
                kind: 'defeat',
              };
            if (finalResult === 'tie')
              return {
                label: formatTimeoutDefeatLabel(),
                kind: 'timeout_defeat',
              };
            if (
              (progFin.q ?? 0) <
              semiPhaseQuestions(progFin) + QUESTIONS_PER_ROUND
            )
              return { label: 'Этап не пройден', kind: 'in_progress' };
          }
        }
        return {
          label: formatScoreLabel('Поражение', getSemiScore(t)),
          kind: 'defeat',
        };
      }

      if (answered < QUESTIONS_PER_ROUND) {
        return { label: 'Этап не пройден', kind: 'in_progress' };
      }

      const semiResult = getMoneySemiResult(t);
      if (semiResult.result === 'incomplete') {
        return { label: 'Ожидание соперника', kind: 'waiting_opponent' };
      }
      if (semiResult.result === 'tie') {
        const tbRound = semiResult.tiebreakerRound ?? 1;
        const roundEnd = QUESTIONS_PER_ROUND + tbRound * TIEBREAKER_QUESTIONS;
        if (answered >= roundEnd) {
          return { label: 'Ожидание соперника', kind: 'waiting_opponent' };
        }
        return { label: 'Этап не пройден', kind: 'tiebreaker' };
      }
      if (semiResult.timedOut && semiResult.result === 'lost')
        return { label: formatTimeoutDefeatLabel(), kind: 'timeout_defeat' };
      if (semiResult.result === 'lost')
        return {
          label: formatScoreLabel('Поражение', getSemiScore(t)),
          kind: 'defeat',
        };
      if (semiResult.result === 'won') {
        if (!prog) return { label: 'Этап не пройден', kind: 'in_progress' };
        if (isWaitingForFinalOpponent(t, prog)) {
          return { label: 'Ожидание соперника', kind: 'waiting_opponent' };
        }
        const mySemiTotal = semiPhaseQuestions(prog);
        const fr = getFinalResult(t, prog);
        if (fr === 'won')
          return {
            label: formatScoreLabel('Победа', getFinalScore(t, prog)),
            kind: 'victory',
          };
        if (fr === 'lost')
          return {
            label: formatScoreLabel('Поражение', getFinalScore(t, prog)),
            kind: 'defeat',
          };
        if (fr === 'tie')
          return { label: 'Этап не пройден', kind: 'in_progress' };
        if (answered < mySemiTotal + QUESTIONS_PER_ROUND)
          return { label: 'Этап не пройден', kind: 'final_ready' };
        return { label: 'Ожидание соперника', kind: 'waiting_opponent' };
      }
      return { label: 'Ожидание соперника', kind: 'waiting_opponent' };
    };

    const getUserStatus = (t: Tournament): 'passed' | 'not_passed' => {
      const prog = progressByTid.get(t.id);
      if (!prog) return 'not_passed';

      const semiResult = getMoneySemiResult(t);
      if (semiResult.result !== 'won') return 'not_passed';

      const otherFinalist = getOtherFinalist(t);
      if (
        !otherFinalist &&
        t.status === TournamentStatus.FINISHED &&
        resultByTournamentId.get(t.id) === true
      ) {
        return 'passed';
      }

      const mySemiTotal = semiPhaseQuestions(prog);
      if ((prog.q ?? 0) < mySemiTotal + QUESTIONS_PER_ROUND)
        return 'not_passed';

      return getFinalResult(t, prog) === 'won' ? 'passed' : 'not_passed';
    };

    function isTimeExpired(t: Tournament): boolean {
      const deadline = deadlineByTournamentId[t.id];
      if (!deadline) return false;
      return new Date(deadline) < now;
    }

    const belongsToHistory = (t: Tournament): boolean => {
      const resultState = getResultState(t);
      if (t.status === TournamentStatus.FINISHED) {
        if (resultState.kind === 'waiting_opponent') return false;
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
      if (
        resultState.kind === 'timeout_defeat' ||
        resultState.kind === 'defeat' ||
        resultState.kind === 'victory'
      )
        return true;
      if (resultState.kind === 'waiting_opponent') return isTimeExpired(t);
      if (playerRoundFinished.get(t.id) && !isTimeExpired(t)) return false;
      if (currentTournamentId === t.id && !isTimeExpired(t)) return false;
      return isTimeExpired(t);
    };

    const getDisplayResultState = (
      t: Tournament,
      inCompleted: boolean,
    ): TournamentListResultState => {
      const resultState = getResultState(t);
      if (t.status === TournamentStatus.FINISHED) {
        return resultState;
      }
      if (
        inCompleted &&
        isTimeExpired(t) &&
        resultState.kind !== 'defeat' &&
        resultState.kind !== 'victory' &&
        resultState.kind !== 'timeout_defeat'
      ) {
        const semiRes2 = getMoneySemiResult(t);
        if (semiRes2.result === 'incomplete' && semiRes2.noOpponent)
          return { label: 'Ожидание соперника', kind: 'waiting_opponent' };
        return { label: formatTimeoutDefeatLabel(), kind: 'timeout_defeat' };
      }
      return resultState;
    };

    const activeTournamentsRaw = tournaments.filter(
      (t) => !belongsToHistory(t),
    );
    const completedTournamentsRaw = tournaments.filter((t) =>
      belongsToHistory(t),
    );

    // Если выиграл полуфинал — турнир и в активных (есть финал), и в истории как пройденный этап ПФ,
    // но сам турнир ещё не считается пройденным до победы в финале.
    const moneySemiWonFinalPending = tournaments.filter(
      (t) => getMoneySemiResult(t).result === 'won' && !belongsToHistory(t),
    );
    const semiWonCompletedItems = moneySemiWonFinalPending.map((t) =>
      toItem(
        t,
        deadlineByTournamentId[t.id] ?? null,
        'not_passed',
        {
          label: formatScoreLabel('Победа', getSemiScore(t)),
          kind: 'victory',
        },
        'semi',
        'Полуфинал',
        true,
      ),
    );

    const activeRaw = activeTournamentsRaw.map((t) =>
      toItem(
        t,
        deadlineByTournamentId[t.id] ?? null,
        getUserStatus(t),
        getDisplayResultState(t, false),
      ),
    );
    const active = activeRaw.slice().sort((a, b) => {
      const tA = new Date(a.createdAt).getTime();
      const tB = new Date(b.createdAt).getTime();
      if (tA !== tB) return tB - tA;
      return b.id - a.id;
    });

    const completedRaw = [
      ...completedTournamentsRaw.map((t) =>
        toItem(
          t,
          deadlineByTournamentId[t.id] ?? null,
          getUserStatus(t),
          getDisplayResultState(t, true),
          undefined,
          undefined,
          true,
        ),
      ),
      ...semiWonCompletedItems,
    ];
    const completed = completedRaw.slice().sort((a, b) => {
      const tA = new Date(a.createdAt).getTime();
      const tB = new Date(b.createdAt).getTime();
      if (tA !== tB) return tB - tA;
      return b.id - a.id;
    });

    return {
      active,
      completed,
      resumeTournamentId: pickResumeTournamentId(active),
    };
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
      const nEntry =
        typeof rEntry?.rowCount === 'number'
          ? rEntry.rowCount
          : Array.isArray(rEntry)
            ? rEntry.length
            : 0;
      totalInserted += Number(nEntry) || 0;
    } catch (e) {
      this.logger.warn(
        '[backfillTournamentPlayersFromEntry] entry',
        (e as Error)?.message,
      );
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
        totalInserted +=
          Number(
            typeof r?.rowCount === 'number'
              ? r.rowCount
              : Array.isArray(r)
                ? r.length
                : 0,
          ) || 0;
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
      const nProgress =
        typeof rProgress?.rowCount === 'number'
          ? rProgress.rowCount
          : Array.isArray(rProgress)
            ? rProgress.length
            : 0;
      totalInserted += Number(nProgress) || 0;
    } catch (e) {
      this.logger.warn(
        '[backfillTournamentPlayersFromEntry] progress',
        (e as Error)?.message,
      );
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
        totalInserted +=
          Number(
            typeof r?.rowCount === 'number'
              ? r.rowCount
              : Array.isArray(r)
                ? r.length
                : 0,
          ) || 0;
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
      totalInserted +=
        Number(
          typeof rOrderPlayers?.rowCount === 'number'
            ? rOrderPlayers.rowCount
            : Array.isArray(rOrderPlayers)
              ? rOrderPlayers.length
              : 0,
        ) || 0;
    } catch (e) {
      this.logger.warn(
        '[backfillTournamentPlayersFromEntry] playerOrder->players',
        (e as Error)?.message,
      );
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
        totalInserted +=
          Number(
            typeof r?.rowCount === 'number'
              ? r.rowCount
              : Array.isArray(r)
                ? r.length
                : 0,
          ) || 0;
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
      totalInserted +=
        Number(
          typeof rOrderEntries?.rowCount === 'number'
            ? rOrderEntries.rowCount
            : Array.isArray(rOrderEntries)
              ? rOrderEntries.length
              : 0,
        ) || 0;
    } catch (e) {
      this.logger.warn(
        '[backfillTournamentPlayersFromEntry] playerOrder->entry',
        (e as Error)?.message,
      );
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
        totalInserted +=
          Number(
            typeof r?.rowCount === 'number'
              ? r.rowCount
              : Array.isArray(r)
                ? r.length
                : 0,
          ) || 0;
      } catch (_) {}
    }
    if (totalInserted > 0)
      this.logger.log(
        `[backfillTournamentPlayersFromEntry] inserted ${totalInserted} rows`,
      );
    return { inserted: totalInserted };
  }

  /** Добавить пару (tournamentId, userId) в join-таблицу без перезаписи связи. Использовать вместо players.push + save(tournament). */
  private async ensureTournamentPlayerWithManager(
    manager: EntityManager,
    tournamentId: number,
    userId: number,
  ): Promise<void> {
    try {
      await manager.query(
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

  private async ensureTournamentPlayer(
    tournamentId: number,
    userId: number,
  ): Promise<void> {
    await this.ensureTournamentPlayerWithManager(
      this.tournamentRepository.manager,
      tournamentId,
      userId,
    );
  }

  /** Для админки: все участия в турнирах по всем игрокам — все поля как у игрока + userId, userNickname, phase, tournament. */
  async getAllParticipationsForAdmin(): Promise<
    {
      tournamentId: number;
      status: string;
      createdAt: string;
      playersCount: number;
      leagueAmount: number | null;
      deadline: string | null;
      userStatus: string;
      stage?: string;
      resultLabel?: string;
      roundForQuestions: string;
      questionsAnswered: number;
      questionsTotal: number;
      correctAnswersInRound: number;
      completedAt?: string | null;
      roundFinished?: boolean;
      roundStartedAt?: string | null;
      stageKind: TournamentStageKind;
      resultKind: TournamentResultKind;
      resultTone: TournamentResultTone;
      listBucket: TournamentListBucket;
      canContinue: boolean;
      isWaitingOpponent: boolean;
      isTimeoutResult: boolean;
      userId: number;
      userNickname: string;
      phase: 'active' | 'history';
      gameType?: 'training' | 'money' | null;
      tournament: {
        id: number;
        name: string;
        type: string | null;
        status: string;
      };
    }[]
  > {
    const progressList = await this.tournamentProgressRepository.find({
      select: ['userId', 'tournamentId'],
    });
    const userIds = [...new Set(progressList.map((p) => p.userId))].filter(
      (id) => id > 0,
    );
    if (userIds.length === 0) return [];

    const users = await this.userRepository.find({
      where: { id: In(userIds) },
      select: ['id', 'username'],
    });
    const nicknameByUserId = new Map(
      users.map((u) => [u.id, u.username ?? `Игрок ${u.id}`]),
    );

    const result: {
      tournamentId: number;
      status: string;
      createdAt: string;
      playersCount: number;
      leagueAmount: number | null;
      deadline: string | null;
      userStatus: string;
      stage?: string;
      resultLabel?: string;
      roundForQuestions: string;
      questionsAnswered: number;
      questionsTotal: number;
      correctAnswersInRound: number;
      completedAt?: string | null;
      roundFinished?: boolean;
      roundStartedAt?: string | null;
      stageKind: TournamentStageKind;
      resultKind: TournamentResultKind;
      resultTone: TournamentResultTone;
      listBucket: TournamentListBucket;
      canContinue: boolean;
      isWaitingOpponent: boolean;
      isTimeoutResult: boolean;
      userId: number;
      userNickname: string;
      phase: 'active' | 'history';
      gameType?: 'training' | 'money' | null;
      tournament: {
        id: number;
        name: string;
        type: string | null;
        status: string;
      };
    }[] = [];
    for (const userId of userIds) {
      try {
        const { active: activeT, completed: completedT } =
          await this.getMyTournaments(userId, 'training');
        const { active: activeM, completed: completedM } =
          await this.getMyTournaments(userId, 'money');
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
            userStatus: item.userStatus,
            stage: item.stage,
            resultLabel: item.resultLabel,
            roundForQuestions: item.roundForQuestions,
            questionsAnswered: item.questionsAnswered,
            questionsTotal: item.questionsTotal,
            correctAnswersInRound: item.correctAnswersInRound,
            roundFinished: item.roundFinished,
            roundStartedAt: item.roundStartedAt ?? null,
            stageKind: item.stageKind,
            resultKind: item.resultKind,
            resultTone: item.resultTone,
            listBucket: item.listBucket,
            canContinue: item.canContinue,
            isWaitingOpponent: item.isWaitingOpponent,
            isTimeoutResult: item.isTimeoutResult,
            userId,
            userNickname: nickname,
            phase: 'active',
            gameType:
              (item.tournament?.type as
                | 'training'
                | 'money'
                | null
                | undefined) ?? null,
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
            userStatus: item.userStatus,
            stage: item.stage,
            resultLabel: item.resultLabel,
            roundForQuestions: item.roundForQuestions,
            questionsAnswered: item.questionsAnswered,
            questionsTotal: item.questionsTotal,
            correctAnswersInRound: item.correctAnswersInRound,
            tournament: item.tournament,
            completedAt: item.completedAt ?? null,
            roundStartedAt: item.roundStartedAt ?? null,
            stageKind: item.stageKind,
            resultKind: item.resultKind,
            resultTone: item.resultTone,
            listBucket: item.listBucket,
            canContinue: item.canContinue,
            isWaitingOpponent: item.isWaitingOpponent,
            isTimeoutResult: item.isTimeoutResult,
            userId,
            userNickname: nickname,
            phase: 'history',
            gameType:
              (item.tournament?.type as
                | 'training'
                | 'money'
                | null
                | undefined) ?? null,
          });
        }
      } catch (e) {
        // Один пользователь не должен ломать весь список
        console.warn('[getAllParticipationsForAdmin] skip user', userId, e);
      }
    }
    result.sort((a, b) => {
      if (a.tournamentId !== b.tournamentId)
        return a.tournamentId - b.tournamentId;
      return a.userId - b.userId;
    });
    return result;
  }

  /** Возвращает состояние турнира для участника (продолжить игру). */
  async getTournamentState(
    userId: number,
    tournamentId: number,
  ): Promise<TournamentStateDto> {
    const tournament = await this.tournamentRepository.findOne({
      where: { id: tournamentId },
      relations: ['players'],
    });
    if (!tournament) throw new NotFoundException('Tournament not found');
    await this.ensureTournamentPlayersLoaded(tournament);
    const order = tournament.playerOrder ?? [];
    if (
      tournament.status !== TournamentStatus.WAITING &&
      tournament.status !== TournamentStatus.ACTIVE
    ) {
      if (tournament.status === TournamentStatus.FINISHED) {
        const progressState = await this.tournamentProgressRepository.findOne({
          where: { userId, tournamentId },
        });
        const normalizedProgressState = this.normalizeProgressSnapshot(
          progressState,
          true,
        );
        const wonSemi =
          progressState && (await this.didUserWinSemiFinal(tournament, userId));
        const mySemiTotalState = progressState
          ? 10 + normalizedProgressState.tiebreakerRounds.length * 10
          : 10;
        if (wonSemi && normalizedProgressState.q < mySemiTotalState + 10) {
          // Доступ к финалу сохранён — не бросаем.
        } else {
          throw new BadRequestException('Tournament is not active');
        }
      } else {
        throw new BadRequestException('Tournament is not active');
      }
    }
    const playerSlot = order.indexOf(userId);
    if (playerSlot < 0)
      throw new BadRequestException('You are not in this tournament');

    const semiIndex = playerSlot < 2 ? 0 : 1;
    const positionInSemi = playerSlot % 2;
    const isCreator = playerSlot === 0;

    const progress = await this.tournamentProgressRepository.findOne({
      where: { userId, tournamentId },
    });
    const normalizedProgress = this.normalizeProgressSnapshot(progress, true);
    const opponentSlot = getOpponentSlot(playerSlot, order.length);
    const oppIdState = opponentSlot != null ? order[opponentSlot] : -1;
    const opponent =
      oppIdState > 0
        ? (tournament.players?.find((p) => p.id === oppIdState) ?? null)
        : null;
    const timeoutResolutionMap =
      await this.getTournamentTimeoutResolutionMap(tournamentId);
    let deadline: string | null = null;
    let tiebreakerRound = 0;
    let tiebreakerQuestions: {
      id: number;
      question: string;
      options: string[];
      correctAnswer: number;
    }[] = [];

    if (opponent && progress) {
      const allProgress = await this.tournamentProgressRepository.find({
        where: { tournamentId },
      });
      const oppProgress = await this.tournamentProgressRepository.findOne({
        where: { userId: opponent.id, tournamentId },
      });
      const normalizedOppProgress = this.normalizeProgressSnapshot(
        oppProgress,
        false,
      );
      const sharedStart = this.getCurrentRoundSharedStart(
        tournament,
        userId,
        progress,
        allProgress,
        timeoutResolutionMap,
      );
      deadline = sharedStart ? this.getRoundDeadline(sharedStart) : null;
      const myQ = normalizedProgress.q;
      const oppQ = normalizedOppProgress.q;
      const semiState = this.getSemiHeadToHeadState(
        myQ,
        normalizedProgress.semiCorrect,
        normalizedProgress.tiebreakerRounds,
        oppQ,
        normalizedOppProgress.semiCorrect,
        normalizedOppProgress.tiebreakerRounds,
      );

      if (semiState.result === 'tie') {
        tiebreakerRound = semiState.tiebreakerRound ?? 1;
        const roundIndex = 2 + tiebreakerRound;
        const existing = await this.questionRepository.find({
          where: { tournament: { id: tournamentId }, roundIndex },
          order: { id: 'ASC' },
        });
        if (existing.length >= this.TIEBREAKER_QUESTIONS) {
          tiebreakerQuestions = existing.map((q) =>
            this.toTrainingQuestionDto(q),
          );
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
  async completeTournament(
    userId: number,
    tournamentId: number,
    passed: boolean,
  ): Promise<{ ok: boolean }> {
    const tournament = await this.tournamentRepository.findOne({
      where: { id: tournamentId },
      relations: ['players'],
    });
    if (!tournament) throw new NotFoundException('Tournament not found');
    await this.ensureTournamentPlayersLoaded(tournament);
    const isPlayer = this.isTournamentParticipant(tournament, userId);
    if (!isPlayer)
      throw new BadRequestException('You are not in this tournament');

    const now = new Date();
    if (!passed && this.isTournamentStructurallyFinishable(tournament)) {
      await this.upsertTournamentResultRow(tournamentId, userId, false, now);
    }

    const allProgress = await this.tournamentProgressRepository.find({
      where: { tournamentId },
    });
    const timeoutResolutionMap =
      await this.getTournamentTimeoutResolutionMap(tournamentId);
    await this.finalizeTournamentIfResolved(
      tournament,
      allProgress,
      timeoutResolutionMap,
      now,
      false,
    );

    return { ok: true };
  }

  private async getTrainingTournamentForUser(
    userId: number,
    tournamentId: number,
  ): Promise<Tournament> {
    const tournament = await this.tournamentRepository.findOne({
      where: { id: tournamentId },
      relations: ['players'],
    });
    if (!tournament) throw new NotFoundException('Tournament not found');
    await this.ensureTournamentPlayersLoaded(tournament);
    const isPlayer = this.isTournamentParticipant(tournament, userId);
    if (!isPlayer)
      throw new BadRequestException('You are not in this tournament');
    return tournament;
  }

  private async loadTournamentQuestions(tournamentId: number): Promise<Question[]> {
    return this.questionRepository.find({
      where: { tournament: { id: tournamentId } },
      order: { roundIndex: 'ASC', id: 'ASC' },
    });
  }

  private mergeTrainingQuestionRows(
    questions: Question[],
    nextRows: Question[],
  ): Question[] {
    const byId = new Map<number, Question>();
    for (const row of questions) byId.set(row.id, row);
    for (const row of nextRows) byId.set(row.id, row);
    return [...byId.values()].sort(
      (a, b) => a.roundIndex - b.roundIndex || a.id - b.id,
    );
  }

  private async ensureSemifinalQuestionRoundsPrepared(
    tournament: Tournament,
  ): Promise<Question[]> {
    let questions = await this.loadTournamentQuestions(tournament.id);
    const semi0Count = questions.filter((q) => q.roundIndex === 0).length;
    const semi1Count = questions.filter((q) => q.roundIndex === 1).length;
    if (
      semi0Count >= this.QUESTIONS_PER_ROUND &&
      semi1Count >= this.QUESTIONS_PER_ROUND
    ) {
      return questions;
    }

    await this.ensureQuestionRound(
      tournament,
      0,
      this.QUESTIONS_PER_ROUND,
      async () => {
        const excludedKeys = await this.getTournamentQuestionKeySet(
          tournament.id,
        );
        return this.pickRandomQuestions(this.QUESTIONS_PER_ROUND, excludedKeys);
      },
    );
    await this.ensureQuestionRound(
      tournament,
      1,
      this.QUESTIONS_PER_ROUND,
      async () => {
        const excludedKeys = await this.getTournamentQuestionKeySet(
          tournament.id,
        );
        return this.pickRandomQuestions(this.QUESTIONS_PER_ROUND, excludedKeys);
      },
    );
    return this.loadTournamentQuestions(tournament.id);
  }

  private async prepareTrainingStateMutations(
    userId: number,
    tournamentId: number,
  ): Promise<void> {
    const tournament = await this.getTrainingTournamentForUser(userId, tournamentId);
    const progress = await this.tournamentProgressRepository.findOne({
      where: { userId, tournamentId },
    });
    let allProgress = await this.tournamentProgressRepository.find({
      where: { tournamentId },
    });
    let timeoutResolutionMap = await this.synchronizeTournamentTimingState(
      tournament,
      allProgress,
      new Date(),
    );
    const progressWriteBlockReason = this.getTournamentProgressWriteBlockReason(
      tournament,
      userId,
      progress,
      allProgress,
      timeoutResolutionMap,
      new Date(),
    );
    if (progressWriteBlockReason) {
      return;
    }

    let questions = await this.ensureSemifinalQuestionRoundsPrepared(tournament);

    let questionsFinal = questions.filter((q) => q.roundIndex === 2);
    if (questionsFinal.length === 0) {
      const wonSemi = await this.didUserWinSemiFinal(tournament, userId);
      if (wonSemi) {
        const finalRows = await this.ensureQuestionRound(
          tournament,
          2,
          this.QUESTIONS_PER_ROUND,
          () => this.pickQuestionsForFinal(tournamentId),
        );
        questions = this.mergeTrainingQuestionRows(questions, finalRows);
        questionsFinal = finalRows;
      }
    }

    const normalizedProgress = this.normalizeProgressSnapshot(progress, true);
    allProgress = await this.tournamentProgressRepository.find({
      where: { tournamentId },
    });
    timeoutResolutionMap = await this.getTournamentTimeoutResolutionMap(
      tournamentId,
    );
    let sharedStart = this.getCurrentRoundSharedStart(
      tournament,
      userId,
      progress,
      allProgress,
      timeoutResolutionMap,
    );

    if (
      questionsFinal.length > 0 &&
      progress &&
      !sharedStart &&
      this.isPlayerInFinalPhase(
        progress,
        allProgress,
        tournament,
        timeoutResolutionMap,
      )
    ) {
      const progressByUser = new Map(allProgress.map((p) => [p.userId, p]));
      const currentPairIndex: 0 | 1 =
        (tournament.playerOrder ?? []).indexOf(userId) < 2 ? 0 : 1;
      const oppositePairIndex: 0 | 1 = currentPairIndex === 0 ? 1 : 0;
      const oppositeSemiState = this.getResolvedSemiPairState(
        tournament,
        oppositePairIndex,
        progressByUser,
        timeoutResolutionMap,
      );
      const otherFinalist = oppositeSemiState.winner;
      if (
        otherFinalist &&
        this.isPlayerInFinalPhase(
          otherFinalist,
          allProgress,
          tournament,
          timeoutResolutionMap,
        )
      ) {
        const nowStart = new Date();
        const mySemiTotalHere =
          this.QUESTIONS_PER_ROUND +
          (progress.tiebreakerRoundsCorrect?.length ?? 0) *
            this.TIEBREAKER_QUESTIONS;
        const otherSemiTotal =
          this.QUESTIONS_PER_ROUND +
          (otherFinalist.tiebreakerRoundsCorrect?.length ?? 0) *
            this.TIEBREAKER_QUESTIONS;
        if (
          (progress.questionsAnsweredCount ?? 0) <
          mySemiTotalHere + this.QUESTIONS_PER_ROUND
        ) {
          progress.roundStartedAt = nowStart;
        }
        if (
          (otherFinalist.questionsAnsweredCount ?? 0) <
          otherSemiTotal + this.QUESTIONS_PER_ROUND
        ) {
          otherFinalist.roundStartedAt = nowStart;
          await this.tournamentProgressRepository.save(otherFinalist);
        }
        await this.tournamentProgressRepository.save(progress);
        allProgress = await this.tournamentProgressRepository.find({
          where: { tournamentId },
        });
        sharedStart = this.getCurrentRoundSharedStart(
          tournament,
          userId,
          progress,
          allProgress,
          timeoutResolutionMap,
        );
      } else {
        const soloFinalist = this.getSoloFinalistByOppositeSemiTimeout(
          tournament,
          allProgress,
          timeoutResolutionMap,
        );
        const mySemiTotalHere =
          this.QUESTIONS_PER_ROUND +
          (progress.tiebreakerRoundsCorrect?.length ?? 0) *
            this.TIEBREAKER_QUESTIONS;
        if (
          soloFinalist?.userId === userId &&
          (progress.questionsAnsweredCount ?? 0) <
            mySemiTotalHere + this.QUESTIONS_PER_ROUND
        ) {
          progress.roundStartedAt = new Date();
          await this.tournamentProgressRepository.save(progress);
        }
      }
    }

    const playerSlotForSemi = (tournament.playerOrder ?? []).indexOf(userId);
    const userSemiIndex =
      playerSlotForSemi >= 0 ? (playerSlotForSemi < 2 ? 0 : 1) : 0;
    const questionsAnsweredCount = normalizedProgress.q;
    const semiResult = await this.computeSemiResult(tournament, userId);

    if (semiResult === 'tie' && progress) {
      const oppSlotTB =
        playerSlotForSemi % 2 === 0
          ? playerSlotForSemi + 1
          : playerSlotForSemi - 1;
      const oppIdTB =
        oppSlotTB >= 0 && oppSlotTB < (tournament.playerOrder?.length ?? 0)
          ? (tournament.playerOrder![oppSlotTB] ?? -1)
          : -1;
      const oppProgress =
        oppIdTB > 0
          ? await this.tournamentProgressRepository.findOne({
              where: { userId: oppIdTB, tournamentId },
            })
          : null;
      const normalizedOppProgress = this.normalizeProgressSnapshot(
        oppProgress,
        false,
      );
      const semiState = this.getSemiHeadToHeadState(
        questionsAnsweredCount,
        normalizedProgress.semiCorrect,
        normalizedProgress.tiebreakerRounds,
        normalizedOppProgress.q,
        normalizedOppProgress.semiCorrect,
        normalizedOppProgress.tiebreakerRounds,
      );
      const tiebreakerRound = semiState.tiebreakerRound ?? 1;
      const roundIndex = 2 + tiebreakerRound;
      const existing = await this.ensureQuestionRound(
        tournament,
        roundIndex,
        this.TIEBREAKER_QUESTIONS,
        async () => {
          const excludedQuestionKeys =
            await this.getTournamentQuestionKeySet(tournamentId);
          return this.pickRandomQuestions(
            this.TIEBREAKER_QUESTIONS,
            excludedQuestionKeys,
          );
        },
      );
      questions = this.mergeTrainingQuestionRows(questions, existing);
    }

    if (semiResult === 'won' && progress) {
      const myTBCount = normalizedProgress.tiebreakerRounds.length;
      const mySemiTotal =
        this.QUESTIONS_PER_ROUND + myTBCount * this.TIEBREAKER_QUESTIONS;
      if (questionsAnsweredCount >= mySemiTotal + this.QUESTIONS_PER_ROUND) {
        const fOrder = tournament.playerOrder ?? [];
        const otherSlots: [number, number] =
          userSemiIndex === 0 ? [2, 3] : [0, 1];
        const fOpp1Id =
          otherSlots[0] < fOrder.length ? fOrder[otherSlots[0]] : -1;
        const fOpp2Id =
          otherSlots[1] < fOrder.length ? fOrder[otherSlots[1]] : -1;
        let finalistProgress: TournamentProgress | null = null;
        if (fOpp1Id > 0 && fOpp2Id > 0) {
          const p1 = await this.tournamentProgressRepository.findOne({
            where: { userId: fOpp1Id, tournamentId },
          });
          const p2 = await this.tournamentProgressRepository.findOne({
            where: { userId: fOpp2Id, tournamentId },
          });
          finalistProgress = this.findSemiWinner(p1, p2);
        }

        if (finalistProgress) {
          const oppTBCount =
            finalistProgress.tiebreakerRoundsCorrect?.length ?? 0;
          const oppSemiTotal =
            this.QUESTIONS_PER_ROUND + oppTBCount * this.TIEBREAKER_QUESTIONS;
          const oppQ = finalistProgress.questionsAnsweredCount ?? 0;
          if (oppQ >= oppSemiTotal + this.QUESTIONS_PER_ROUND) {
            const finalState = this.getFinalHeadToHeadState(
              progress,
              finalistProgress,
            );
            if (finalState.result === 'tie') {
              const ftbRound = finalState.tiebreakerRound ?? 1;
              const roundIndex = 100 + ftbRound;
              const existing = await this.ensureQuestionRound(
                tournament,
                roundIndex,
                this.TIEBREAKER_QUESTIONS,
                async () => {
                  const excludedQuestionKeys =
                    await this.getTournamentQuestionKeySet(tournamentId);
                  return this.pickRandomQuestions(
                    this.TIEBREAKER_QUESTIONS,
                    excludedQuestionKeys,
                  );
                },
              );
              questions = this.mergeTrainingQuestionRows(questions, existing);
            }
          }
        }
      }
    }
  }

  /** Состояние тренировки для продолжения игры (вопросы по раундам + прогресс). */
  async getTrainingState(
    userId: number,
    tournamentId: number,
  ): Promise<TournamentTrainingStateDto> {
    const tournament = await this.getTrainingTournamentForUser(userId, tournamentId);
    const questions = await this.loadTournamentQuestions(tournamentId);

    const questionsSemi1 = questions
      .filter((q) => q.roundIndex === 0)
      .map((q) => this.toTrainingQuestionDto(q));
    const questionsSemi2 = questions
      .filter((q) => q.roundIndex === 1)
      .map((q) => this.toTrainingQuestionDto(q));
    let questionsFinal = questions
      .filter((q) => q.roundIndex === 2)
      .map((q) => this.toTrainingQuestionDto(q));

    const progress = await this.tournamentProgressRepository.findOne({
      where: { userId, tournamentId },
    });
    const normalizedProgress = this.normalizeProgressSnapshot(progress, true);
    let allProgress = await this.tournamentProgressRepository.find({
      where: { tournamentId },
    });
    const timeoutResolutionMap =
      await this.getTournamentTimeoutResolutionMap(tournamentId);
    const sharedStart = this.getCurrentRoundSharedStart(
      tournament,
      userId,
      progress,
      allProgress,
      timeoutResolutionMap,
    );
    const deadline: string | null = sharedStart
      ? this.getRoundDeadline(sharedStart)
      : null;
    const questionsAnsweredCount = normalizedProgress.q;
    const currentQuestionIndex = normalizedProgress.currentIndex;
    const timeLeftSeconds = normalizedProgress.timeLeftSeconds;
    const leftAt = normalizedProgress.leftAt;
    const correctAnswersCount = normalizedProgress.totalCorrect;
    const semiFinalCorrectCount = normalizedProgress.semiCorrect;
    const playerSlotForSemi = (tournament.playerOrder ?? []).indexOf(userId);
    const userSemiIndex =
      playerSlotForSemi >= 0 ? (playerSlotForSemi < 2 ? 0 : 1) : 0;

    // answersChosen — массив выбранных вариантов по вопросам (0–9 полуфинал). Нужен для бейджей «Мой ответ» в просмотре.
    let answersChosen = normalizedProgress.answersChosen;
    if (progress?.id != null && questionsAnsweredCount > 0) {
      const rawRows = await this.tournamentProgressRepository.query(
        'SELECT "answersChosen" FROM tournament_progress WHERE id = $1',
        [progress.id],
      );
      const row = rawRows?.[0];
      const rawVal =
        row?.answersChosen ??
        row?.answers_chosen ??
        (row && (row as any).answerschosen);
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
      const oppSlotTB =
        playerSlotForSemi % 2 === 0
          ? playerSlotForSemi + 1
          : playerSlotForSemi - 1;
      const oppIdTB =
        oppSlotTB >= 0 && oppSlotTB < (tournament.playerOrder?.length ?? 0)
          ? (tournament.playerOrder![oppSlotTB] ?? -1)
          : -1;
      const oppProgress =
        oppIdTB > 0
          ? await this.tournamentProgressRepository.findOne({
              where: { userId: oppIdTB, tournamentId },
            })
          : null;
      const normalizedOppProgress = this.normalizeProgressSnapshot(
        oppProgress,
        false,
      );
      const myQ = questionsAnsweredCount;
      const oppQ = normalizedOppProgress.q;
      const semiState = this.getSemiHeadToHeadState(
        myQ,
        normalizedProgress.semiCorrect,
        normalizedProgress.tiebreakerRounds,
        oppQ,
        normalizedOppProgress.semiCorrect,
        normalizedOppProgress.tiebreakerRounds,
      );

      tiebreakerRound = semiState.tiebreakerRound ?? 1;
      tiebreakerBase =
        this.QUESTIONS_PER_ROUND +
        (tiebreakerRound - 1) * this.TIEBREAKER_QUESTIONS;
      const roundIndex = 2 + tiebreakerRound;
      const existing = questions.filter((q) => q.roundIndex === roundIndex);
      questionsTiebreaker = existing.map((q) => this.toTrainingQuestionDto(q));
    }

    if (semiResult === 'won' && progress) {
      const myTBCount = normalizedProgress.tiebreakerRounds.length;
      const mySemiTotal =
        this.QUESTIONS_PER_ROUND + myTBCount * this.TIEBREAKER_QUESTIONS;
      if (questionsAnsweredCount >= mySemiTotal + this.QUESTIONS_PER_ROUND) {
        const fOrder = tournament.playerOrder ?? [];
        const otherSlots: [number, number] =
          playerSlotForSemi < 2 ? [2, 3] : [0, 1];
        const fOpp1Id =
          otherSlots[0] < fOrder.length ? fOrder[otherSlots[0]] : -1;
        const fOpp2Id =
          otherSlots[1] < fOrder.length ? fOrder[otherSlots[1]] : -1;
        let finalistProgress: TournamentProgress | null = null;
        if (fOpp1Id > 0 && fOpp2Id > 0) {
          const p1 = await this.tournamentProgressRepository.findOne({
            where: { userId: fOpp1Id, tournamentId },
          });
          const p2 = await this.tournamentProgressRepository.findOne({
            where: { userId: fOpp2Id, tournamentId },
          });
          finalistProgress = this.findSemiWinner(p1, p2);
        }

        if (finalistProgress) {
          const oppTBCount =
            finalistProgress.tiebreakerRoundsCorrect?.length ?? 0;
          const oppSemiTotal =
            this.QUESTIONS_PER_ROUND + oppTBCount * this.TIEBREAKER_QUESTIONS;
          const oppQ = finalistProgress.questionsAnsweredCount ?? 0;
          if (oppQ >= oppSemiTotal + this.QUESTIONS_PER_ROUND) {
            const finalState = this.getFinalHeadToHeadState(
              progress,
              finalistProgress,
            );
            if (finalState.result === 'tie') {
              tiebreakerPhase = 'final';
              const ftbRound = finalState.tiebreakerRound ?? 1;
              tiebreakerRound = ftbRound;
              tiebreakerBase =
                mySemiTotal +
                this.QUESTIONS_PER_ROUND +
                (ftbRound - 1) * this.TIEBREAKER_QUESTIONS;
              const roundIndex = 100 + ftbRound;
              const existing = questions.filter((q) => q.roundIndex === roundIndex);
              questionsTiebreaker = existing.map((q) =>
                this.toTrainingQuestionDto(q),
              );
            }
          }
        }
      }
    }

    const semiTiebreakerAllQuestions: (typeof questionsSemi1)[] = [];
    for (let r = 1; r <= 50; r++) {
      const ri = 2 + r;
      const qs = questions
        .filter((q) => q.roundIndex === ri)
        .map((q) => this.toTrainingQuestionDto(q));
      if (qs.length === 0) break;
      semiTiebreakerAllQuestions.push(qs);
    }
    const finalTiebreakerAllQuestions: (typeof questionsSemi1)[] = [];
    for (let r = 1; r <= 50; r++) {
      const ri = 100 + r;
      const qs = questions
        .filter((q) => q.roundIndex === ri)
        .map((q) => this.toTrainingQuestionDto(q));
      if (qs.length === 0) break;
      finalTiebreakerAllQuestions.push(qs);
    }
    const baseReviewRounds = buildTrainingReviewRounds({
      questionsPerRound: this.QUESTIONS_PER_ROUND,
      tiebreakerQuestions: this.TIEBREAKER_QUESTIONS,
      userSemiIndex,
      questionsSemi1,
      questionsSemi2,
      questionsFinal,
      questionsAnsweredCount,
      correctAnswersCount,
      semiFinalCorrectCount,
      semiTiebreakerAllQuestions,
      semiTiebreakerRoundsCorrect: normalizedProgress.tiebreakerRounds,
      finalTiebreakerAllQuestions,
      finalTiebreakerRoundsCorrect: normalizedProgress.finalTiebreakerRounds,
    });
    const reviewRounds = baseReviewRounds
      .filter((round) => (round.questions?.length ?? 0) > 0)
      .map((round, index) => {
        const questionList = round.questions ?? [];
        const roundAnswers = answersChosen.slice(
          round.startIdx,
          round.startIdx + questionList.length,
        );
        while (roundAnswers.length < questionList.length) roundAnswers.push(-1);
        const correctCount = questionList.reduce(
          (sum, question, questionIndex) =>
            sum +
            (roundAnswers[questionIndex] === Number(question.correctAnswer)
              ? 1
              : 0),
          0,
        );
        return {
          ...round,
          correctCount,
          opponentRoundIndex: index,
        };
      });
    const hasVisibleSemiMain = reviewRounds.some(
      (round) => round.stageKind === 'semi' && !round.isTiebreaker,
    );
    const visibleSemiTiebreakerRoundCount = reviewRounds.filter(
      (round) => round.stageKind === 'semi' && round.isTiebreaker,
    ).length;
    const hasVisibleFinalMain = reviewRounds.some(
      (round) => round.stageKind === 'final' && !round.isTiebreaker,
    );
    const visibleFinalTiebreakerRoundCount = reviewRounds.filter(
      (round) => round.stageKind === 'final' && round.isTiebreaker,
    ).length;

    // ---- Opponent answers + info per round (for question review table) ----
    const opponentAnswersByRound: number[][] = [];
    const opponentInfoByRound: {
      id: number;
      nickname: string;
      avatarUrl: string | null;
    }[] = [];
    const fetchOppAC = async (oppUserId: number): Promise<number[]> => {
      const oppProg = await this.tournamentProgressRepository.findOne({
        where: { userId: oppUserId, tournamentId },
      });
      if (!oppProg) return [];
      let ac = this.normalizeAnswersChosen(oppProg.answersChosen);
      if (oppProg.id != null) {
        const rawRows = await this.tournamentProgressRepository.query(
          'SELECT "answersChosen" FROM tournament_progress WHERE id = $1',
          [oppProg.id],
        );
        const rawVal =
          rawRows?.[0]?.answersChosen ?? rawRows?.[0]?.answers_chosen;
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
    const semiOppSlot =
      playerSlotForSemi % 2 === 0
        ? playerSlotForSemi + 1
        : playerSlotForSemi - 1;
    const semiOppIdLookup =
      semiOppSlot >= 0 && semiOppSlot < (tournament.playerOrder?.length ?? 0)
        ? (tournament.playerOrder![semiOppSlot] ?? -1)
        : -1;
    let semiOppAC: number[] = [];
    let semiOppUser: User | null = null;
    if (semiOppIdLookup > 0) {
      semiOppUser =
        tournament.players?.find((p) => p.id === semiOppIdLookup) ?? null;
      if (semiOppUser) semiOppAC = await fetchOppAC(semiOppUser.id);
    }
    const semiOppInfo = semiOppUser
      ? {
          id: semiOppUser.id,
          nickname: getOppNickname(semiOppUser),
          avatarUrl: semiOppUser.avatarUrl ?? null,
        }
      : { id: 0, nickname: '—', avatarUrl: null };
    if (hasVisibleSemiMain) {
      opponentAnswersByRound.push(semiOppAC.slice(0, QPR));
      opponentInfoByRound.push(semiOppInfo);
      for (let r = 0; r < visibleSemiTiebreakerRoundCount; r++) {
        opponentAnswersByRound.push(
          semiOppAC.slice(QPR + r * TBQ, QPR + (r + 1) * TBQ),
        );
        opponentInfoByRound.push(semiOppInfo);
      }
    }

    // Final opponent (winner of the other semi pair)
    if (questionsFinal.length > 0 && hasVisibleFinalMain) {
      const fOtherSlots: [number, number] =
        playerSlotForSemi < 2 ? [2, 3] : [0, 1];
      const fOrder2 = tournament.playerOrder ?? [];
      const fOppId1 =
        fOtherSlots[0] < fOrder2.length ? fOrder2[fOtherSlots[0]] : -1;
      const fOppId2 =
        fOtherSlots[1] < fOrder2.length ? fOrder2[fOtherSlots[1]] : -1;
      const p1 =
        fOppId1 > 0
          ? await this.tournamentProgressRepository.findOne({
              where: { userId: fOppId1, tournamentId },
            })
          : null;
      const p2 =
        fOppId2 > 0
          ? await this.tournamentProgressRepository.findOne({
              where: { userId: fOppId2, tournamentId },
            })
          : null;
      const oppositeSemiResolution =
        this.getOppositeSemiTimeoutResolutionFromMap(
          tournament,
          userId,
          timeoutResolutionMap,
        );
      const finalist = oppositeSemiResolution?.winnerUserId
        ? p1?.userId === oppositeSemiResolution.winnerUserId
          ? p1
          : p2?.userId === oppositeSemiResolution.winnerUserId
            ? p2
            : null
        : this.findSemiWinner(p1, p2);
      if (finalist) {
        const finalistUser =
          (tournament.players ?? []).find((u) => u.id === finalist.userId) ??
          null;
        const finalOppInfo = finalistUser
          ? {
              id: finalistUser.id,
              nickname: getOppNickname(finalistUser),
              avatarUrl: finalistUser.avatarUrl ?? null,
            }
          : { id: 0, nickname: '—', avatarUrl: null };
        const fAC = await fetchOppAC(finalist.userId);
        const fTBCount = finalist.tiebreakerRoundsCorrect?.length ?? 0;
        const fFinalStart = QPR + fTBCount * TBQ;
        opponentAnswersByRound.push(fAC.slice(fFinalStart, fFinalStart + QPR));
        opponentInfoByRound.push(finalOppInfo);
        for (let r = 0; r < visibleFinalTiebreakerRoundCount; r++) {
          opponentAnswersByRound.push(
            fAC.slice(
              fFinalStart + QPR + r * TBQ,
              fFinalStart + QPR + (r + 1) * TBQ,
            ),
          );
          opponentInfoByRound.push(finalOppInfo);
        }
      } else {
        const emptyFinalOppInfo = { id: 0, nickname: '—', avatarUrl: null };
        opponentAnswersByRound.push([]);
        opponentInfoByRound.push(emptyFinalOppInfo);
        for (let r = 0; r < visibleFinalTiebreakerRoundCount; r++) {
          opponentAnswersByRound.push([]);
          opponentInfoByRound.push(emptyFinalOppInfo);
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
      leftAt: leftAt
        ? leftAt instanceof Date
          ? leftAt.toISOString()
          : String(leftAt)
        : null,
      correctAnswersCount,
      semiFinalCorrectCount,
      semiTiebreakerCorrectSum: normalizedProgress.tiebreakerRounds.reduce(
        (a: number, b: number) => a + b,
        0,
      ),
      answersChosen,
      userSemiIndex,
      semiResult,
      semiTiebreakerAllQuestions,
      semiTiebreakerRoundsCorrect: normalizedProgress.tiebreakerRounds,
      finalTiebreakerAllQuestions,
      finalTiebreakerRoundsCorrect: normalizedProgress.finalTiebreakerRounds,
      reviewRounds,
      opponentAnswersByRound,
      opponentInfoByRound,
    };
  }

  async prepareTrainingState(
    userId: number,
    tournamentId: number,
  ): Promise<{ ok: true }> {
    await this.prepareTrainingStateMutations(userId, tournamentId);
    return { ok: true };
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
    if (correctVal == null)
      return { options: opts.length ? opts : ['?'], correctAnswer: 0 };
    const correctStr = String(correctVal);
    if (opts.includes(correctStr)) {
      return { options: opts, correctAnswer: opts.indexOf(correctStr) };
    }
    const newOpts: string[] = [correctStr];
    if (correctVal >= 10) {
      const deltas = [-30, -20, -10, 10, 20, 30].filter(
        (d) => correctVal + d > 0,
      );
      for (let i = deltas.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deltas[i], deltas[j]] = [deltas[j]!, deltas[i]!];
      }
      deltas.forEach((d) => {
        if (newOpts.length < 4 && !newOpts.includes(String(correctVal + d)))
          newOpts.push(String(correctVal + d));
      });
      for (let m = 4; newOpts.length < 4; m++) {
        if (correctVal + m * 10 > 0) newOpts.push(String(correctVal + m * 10));
        else if (correctVal - m * 10 > 0)
          newOpts.push(String(correctVal - m * 10));
      }
    } else {
      const wrong = [-3, -2, -1, 1, 2, 3].filter((d) => correctVal + d > 0);
      wrong.forEach((w) => {
        if (newOpts.length < 4) newOpts.push(String(correctVal + w));
      });
      for (let k = 4; newOpts.length < 4; k++)
        newOpts.push(String(correctVal + k));
    }
    for (let i = newOpts.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newOpts[i], newOpts[j]] = [newOpts[j]!, newOpts[i]!];
    }
    return { options: newOpts, correctAnswer: newOpts.indexOf(correctStr) };
  }

  private toTrainingQuestionDto(q: Question): {
    id: number;
    question: string;
    options: string[];
    correctAnswer: number;
  } {
    const questionText = this.sanitizeUtf8ForDisplay(q.question);
    const fixed = this.ensureQuestionOptions(
      questionText,
      q.options,
      q.correctAnswer,
    );
    return {
      id: q.id,
      question: questionText,
      options: fixed.options.map((o) => this.sanitizeUtf8ForDisplay(String(o))),
      correctAnswer: fixed.correctAnswer,
    };
  }

  private async ensureQuestionRound(
    tournament: Tournament,
    roundIndex: number,
    desiredCount: number,
    createPool: () => Promise<
      Omit<Question, 'id' | 'tournament' | 'roundIndex'>[]
    >,
  ): Promise<Question[]> {
    let existing = await this.questionRepository.find({
      where: { tournament: { id: tournament.id }, roundIndex },
      order: { id: 'ASC' },
    });
    if (existing.length >= desiredCount) {
      return existing;
    }

    const pool = await createPool();
    const missing = Math.max(0, desiredCount - existing.length);
    for (const q of pool.slice(0, missing)) {
      const row = this.questionRepository.create({
        ...q,
        tournament,
        roundIndex,
      });
      await this.questionRepository.save(row);
    }

    existing = await this.questionRepository.find({
      where: { tournament: { id: tournament.id }, roundIndex },
      order: { id: 'ASC' },
    });
    return existing;
  }

  private findSemiWinner(
    p1: TournamentProgress | null,
    p2: TournamentProgress | null,
    allowUnevenResolved = false,
  ): TournamentProgress | null {
    if (!p1 || !p2) return null;
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
    deadlinePassed = false,
  ): boolean {
    return (
      this.getSemiPairTimeoutOutcome(p1, p2, deadlinePassed) === 'both_lost'
    );
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

  private readonly QUESTIONS_PER_ROUND = QUESTIONS_PER_ROUND;
  private readonly TIEBREAKER_QUESTIONS = TIEBREAKER_QUESTIONS;

  private sortPlayersByOrder(tournament: Tournament): void {
    const playerIds = (tournament.players ?? [])
      .map((player) => player.id)
      .filter((id): id is number => Number.isInteger(id) && id > 0);
    const order = (tournament.playerOrder ?? []).filter(
      (id): id is number => Number.isInteger(id) && id > 0,
    );
    if (playerIds.length > 0) {
      const seen = new Set(order);
      const normalizedOrder = [...order];
      for (const id of playerIds) {
        if (!seen.has(id)) {
          normalizedOrder.push(id);
          seen.add(id);
        }
      }
      tournament.playerOrder = normalizedOrder;
    }

    const effectiveOrder = tournament.playerOrder;
    if (
      !effectiveOrder ||
      !tournament.players ||
      tournament.players.length <= 1
    )
      return;
    const orderMap = new Map(effectiveOrder.map((uid, i) => [uid, i]));
    tournament.players.sort(
      (a, b) => (orderMap.get(a.id) ?? 999) - (orderMap.get(b.id) ?? 999),
    );
  }

  private async ensureTournamentPlayersLoaded(
    tournament: Tournament,
  ): Promise<void> {
    const loadedIds = new Set(
      (tournament.players ?? [])
        .map((player) => player.id)
        .filter((id): id is number => Number.isInteger(id) && id > 0),
    );
    const missingIds = (tournament.playerOrder ?? []).filter(
      (id): id is number => Number.isInteger(id) && id > 0 && !loadedIds.has(id),
    );
    if (missingIds.length > 0) {
      const missingPlayers = await this.userRepository.find({
        where: { id: In(missingIds) },
      });
      tournament.players = [...(tournament.players ?? []), ...missingPlayers];
    } else if (!tournament.players) {
      tournament.players = [];
    }
    this.sortPlayersByOrder(tournament);
  }

  /**
   * Определяет, выиграл ли пользователь полуфинал.
   * Финал доступен только после разрешённой пары: есть реальный соперник в слоте,
   * оба прогресса достаточно полны для сравнения и пользователь реально выиграл head-to-head
   * либо прошёл дальше по отдельному timeout-сценарию общей пары.
   */
  private async didUserWinSemiFinal(
    tournament: Tournament,
    userId: number,
  ): Promise<boolean> {
    const order = tournament.playerOrder ?? [];
    const playerSlot = order.indexOf(userId);
    if (playerSlot < 0) return false;
    const opponentSlot = playerSlot % 2 === 0 ? playerSlot + 1 : playerSlot - 1;
    const oppId =
      opponentSlot >= 0 && opponentSlot < order.length
        ? order[opponentSlot]
        : -1;

    if (oppId == null || oppId <= 0) {
      return false;
    }

    // Победитель своей полуфинальной пары может открыть финальные вопросы
    // даже в недобранном money-турнире: отсутствие opposite finalist'а
    // не должно блокировать сам вход в финальный этап.

    const timeoutResolutionMap = await this.getTournamentTimeoutResolutionMap(
      tournament.id,
    );
    const timeoutResolution = this.getOwnSemiTimeoutResolutionFromMap(
      tournament,
      userId,
      timeoutResolutionMap,
    );
    const timeoutOutcome = this.getTimeoutOutcomeForUser(
      timeoutResolution,
      userId,
    );
    if (timeoutOutcome === 'won') return true;
    if (timeoutOutcome === 'lost' || timeoutOutcome === 'both_lost')
      return false;

    const myProgress = await this.tournamentProgressRepository.findOne({
      where: { userId, tournamentId: tournament.id },
    });
    const allProgWin = await this.tournamentProgressRepository.find({
      where: { tournamentId: tournament.id },
    });
    if (this.isPlayerInFinalPhase(myProgress, allProgWin, tournament))
      return true;

    const myQ = myProgress?.questionsAnsweredCount ?? 0;
    const myTBLenW = (myProgress?.tiebreakerRoundsCorrect ?? []).length;
    const mySemiTotalW =
      this.QUESTIONS_PER_ROUND + myTBLenW * this.TIEBREAKER_QUESTIONS;
    if (myQ > mySemiTotalW) {
      const finalQCount = await this.questionRepository.count({
        where: { tournament: { id: tournament.id }, roundIndex: 2 },
      });
      if (finalQCount > 0) return true;
    }

    const oppProgress = await this.tournamentProgressRepository.findOne({
      where: { userId: oppId, tournamentId: tournament.id },
    });
    const oppQ = oppProgress?.questionsAnsweredCount ?? 0;

    if (myQ < this.QUESTIONS_PER_ROUND || oppQ < this.QUESTIONS_PER_ROUND)
      return false;
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
    const myProgress = await this.tournamentProgressRepository.findOne({
      where: { userId, tournamentId: tournament.id },
    });
    const myQ = myProgress?.questionsAnsweredCount ?? 0;

    if (myQ < this.QUESTIONS_PER_ROUND) return 'playing';

    const allProgForCheck = await this.tournamentProgressRepository.find({
      where: { tournamentId: tournament.id },
    });
    if (this.isPlayerInFinalPhase(myProgress, allProgForCheck, tournament))
      return 'won';

    const myTBLenCS = (myProgress?.tiebreakerRoundsCorrect ?? []).length;
    const mySemiTotalCS =
      this.QUESTIONS_PER_ROUND + myTBLenCS * this.TIEBREAKER_QUESTIONS;
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
    const oppId =
      opponentSlot >= 0 && opponentSlot < order.length
        ? order[opponentSlot]
        : -1;
    if (oppId == null || oppId <= 0) return 'waiting';

    const timeoutResolutionMap = await this.getTournamentTimeoutResolutionMap(
      tournament.id,
    );
    const timeoutResolution = this.getOwnSemiTimeoutResolutionFromMap(
      tournament,
      userId,
      timeoutResolutionMap,
    );
    const timeoutOutcome = this.getTimeoutOutcomeForUser(
      timeoutResolution,
      userId,
    );
    if (timeoutOutcome === 'won') return 'won';
    if (timeoutOutcome === 'lost' || timeoutOutcome === 'both_lost')
      return 'lost';

    const oppProgress = await this.tournamentProgressRepository.findOne({
      where: { userId: oppId, tournamentId: tournament.id },
    });
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
    if (!answersChosen || answersChosen.length === 0)
      return { total: 0, semi: 0 };
    const questions = await this.questionRepository.find({
      where: { tournament: { id: tournamentId } },
      order: { roundIndex: 'ASC', id: 'ASC' },
    });
    const semiQuestions = questions.filter(
      (q) => q.roundIndex === semiRoundIndex,
    );
    const semiTiebreakerQuestions = questions
      .filter((q) => q.roundIndex >= 3 && q.roundIndex < 100)
      .sort((a, b) => a.roundIndex - b.roundIndex || a.id - b.id);
    const finalQuestions = questions
      .filter((q) => q.roundIndex === 2)
      .sort((a, b) => a.id - b.id);
    const finalTiebreakerQuestions = questions
      .filter((q) => q.roundIndex >= 100)
      .sort((a, b) => a.roundIndex - b.roundIndex || a.id - b.id);
    const playerQuestions = [
      ...semiQuestions,
      ...semiTiebreakerQuestions,
      ...finalQuestions,
      ...finalTiebreakerQuestions,
    ];
    let total = 0;
    let semi = 0;
    for (
      let i = 0;
      i < answersChosen.length && i < playerQuestions.length;
      i++
    ) {
      if (
        answersChosen[i] >= 0 &&
        answersChosen[i] === playerQuestions[i].correctAnswer
      ) {
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
    const effectivePlayerOrder =
      Array.isArray(tournament.playerOrder) && tournament.playerOrder.length > 0
        ? tournament.playerOrder
        : (tournament.players?.map((player) => player.id) ?? []);
    const playerSlot = effectivePlayerOrder.indexOf(userId);
    const isPlayer = playerSlot >= 0;
    if (!isPlayer)
      throw new BadRequestException('You are not in this tournament');
    let safeCount = Math.max(0, Math.floor(count));
    let safeCurrent =
      currentIndex !== undefined
        ? Math.max(0, Math.min(259, Math.floor(currentIndex)))
        : safeCount;
    const safeTimeLeft =
      timeLeft !== undefined
        ? Math.max(0, Math.min(5, Math.floor(timeLeft)))
        : null;

    const chosenToSave = normalizedChosen.slice(
      0,
      Math.max(safeCount, normalizedChosen.length),
    );

    let progress = await this.tournamentProgressRepository.findOne({
      where: { userId, tournamentId },
    });
    const allProgressBeforeWrite = await this.tournamentProgressRepository.find({
      where: { tournamentId },
    });
    const currentProgressBeforeWrite =
      progress ??
      allProgressBeforeWrite.find((item) => item.userId === userId) ??
      null;
    await this.assertTournamentProgressWritable(
      tournament,
      userId,
      currentProgressBeforeWrite,
      allProgressBeforeWrite,
      new Date(),
    );

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

    const semiRoundIndex = playerSlot < 2 ? 0 : 1;
    const { total: computedCorrect, semi: computedSemi } =
      await this.computeCorrectFromAnswers(
        tournamentId,
        chosenToSave,
        semiRoundIndex,
      );

    if (progress) {
      if (safeCount >= progress.questionsAnsweredCount) {
        progress.questionsAnsweredCount = safeCount;
      }

      const currentLen = progress.answersChosen?.length ?? 0;
      if (
        chosenToSave.length >= currentLen &&
        (chosenToSave.length >= safeCount || chosenToSave.length > currentLen)
      ) {
        progress.answersChosen = chosenToSave;
        progress.correctAnswersCount = Math.max(
          computedCorrect,
          progress.correctAnswersCount,
        );
        if (chosenToSave.length >= this.QUESTIONS_PER_ROUND) {
          progress.semiFinalCorrectCount = Math.max(
            computedSemi,
            progress.semiFinalCorrectCount ?? 0,
          );
        }
      } else if (
        chosenToSave.length >= this.QUESTIONS_PER_ROUND &&
        chosenToSave.length >= currentLen
      ) {
        progress.correctAnswersCount = Math.max(
          computedCorrect,
          progress.correctAnswersCount,
        );
        progress.semiFinalCorrectCount = Math.max(
          computedSemi,
          progress.semiFinalCorrectCount ?? 0,
        );
      } else {
        const fallbackCorrect =
          correctCount !== undefined
            ? Math.max(0, Math.floor(correctCount))
            : null;
        if (
          fallbackCorrect !== null &&
          (progress.correctAnswersCount === 0 ||
            fallbackCorrect > progress.correctAnswersCount)
        ) {
          progress.correctAnswersCount = fallbackCorrect;
        }
      }

      if (progress.semiFinalCorrectCount != null) {
        const currentCorrect = progress.correctAnswersCount;
        const semiTBRounds = progress.tiebreakerRoundsCorrect ?? [];

        const oppSlotForTB =
          playerSlot % 2 === 0 ? playerSlot + 1 : playerSlot - 1;
        const oppPlayerIdForTB =
          oppSlotForTB >= 0 && oppSlotForTB < effectivePlayerOrder.length
            ? effectivePlayerOrder[oppSlotForTB]
            : null;
        let isSemiTied = false;
        if (oppPlayerIdForTB != null && oppPlayerIdForTB > 0) {
          const oppProg = await this.tournamentProgressRepository.findOne({
            where: { userId: oppPlayerIdForTB, tournamentId },
          });
          isSemiTied =
            oppProg?.semiFinalCorrectCount != null &&
            oppProg.semiFinalCorrectCount === progress.semiFinalCorrectCount;
          if (isSemiTied && semiTBRounds.length > 0) {
            const oppTBRounds = oppProg?.tiebreakerRoundsCorrect ?? [];
            for (
              let r = 0;
              r < Math.min(semiTBRounds.length, oppTBRounds.length);
              r++
            ) {
              if ((semiTBRounds[r] ?? 0) !== (oppTBRounds[r] ?? 0)) {
                isSemiTied = false;
                break;
              }
            }
          }
        }

        if (isSemiTied) {
          for (let r = 1; r <= 50; r++) {
            const roundEnd =
              this.QUESTIONS_PER_ROUND + r * this.TIEBREAKER_QUESTIONS;
            if (safeCount === roundEnd && semiTBRounds.length < r) {
              const prevSum = semiTBRounds.reduce((a, b) => a + b, 0);
              const roundCorrect =
                currentCorrect - progress.semiFinalCorrectCount - prevSum;
              progress.tiebreakerRoundsCorrect = [
                ...semiTBRounds,
                Math.max(0, roundCorrect),
              ];
              break;
            }
          }
        }

        const semiTBCount = (progress.tiebreakerRoundsCorrect ?? []).length;
        const semiPhaseTotal =
          this.QUESTIONS_PER_ROUND + semiTBCount * this.TIEBREAKER_QUESTIONS;
        const semiTBSum = (progress.tiebreakerRoundsCorrect ?? []).reduce(
          (a, b) => a + b,
          0,
        );
        const finalTBRounds = progress.finalTiebreakerRoundsCorrect ?? [];
        for (let r = 1; r <= 50; r++) {
          const ftbEnd =
            semiPhaseTotal +
            this.QUESTIONS_PER_ROUND +
            r * this.TIEBREAKER_QUESTIONS;
          if (safeCount === ftbEnd && finalTBRounds.length < r) {
            const prevFTBSum = finalTBRounds.reduce((a, b) => a + b, 0);
            const roundCorrect =
              currentCorrect -
              progress.semiFinalCorrectCount -
              semiTBSum -
              prevFTBSum;
            progress.finalTiebreakerRoundsCorrect = [
              ...finalTBRounds,
              Math.max(0, roundCorrect),
            ];
            break;
          }
        }
      }
      progress.currentQuestionIndex = Math.max(
        safeCurrent,
        progress.currentQuestionIndex,
      );
      if (safeTimeLeft !== null) {
        progress.timeLeftSeconds = safeTimeLeft;
        progress.leftAt = new Date();
      } else {
        progress.timeLeftSeconds = null;
        progress.leftAt = null;
      }

      // Anti-cheat: при answerFinal фиксируем ответы — перезаписать нельзя
      if (answerFinal) {
        progress.lockedAnswerCount = Math.max(
          progress.lockedAnswerCount ?? 0,
          chosenToSave.length,
        );
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
        const freshChosen = this.normalizeAnswersChosen(
          freshRows[0].answersChosen,
        );
        const freshCorrect = Number(freshRows[0].correctAnswersCount) || 0;
        const freshSemiCorrect =
          freshRows[0].semiFinalCorrectCount != null
            ? Number(freshRows[0].semiFinalCorrectCount)
            : null;
        const freshLocked = Number(freshRows[0].lockedAnswerCount) || 0;
        progress.lockedAnswerCount = Math.max(
          progress.lockedAnswerCount ?? 0,
          freshLocked,
        );

        // Защита от перезаписи заблокированных ответов из свежих данных
        const mergedChosen = progress.answersChosen ?? [];
        for (let i = 0; i < Math.min(freshLocked, mergedChosen.length); i++) {
          if (i < freshChosen.length) mergedChosen[i] = freshChosen[i];
        }
        progress.answersChosen = mergedChosen;

        if (freshChosen.length > (progress.answersChosen?.length ?? 0)) {
          progress.answersChosen = freshChosen;
          const { total: recomputedTotal, semi: recomputedSemi } =
            await this.computeCorrectFromAnswers(
              tournamentId,
              freshChosen,
              semiRoundIndex,
            );
          progress.correctAnswersCount = Math.max(
            recomputedTotal,
            freshCorrect,
            progress.correctAnswersCount,
          );
          if (freshChosen.length >= this.QUESTIONS_PER_ROUND) {
            progress.semiFinalCorrectCount = Math.max(
              recomputedSemi,
              freshSemiCorrect ?? 0,
              progress.semiFinalCorrectCount ?? 0,
            );
          }
        } else {
          if (freshCorrect > progress.correctAnswersCount) {
            progress.correctAnswersCount = freshCorrect;
          }
          if (
            freshSemiCorrect != null &&
            (progress.semiFinalCorrectCount == null ||
              freshSemiCorrect > progress.semiFinalCorrectCount)
          ) {
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
        for (let r = 1; r <= semiTBLen + 1; r++)
          boundaries.push(
            this.QUESTIONS_PER_ROUND + r * this.TIEBREAKER_QUESTIONS,
          );
        const fStart =
          this.QUESTIONS_PER_ROUND + semiTBLen * this.TIEBREAKER_QUESTIONS;
        boundaries.push(fStart + this.QUESTIONS_PER_ROUND);
        const finalTBLen = (progress.finalTiebreakerRoundsCorrect ?? []).length;
        for (let r = 1; r <= finalTBLen; r++) {
          boundaries.push(
            fStart + this.QUESTIONS_PER_ROUND + r * this.TIEBREAKER_QUESTIONS,
          );
        }
        for (const b of boundaries) {
          if (prevQ < b && safeCount >= b) {
            progress.roundStartedAt = new Date();
            break;
          }
        }
      }

      await this.tournamentProgressRepository.save(progress);
    } else {
      const fallbackCorrect =
        correctCount !== undefined
          ? Math.max(0, Math.floor(correctCount))
          : null;
      const bestCorrect =
        chosenToSave.length > 0 ? computedCorrect : (fallbackCorrect ?? 0);
      const bestSemi =
        chosenToSave.length >= this.QUESTIONS_PER_ROUND
          ? computedSemi
          : safeCount === this.QUESTIONS_PER_ROUND && fallbackCorrect != null
            ? Math.min(this.QUESTIONS_PER_ROUND, fallbackCorrect)
            : undefined;
      progress = this.tournamentProgressRepository.create({
        userId,
        tournamentId,
        questionsAnsweredCount: safeCount,
        correctAnswersCount: bestCorrect,
        ...(bestSemi !== undefined && { semiFinalCorrectCount: bestSemi }),
        currentQuestionIndex: safeCurrent,
        lockedAnswerCount: answerFinal ? safeCount : 0,
        ...(safeTimeLeft !== null && {
          timeLeftSeconds: safeTimeLeft,
          leftAt: new Date(),
        }),
        ...(chosenToSave.length > 0 && { answersChosen: chosenToSave }),
        roundStartedAt: new Date(),
      });
      await this.tournamentProgressRepository.save(progress);
    }

    if (
      await this.syncTournamentActiveStatusWithManager(
        this.tournamentProgressRepository.manager,
        tournamentId,
      )
    ) {
      tournament.status = TournamentStatus.ACTIVE;
    }

    await this.tryAutoComplete(tournament, userId).catch(() => {});

    return { ok: true };
  }

  /** Автозавершение: после каждого ответа проверяем, определился ли результат. */
  private async tryAutoComplete(
    tournament: Tournament,
    userId: number,
  ): Promise<void> {
    const tournamentId = tournament.id;
    this.sortPlayersByOrder(tournament);

    const order = tournament.playerOrder ?? [];
    const playerSlot = order.indexOf(userId);
    if (playerSlot < 0) return;
    const allProgress = await this.tournamentProgressRepository.find({
      where: { tournamentId },
    });
    const timeoutResolutionMap =
      await this.getTournamentTimeoutResolutionMap(tournamentId);
    await this.finalizeTournamentIfResolved(
      tournament,
      allProgress,
      timeoutResolutionMap,
      new Date(),
      false,
    );
  }

  /** Карта турнира: полуфиналы по бокам, финал в центре. */
  async getTournamentBracket(
    userId: number,
    tournamentId: number,
  ): Promise<TournamentBracketDto> {
    const tournament = await this.tournamentRepository.findOne({
      where: { id: tournamentId },
      relations: ['players'],
    });
    if (!tournament) throw new NotFoundException('Tournament not found');
    await this.ensureTournamentPlayersLoaded(tournament);
    const isPlayer = this.isTournamentParticipant(tournament, userId);
    if (!isPlayer)
      throw new BadRequestException('You are not in this tournament');

    const entries = await this.tournamentEntryRepository.find({
      where: { tournament: { id: tournamentId } },
    });
    const players = tournament.players ?? [];
    let progressList = await this.tournamentProgressRepository.find({
      where: { tournamentId, userId: In(players.map((p) => p.id)) },
    });
    const timeoutResolutionMap =
      await this.getTournamentTimeoutResolutionMap(tournamentId);
    progressList = progressList.map((p) => {
      if (
        p.questionsAnsweredCount === this.QUESTIONS_PER_ROUND &&
        p.semiFinalCorrectCount == null &&
        p.correctAnswersCount != null
      ) {
        return {
          ...p,
          semiFinalCorrectCount: Math.min(
            this.QUESTIONS_PER_ROUND,
            p.correctAnswersCount,
          ),
        };
      }
      return p;
    });
    const progressByUser = new Map(progressList.map((p) => [p.userId, p]));
    const hasWinner =
      (await this.tournamentResultRepository.findOne({
        where: { tournamentId, passed: 1 },
      })) != null;
    const isCompleted =
      tournament.status === TournamentStatus.FINISHED || hasWinner;
    const isActive = !isCompleted;

    const toPlayer = (p: User, isLoser?: boolean) => {
      const prog = progressByUser.get(p.id);
      const q = prog?.questionsAnsweredCount ?? 0;
      const tbRounds = prog?.tiebreakerRoundsCorrect ?? [];
      const semiBaseCorrect =
        prog?.semiFinalCorrectCount != null &&
        prog.semiFinalCorrectCount <= this.QUESTIONS_PER_ROUND
          ? prog.semiFinalCorrectCount
          : q <= this.QUESTIONS_PER_ROUND
            ? (prog?.correctAnswersCount ?? 0)
            : 0;
      const semiTiebreakerCorrectTotal = tbRounds.reduce(
        (a: number, b: number) => a + b,
        0,
      );
      const inFinalPhase = prog
        ? this.isPlayerInFinalPhase(
            prog,
            progressList,
            tournament,
            timeoutResolutionMap,
          )
        : false;
      const completedSemiQuestions =
        this.QUESTIONS_PER_ROUND + tbRounds.length * this.TIEBREAKER_QUESTIONS;
      let semiAnswered = Math.min(q, completedSemiQuestions);
      if (!inFinalPhase && q > completedSemiQuestions) {
        semiAnswered = Math.min(
          q,
          completedSemiQuestions + this.TIEBREAKER_QUESTIONS,
        );
      }
      const semiScore =
        q > 0
          ? inFinalPhase
            ? semiBaseCorrect + semiTiebreakerCorrectTotal
            : (prog?.correctAnswersCount ?? 0)
          : undefined;

      let tiebreakerRound = 0;
      let tiebreakerAnswered = 0;
      let tiebreakerCorrect: number | undefined;
      if (
        !inFinalPhase &&
        q > this.QUESTIONS_PER_ROUND &&
        prog?.semiFinalCorrectCount != null
      ) {
        const completedTBRounds = tbRounds.length;
        const answeredAfterSemi = q - this.QUESTIONS_PER_ROUND;
        const answeredInCompletedRounds =
          completedTBRounds * this.TIEBREAKER_QUESTIONS;
        const inCurrentRound = answeredAfterSemi - answeredInCompletedRounds;
        if (inCurrentRound > 0) {
          tiebreakerRound = completedTBRounds + 1;
          tiebreakerAnswered = Math.min(
            inCurrentRound,
            this.TIEBREAKER_QUESTIONS,
          );
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
      pairIndex: 0 | 1,
      prog0: TournamentProgress | undefined,
      prog1: TournamentProgress | undefined,
    ): 0 | 1 | null => {
      const pairResolution = this.getLatestResolutionFromMap(
        timeoutResolutionMap,
        tournamentId,
        TournamentResolutionStage.SEMI,
        pairIndex,
      );
      if (pairResolution?.outcome === TournamentResolutionOutcome.SLOT_A_WINS)
        return 1;
      if (pairResolution?.outcome === TournamentResolutionOutcome.SLOT_B_WINS)
        return 0;
      if (pairResolution?.outcome === TournamentResolutionOutcome.BOTH_LOST)
        return null;
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
      const loserIndex = getSemiLoserIndex(slot0 < 2 ? 0 : 1, prog0, prog1);
      const semiResolved = this.resolveStageTotals(
        prog0?.questionsAnsweredCount ?? 0,
        prog0?.semiFinalCorrectCount ?? 0,
        prog0?.tiebreakerRoundsCorrect,
        prog1?.questionsAnsweredCount ?? 0,
        prog1?.semiFinalCorrectCount ?? 0,
        prog1?.tiebreakerRoundsCorrect,
        isCompleted,
      );
      const sharedAnswered =
        this.QUESTIONS_PER_ROUND +
        semiResolved.roundsUsed * this.TIEBREAKER_QUESTIONS;
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
      return [player0, player1];
    };

    const enrichFinalPlayer = (
      pl: User,
      prog: TournamentProgress | undefined,
    ) => {
      const q = prog?.questionsAnsweredCount ?? 0;
      const semiCorrect = prog?.semiFinalCorrectCount ?? 0;
      const totalCorrect = prog?.correctAnswersCount ?? 0;
      const semiTBRounds: number[] =
        (prog as any)?.tiebreakerRoundsCorrect ?? [];
      const semiTBSum = semiTBRounds.reduce((a: number, b: number) => a + b, 0);
      const semiPhase =
        this.QUESTIONS_PER_ROUND +
        semiTBRounds.length * this.TIEBREAKER_QUESTIONS;
      const finalAnswered = q > semiPhase ? Math.max(0, q - semiPhase) : 0;
      const finalCorrect =
        q > semiPhase ? Math.max(0, totalCorrect - semiCorrect - semiTBSum) : 0;
      const finalScore = finalAnswered > 0 ? finalCorrect : undefined;
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

    const semi1Players =
      order.length >= 2
        ? toSemiPlayers(0, 1)
        : players.slice(0, 2).map((p) => toPlayer(p));
    const semi2Players = order.length > 2 ? toSemiPlayers(2, 3) : [];

    const semiWinner = (slot0: number, slot1: number): User | null => {
      const pairIndex: 0 | 1 = slot0 < 2 ? 0 : 1;
      const pairResolution = this.getLatestResolutionFromMap(
        timeoutResolutionMap,
        tournamentId,
        TournamentResolutionStage.SEMI,
        pairIndex,
      );
      const uid0 = slot0 < order.length ? order[slot0] : -1;
      const uid1 = slot1 < order.length ? order[slot1] : -1;
      const p0 = uid0 > 0 ? (players.find((p) => p.id === uid0) ?? null) : null;
      const p1 = uid1 > 0 ? (players.find((p) => p.id === uid1) ?? null) : null;
      if (!p0 || !p1) return null;
      if (pairResolution?.outcome === TournamentResolutionOutcome.SLOT_A_WINS)
        return p0;
      if (pairResolution?.outcome === TournamentResolutionOutcome.SLOT_B_WINS)
        return p1;
      if (pairResolution?.outcome === TournamentResolutionOutcome.BOTH_LOST)
        return null;
      const prog0 = progressByUser.get(p0.id);
      const prog1 = progressByUser.get(p1.id);
      const loserIdx = getSemiLoserIndex(pairIndex, prog0, prog1);
      if (loserIdx === 0) return p1;
      if (loserIdx === 1) return p0;
      return null;
    };

    const finalPlayers: {
      id: number;
      username: string;
      nickname?: string | null;
      finalScore?: number;
      finalAnswered?: number;
      finalCorrect?: number;
    }[] = [];
    if (order.length >= 2) {
      const winner1 = semiWinner(0, 1);
      if (winner1)
        finalPlayers.push(
          enrichFinalPlayer(winner1, progressByUser.get(winner1.id)),
        );
    }
    if (order.length >= 4) {
      const winner2 = semiWinner(2, 3);
      if (winner2)
        finalPlayers.push(
          enrichFinalPlayer(winner2, progressByUser.get(winner2.id)),
        );
    }

    const getBracketFinalWinnerId = (): number | null => {
      const finalResolution = this.getLatestResolutionFromMap(
        timeoutResolutionMap,
        tournamentId,
        TournamentResolutionStage.FINAL,
        0,
      );
      if (finalResolution?.winnerUserId) return finalResolution.winnerUserId;
      if (finalResolution?.outcome === TournamentResolutionOutcome.BOTH_LOST)
        return null;
      if (finalPlayers.length === 1) {
        const finalistId = finalPlayers[0]?.id ?? null;
        if (!finalistId) return null;
        const soloFinalist = this.getSoloFinalistByOppositeSemiTimeout(
          tournament,
          progressList,
          timeoutResolutionMap,
        );
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
      const finalState = this.getFinalHeadToHeadState(
        prog0,
        prog1,
        isCompleted,
      );
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
          Math.max(
            0,
            (prog0.questionsAnsweredCount ?? 0) -
              (this.QUESTIONS_PER_ROUND +
                (prog0.tiebreakerRoundsCorrect?.length ?? 0) *
                  this.TIEBREAKER_QUESTIONS),
          ),
          this.getFinalStageBaseCorrect(prog0),
          prog0.finalTiebreakerRoundsCorrect ?? [],
          Math.max(
            0,
            (prog1.questionsAnsweredCount ?? 0) -
              (this.QUESTIONS_PER_ROUND +
                (prog1.tiebreakerRoundsCorrect?.length ?? 0) *
                  this.TIEBREAKER_QUESTIONS),
          ),
          this.getFinalStageBaseCorrect(prog1),
          prog1.finalTiebreakerRoundsCorrect ?? [],
          isCompleted,
        );
        const sharedFinalAnswered =
          this.QUESTIONS_PER_ROUND +
          finalResolved.roundsUsed * this.TIEBREAKER_QUESTIONS;
        finalPlayers[0] = {
          ...p0,
          finalAnswered: sharedFinalAnswered,
          finalScore: finalResolved.myTotal,
          finalCorrect: finalResolved.myTotal,
        };
        finalPlayers[1] = {
          ...p1,
          finalAnswered: sharedFinalAnswered,
          finalScore: finalResolved.oppTotal,
          finalCorrect: finalResolved.oppTotal,
        };
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
    const tids = [
      ...new Set(
        entries
          .map((e) => (e.tournament as any)?.id ?? (e as any).tournamentId)
          .filter((id): id is number => typeof id === 'number' && id > 0),
      ),
    ];
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
        this.logger.warn(
          '[syncTournamentPlayersFromEntry]',
          (e as Error)?.message,
        );
      }
    }
  }

  /** Дозаполняет TournamentEntry для всех игроков в активных турнирах (если записи не было — создаёт с joinedAt = createdAt турнира) */
  async backfillTournamentEntries(): Promise<{ updated: number }> {
    const tournaments = await this.tournamentRepository.find({
      where: [
        { status: TournamentStatus.WAITING },
        { status: TournamentStatus.ACTIVE },
      ],
      relations: ['players'],
    });
    let updated = 0;
    for (const tournament of tournaments) {
      if (!tournament.players?.length) continue;
      const existing = await this.tournamentEntryRepository.find({
        where: { tournament: { id: tournament.id } },
        relations: ['user'],
      });
      const existingUserIds = new Set(
        existing.map((e) => e.user?.id).filter(Boolean),
      );
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
