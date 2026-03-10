import { BadRequestException, forwardRef, Inject, Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Tournament, TournamentStatus, GAME_DEADLINE_HOURS } from './tournament.entity';
import { Question } from './question.entity';
import { QUESTION_POOL, CATEGORIES, QuestionCategory } from './questions-pool';
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

  private getDeadline(from: Date): string {
    const deadline = new Date(from.getTime() + GAME_DEADLINE_HOURS * 60 * 60 * 1000);
    return deadline.toISOString();
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleExpiredEscrowsCron(): Promise<void> {
    try {
      await this.processAllExpiredEscrows();
    } catch (err) {
      this.logger.error('[Cron] processAllExpiredEscrows failed', err);
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
        const entries = await this.tournamentEntryRepository.find({ where: { tournament: { id: tid } } });
        const lastJoinedAt =
          entries.length > 0
            ? entries.reduce((max, e) => (e.joinedAt > max ? e.joinedAt : max), entries[0]!.joinedAt)
            : tournament.createdAt ?? new Date();
        const deadline = this.getDeadline(lastJoinedAt instanceof Date ? lastJoinedAt : new Date(lastJoinedAt));
        if (new Date(deadline) >= new Date()) continue;
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

    const heldEscrows = await this.tournamentEscrowRepository.find({
      where: { tournamentId, status: 'held' },
    });
    if (heldEscrows.length === 0) return;

    const entries = await this.tournamentEntryRepository.find({
      where: { tournament: { id: tournamentId } },
    });
    const lastJoinedAt =
      entries.length > 0
        ? entries.reduce((max, e) => (e.joinedAt > max ? e.joinedAt : max), entries[0]!.joinedAt)
        : tournament.createdAt ?? new Date();
    const deadline = this.getDeadline(lastJoinedAt instanceof Date ? lastJoinedAt : new Date(lastJoinedAt));
    if (new Date(deadline) >= new Date()) return;

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
      for (const e of heldEscrows) {
        e.status = 'paid_to_winner';
        await this.tournamentEscrowRepository.save(e);
      }
    } else {
      for (const e of heldEscrows) {
        await this.usersService.addToBalanceL(
          e.userId,
          e.amount,
          `${getLeagueName(leagueAmount)}, ID ${tournamentId}`,
          'refund',
          tournamentId,
        );
        e.status = 'refunded';
        await this.tournamentEscrowRepository.save(e);
      }
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

  /** Берёт n вопросов, равномерно распределяя по категориям (math/geo/science/culture ≈ 25% каждая). */
  private pickBalanced(n: number): typeof QUESTION_POOL {
    const byCategory = new Map<QuestionCategory, typeof QUESTION_POOL>();
    for (const cat of CATEGORIES) {
      byCategory.set(cat, this.shuffle(QUESTION_POOL.filter((q) => q.category === cat)));
    }
    const perCat = Math.floor(n / CATEGORIES.length);
    const remainder = n - perCat * CATEGORIES.length;
    const out: typeof QUESTION_POOL = [];
    const cats = this.shuffle([...CATEGORIES]);
    cats.forEach((cat, i) => {
      const pool = byCategory.get(cat) ?? [];
      const take = perCat + (i < remainder ? 1 : 0);
      out.push(...pool.slice(0, take));
    });
    return this.shuffle(out);
  }

  private pickRandomQuestions(n: number): Omit<Question, 'id' | 'tournament' | 'roundIndex'>[] {
    return this.pickBalanced(n);
  }

  /** Полуфиналы: одни и те же 10 вопросов в разном порядке. */
  private pickQuestionsForSemi(): {
    semi1: Omit<Question, 'id' | 'tournament' | 'roundIndex'>[];
    semi2: Omit<Question, 'id' | 'tournament' | 'roundIndex'>[];
  } {
    const semiQuestions = this.pickBalanced(10);
    return {
      semi1: semiQuestions,
      semi2: this.shuffle([...semiQuestions]),
    };
  }

  /** Генерирует 10 новых вопросов для финала (вызывается когда игрок прошёл полуфинал). */
  private pickQuestionsForFinal(): Omit<Question, 'id' | 'tournament' | 'roundIndex'>[] {
    return this.pickBalanced(10);
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
    const waitingTournament = waitingTournaments.find((t) => {
      if (t.players.length >= 4) return false;
      if (t.players.some((p) => p.id === userId)) return false;
      const dl = new Date(this.getDeadline(t.createdAt));
      if (dl < now) return false;
      return true;
    });

    let tournament: Tournament;
    let playerSlot: number;
    let isCreator: boolean;
    const joinedAt = new Date();

    if (waitingTournament) {
      tournament = waitingTournament;
      tournament.players.push(user);
      playerSlot = tournament.players.length - 1;
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
      });
      await this.tournamentRepository.save(tournament);
      playerSlot = 0;
      isCreator = true;
      const { semi1, semi2 } = this.pickQuestionsForSemi();
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
      const generated = this.pickQuestionsForSemi();
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
    const deadline = this.getDeadline(gameStartedAt);

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
      const questions = this.generateQuestions();
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
      const dl = this.getDeadline(entry.joinedAt);
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
    const waitingTournament = waitingTournaments.find((t) => {
      if ((t.leagueAmount ?? 0) !== leagueAmount) return false;
      if (t.players.length >= 4) return false;
      if (t.players.some((p) => p.id === userId)) return false;
      const dl = new Date(this.getDeadline(t.createdAt));
      if (dl < now) return false;
      return true;
    });

    let tournament: Tournament;
    let playerSlot: number;
    let isCreator: boolean;

    const joinedAt = new Date();

    if (waitingTournament) {
      tournament = waitingTournament;
      tournament.players.push(user);
      playerSlot = tournament.players.length - 1;
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
      });
      await this.tournamentRepository.save(tournament);
      playerSlot = 0;
      isCreator = true;
      const { semi1, semi2 } = this.pickQuestionsForSemi();
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
      deadline: this.getDeadline(joinedAt),
    };
  }

  async getMyTournaments(
    userId: number,
    mode?: 'training' | 'money',
    currentTournamentId?: number,
  ): Promise<{
    active: { id: number; status: string; createdAt: string; playersCount: number; leagueAmount: number | null; deadline: string; userStatus: 'passed' | 'not_passed'; stage?: string; resultLabel?: string; roundForQuestions: 'semi' | 'final'; questionsAnswered: number; questionsTotal: number; correctAnswersInRound: number }[];
    completed: { id: number; status: string; createdAt: string; playersCount: number; leagueAmount: number | null; userStatus: 'passed' | 'not_passed'; stage?: string; resultLabel?: string; roundForQuestions: 'semi' | 'final'; questionsAnswered: number; questionsTotal: number; correctAnswersInRound: number }[];
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
    if (allIds.length > 0) {
      const results = await this.tournamentResultRepository.find({
        where: { userId, tournamentId: In(allIds) },
      });
      for (const r of results) {
        resultByTournamentId.set(r.tournamentId, r.passed === 1);
      }
    }

    // Backfill: если тренировка завершена (passed=1) И есть второй игрок — помечаем FINISHED.
    // При одном игроке или без нажатия "Завершить турнир" — турнир остаётся в активных.
    const finishedTrainingIds = tournaments
      .filter(
        (t) =>
          t.gameType === 'training' &&
          resultByTournamentId.get(t.id) === true &&
          (t.players?.length ?? 0) >= 2 &&
          t.status !== TournamentStatus.FINISHED,
      )
      .map((t) => t.id);
    if (finishedTrainingIds.length > 0) {
      await this.tournamentRepository.update(
        { id: In(finishedTrainingIds) },
        { status: TournamentStatus.FINISHED },
      );
      for (const t of tournaments) {
        if (finishedTrainingIds.includes(t.id)) t.status = TournamentStatus.FINISHED;
      }
    }

    const deadlineByTournamentId: Record<number, string> = {};
    if (allIds.length > 0) {
      const entries = await this.tournamentEntryRepository
        .createQueryBuilder('e')
        .innerJoinAndSelect('e.tournament', 't')
        .where('e.tournamentId IN (:...ids)', { ids: allIds })
        .getMany();
      const tournamentByTid = new Map(tournaments.map((t) => [t.id, t]));
      for (const tid of allIds) {
        const tournamentEntries = entries.filter((e) => e.tournament.id === tid);
        const lastJoinedAt =
          tournamentEntries.length > 0
            ? tournamentEntries.reduce((max, e) => (e.joinedAt > max ? e.joinedAt : max), tournamentEntries[0]!.joinedAt)
            : null;
        const t = tournamentByTid.get(tid);
        const from = lastJoinedAt ?? t?.createdAt ?? new Date();
        deadlineByTournamentId[tid] = this.getDeadline(from);
      }
    }

    const QUESTIONS_PER_ROUND = 10;
    const TIEBREAKER_QUESTIONS = 5;

    const progressByTid = new Map<
      number,
      { q: number; semiCorrect: number | null; totalCorrect: number; currentIndex: number; tiebreakerRounds: number[] }
    >();
    const progressByTidAndUser = new Map<
      number,
      Map<number, { q: number; semiCorrect: number | null; totalCorrect: number; currentIndex: number; tiebreakerRounds: number[] }>
    >();

    if (allIds.length > 0) {
      const trainingTournamentIds = tournaments.filter((t) => t.gameType === 'training').map((t) => t.id);
      const trainingIdSet = new Set(trainingTournamentIds);

      const moneyTournamentIds = tournaments.filter((t) => t.gameType === 'money').map((t) => t.id);
      const moneyPlayerIds =
        moneyTournamentIds.length > 0
          ? [...new Set(tournaments.filter((t) => t.gameType === 'money').flatMap((t) => (t.players ?? []).map((p) => p.id)))]
          : [];

      const myProgressList = await this.tournamentProgressRepository.find({
        where: { userId, tournamentId: In(allIds) },
      });

      let progressList = myProgressList;
      let othersProgress: TournamentProgress[] = [];
      if (moneyTournamentIds.length > 0 && moneyPlayerIds.length > 0) {
        othersProgress = await this.tournamentProgressRepository.find({
          where: { userId: In(moneyPlayerIds), tournamentId: In(moneyTournamentIds) },
        });
        const myTids = new Set(myProgressList.map((p) => p.tournamentId));
        progressList = [
          ...myProgressList,
          ...othersProgress.filter((p) => !(p.userId === userId && myTids.has(p.tournamentId))),
        ];
      }

      if (trainingTournamentIds.length > 0) {
        const trainingAllProgress = await this.tournamentProgressRepository.find({
          where: { tournamentId: In(trainingTournamentIds) },
        });
        const have = new Set(progressList.map((p) => `${p.tournamentId}:${p.userId}`));
        const toAdd = trainingAllProgress.filter((p) => !have.has(`${p.tournamentId}:${p.userId}`));
        progressList = [...progressList, ...toAdd];
        othersProgress = [...othersProgress, ...toAdd];
      }

      // Backfill для тренировок: исправляем рассинхрон 9/10 и 19/20.
      // Также: currentQuestionIndex >= 10 значит пользователь уже в финале — полуфинал пройден.
      if (trainingTournamentIds.length > 0) {
        await this.tournamentProgressRepository
          .createQueryBuilder()
          .update(TournamentProgress)
          .set({ questionsAnsweredCount: QUESTIONS_PER_ROUND })
          .where('userId = :userId', { userId })
          .andWhere('tournamentId IN (:...ids)', { ids: trainingTournamentIds })
          .andWhere('questionsAnsweredCount = :q', { q: QUESTIONS_PER_ROUND - 1 })
          .andWhere('currentQuestionIndex = :idx', { idx: QUESTIONS_PER_ROUND - 1 })
          .execute();
        await this.tournamentProgressRepository
          .createQueryBuilder()
          .update(TournamentProgress)
          .set({ questionsAnsweredCount: 2 * QUESTIONS_PER_ROUND })
          .where('userId = :userId', { userId })
          .andWhere('tournamentId IN (:...ids)', { ids: trainingTournamentIds })
          .andWhere('questionsAnsweredCount = :q', { q: 2 * QUESTIONS_PER_ROUND - 1 })
          .andWhere('currentQuestionIndex = :idx', { idx: 2 * QUESTIONS_PER_ROUND - 1 })
          .execute();
        // currentQuestionIndex >= 10 = уже в финале, значит все 10 полуфинала отвечены.
        await this.tournamentProgressRepository
          .createQueryBuilder()
          .update(TournamentProgress)
          .set({ questionsAnsweredCount: QUESTIONS_PER_ROUND })
          .where('userId = :userId', { userId })
          .andWhere('tournamentId IN (:...ids)', { ids: trainingTournamentIds })
          .andWhere('currentQuestionIndex >= :minIdx', { minIdx: QUESTIONS_PER_ROUND })
          .andWhere('questionsAnsweredCount < :q', { q: QUESTIONS_PER_ROUND })
          .execute();
      }

      // Исправление бага: 11/20 → 10/10 — пользователь мог ответить на лишний вопрос в финале.
      // Сбрасываем прогресс на 10, если semiFinalCorrectCount уже установлен (полуфинал пройден).
      // Backfill: если 10 ответов, но semiFinalCorrectCount не установлен — восстанавливаем из correctAnswersCount.
      if (allIds.length > 0) {
        const toFix = await this.tournamentProgressRepository.find({
          where: { userId, tournamentId: In(allIds) },
        });
        for (const p of toFix) {
          if (
            p.questionsAnsweredCount === QUESTIONS_PER_ROUND + 1 &&
            (p.currentQuestionIndex ?? 0) >= QUESTIONS_PER_ROUND &&
            p.semiFinalCorrectCount != null
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
        if (p.userId === userId && trainingIdSet.has(p.tournamentId)) {
          if (p.questionsAnsweredCount === QUESTIONS_PER_ROUND - 1 && p.currentQuestionIndex === QUESTIONS_PER_ROUND - 1) {
            adjustedQ = QUESTIONS_PER_ROUND;
          } else if (p.questionsAnsweredCount === 2 * QUESTIONS_PER_ROUND - 1 && p.currentQuestionIndex === 2 * QUESTIONS_PER_ROUND - 1) {
            adjustedQ = 2 * QUESTIONS_PER_ROUND;
          } else if (p.currentQuestionIndex >= QUESTIONS_PER_ROUND - 1 && adjustedQ < QUESTIONS_PER_ROUND) {
            adjustedQ = QUESTIONS_PER_ROUND;
          } else if (p.currentQuestionIndex >= 2 * QUESTIONS_PER_ROUND - 1 && adjustedQ < 2 * QUESTIONS_PER_ROUND) {
            adjustedQ = 2 * QUESTIONS_PER_ROUND;
          }
          // Fallback: currentQuestionIndex = "следующий вопрос" (frontend шлёт totalAnswered) — считаем отвеченными.
          if (p.currentQuestionIndex > 0) {
            adjustedQ = Math.max(adjustedQ, Math.min(p.currentQuestionIndex, 2 * QUESTIONS_PER_ROUND));
          }
          // semiFinalCorrectCount заполняется при 10 ответах — явный признак пройденного этапа.
          if (p.semiFinalCorrectCount != null && adjustedQ < QUESTIONS_PER_ROUND) {
            adjustedQ = Math.max(adjustedQ, QUESTIONS_PER_ROUND);
          }
        }
        const data = {
          q: adjustedQ,
          semiCorrect: p.semiFinalCorrectCount,
          totalCorrect: p.correctAnswersCount ?? 0,
          currentIndex: p.currentQuestionIndex,
          tiebreakerRounds: Array.isArray(p.tiebreakerRoundsCorrect) ? p.tiebreakerRoundsCorrect : [],
        };
        if (p.userId === userId) progressByTid.set(p.tournamentId, data);
        if (!progressByTidAndUser.has(p.tournamentId)) {
          progressByTidAndUser.set(p.tournamentId, new Map());
        }
        progressByTidAndUser.get(p.tournamentId)!.set(p.userId, data);
      }
    }

    const lostSemiByTid = new Map<number, boolean>();

    const getMoneySemiResult = (
      t: Tournament,
    ): { result: 'won' | 'lost' | 'tie' | 'incomplete'; tiebreakerRound?: number } => {
      const playerSlot = t.players?.findIndex((p) => p.id === userId) ?? -1;
      const opponentSlot = playerSlot >= 0 && playerSlot < 4 ? (playerSlot % 2 === 0 ? playerSlot + 1 : playerSlot - 1) : -1;
      const opponent = opponentSlot >= 0 && (t.players?.length ?? 0) > opponentSlot ? t.players![opponentSlot]! : null;
      if (!opponent) return { result: 'incomplete' };

      const myProgress = progressByTidAndUser.get(t.id)?.get(userId);
      const oppProgress = progressByTidAndUser.get(t.id)?.get(opponent.id);
      const myQ = myProgress?.q ?? 0;
      const oppQ = oppProgress?.q ?? 0;
      const mySemi = myProgress?.semiCorrect ?? 0;
      const oppSemi = oppProgress?.semiCorrect ?? 0;
      const myTB = myProgress?.tiebreakerRounds ?? [];
      const oppTB = oppProgress?.tiebreakerRounds ?? [];

      if (myQ < QUESTIONS_PER_ROUND || oppQ < QUESTIONS_PER_ROUND) return { result: 'incomplete' };

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
    ): { q: number; semiCorrect: number | null; totalCorrect: number } | null => {
      const players = t.players ?? [];
      if (players.length < 4) return null;
      const playerSlot = players.findIndex((p) => p.id === userId);
      if (playerSlot < 0) return null;
      const otherSlots: [number, number] = playerSlot < 2 ? [2, 3] : [0, 1];
      const p1 = players[otherSlots[0]];
      const p2 = players[otherSlots[1]];
      if (!p1 || !p2) return null;
      const prog1 = progressByTidAndUser.get(t.id)?.get(p1.id);
      const prog2 = progressByTidAndUser.get(t.id)?.get(p2.id);
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
    };

    const now = new Date();

    for (const t of tournaments) {
      const userProgress = progressByTid.get(t.id);
      const answered = userProgress?.q ?? 0;
      let passed: boolean;
      let row = await this.tournamentResultRepository.findOne({ where: { userId, tournamentId: t.id } });

      // Одинаковая логика для тренировки и противостояния
      const semiResult = getMoneySemiResult(t);
      if (semiResult.result === 'lost') {
        lostSemiByTid.set(t.id, true);
        passed = false;
      } else if (semiResult.result === 'won' && answered >= 20) {
        const otherFin = getOtherFinalist(t);
        if (otherFin === null && (t.players?.length ?? 0) < 4) {
          passed = true;
        } else if (otherFin && otherFin.q >= 2 * QUESTIONS_PER_ROUND) {
          const myFinalCorrect = (userProgress?.totalCorrect ?? 0) - (userProgress?.semiCorrect ?? 0);
          const oppFinalCorrect = otherFin.totalCorrect - (otherFin.semiCorrect ?? 0);
          passed = myFinalCorrect >= oppFinalCorrect;
        } else {
          const deadline = deadlineByTournamentId[t.id] ?? this.getDeadline(t.createdAt);
          passed = new Date(deadline) < now;
        }
      } else {
        passed = row?.passed === 1 ? true : false;
      }

      if (row) {
        row.passed = passed ? 1 : 0;
        await this.tournamentResultRepository.save(row);
      } else {
        row = this.tournamentResultRepository.create({ userId, tournamentId: t.id, passed: passed ? 1 : 0 });
        await this.tournamentResultRepository.save(row);
      }
      resultByTournamentId.set(t.id, passed);
    }

    const getStage = (t: Tournament): string => {
      const userProgress = progressByTid.get(t.id);
      const answered = userProgress?.q ?? 0;

      if (t.gameType === 'training') {
        const allProg = progressByTidAndUser.get(t.id);
        if (allProg && allProg.size >= 2 && answered >= QUESTIONS_PER_ROUND) {
          const mySemi = userProgress?.semiCorrect ?? 0;
          for (const [uid, oppProg] of allProg) {
            if (uid === userId) continue;
            const oppSemi = oppProg?.semiCorrect ?? 0;
            const oppQ = oppProg?.q ?? 0;
            if (oppQ >= QUESTIONS_PER_ROUND && mySemi > oppSemi) return 'Финал';
          }
        }
        return 'Полуфинал';
      }

      const semiResult = getMoneySemiResult(t);
      if (semiResult.result === 'incomplete' || semiResult.result === 'lost') return 'Полуфинал';
      if (semiResult.result === 'tie' && semiResult.tiebreakerRound)
        return `Полуфинал (доп. раунд ${semiResult.tiebreakerRound})`;
      if (semiResult.result === 'won') return 'Финал';
      return 'Полуфинал';
    };

    const toItem = (
      t: Tournament,
      deadline: string,
      userStatus: 'passed' | 'not_passed',
      resultLabel: string,
      roundForQuestions?: 'semi' | 'final',
    ) => {
      const prog = progressByTid.get(t.id);
      const answered = prog?.q ?? 0;
      const semiCorrect = prog?.semiCorrect ?? 0;
      const totalCorrect = prog?.totalCorrect ?? 0;
      const stage = getStage(t);
      const round: 'semi' | 'final' =
        roundForQuestions ?? (stage === 'Полуфинал' || String(stage).startsWith('Полуфинал') ? 'semi' : 'final');
      // Для любого турнира: основной раунд = 10 вопросов. Показываем прогресс по текущему раунду.
      const questionsAnsweredInRound = answered <= 10 ? answered : answered - 10;
      const questionsTotal = 10;
      const correctAnswersInRound =
        answered <= 10
          ? (prog?.semiCorrect != null ? semiCorrect : totalCorrect)
          : Math.max(0, totalCorrect - semiCorrect);
      return {
        id: t.id,
        status: t.status,
        createdAt: t.createdAt instanceof Date ? t.createdAt.toISOString() : String(t.createdAt),
        playersCount: t.players?.length ?? 0,
        leagueAmount: t.leagueAmount ?? null,
        deadline,
        userStatus,
        stage,
        resultLabel,
        roundForQuestions: round,
        questionsAnswered: questionsAnsweredInRound,
        questionsTotal,
        correctAnswersInRound,
      };
    };

    /** Статусы: активные — Этап не пройден, Ожидание соперника; завершённые — Время истекло, Победа, Поражение. */
    const getResultLabel = (t: Tournament): string => {
      if (t.gameType === 'training') {
        const prog = progressByTid.get(t.id);
        const answered = prog?.q ?? 0;
        const currentIndex = prog?.currentIndex ?? 0;
        const allProg = progressByTidAndUser.get(t.id);
        if (allProg && allProg.size >= 2 && answered >= QUESTIONS_PER_ROUND) {
          const mySemi = prog?.semiCorrect ?? 0;
          let bestOppSemi = -1;
          let oppAnswered = 0;
          for (const [uid, oppProg] of allProg) {
            if (uid === userId) continue;
            const os = oppProg?.semiCorrect ?? 0;
            if (os > bestOppSemi) { bestOppSemi = os; oppAnswered = oppProg?.q ?? 0; }
          }
          if (bestOppSemi >= 0 && oppAnswered >= QUESTIONS_PER_ROUND) {
            if (mySemi < bestOppSemi) return 'Поражение';
            if (mySemi > bestOppSemi) {
              if (answered >= 2 * QUESTIONS_PER_ROUND) {
                const players = t.players ?? [];
                if (players.length < 4) return 'Победа';
                const otherFin = getOtherFinalist(t);
                if (!otherFin || otherFin.q < 2 * QUESTIONS_PER_ROUND) return 'Ожидание соперника';
                const myFinalCorrect = (prog?.totalCorrect ?? 0) - (prog?.semiCorrect ?? 0);
                const oppFinalCorrect = otherFin.totalCorrect - (otherFin.semiCorrect ?? 0);
                if (myFinalCorrect > oppFinalCorrect) return 'Победа';
                if (myFinalCorrect < oppFinalCorrect) return 'Поражение';
                return mySemi > (otherFin.semiCorrect ?? 0) ? 'Победа' : 'Поражение';
              }
              return 'Финал';
            }
          }
        }
        if (resultByTournamentId.get(t.id)) return 'Ожидание соперника';
        if (prog && currentIndex >= QUESTIONS_PER_ROUND) return 'Ожидание соперника';
        return answered >= QUESTIONS_PER_ROUND ? 'Ожидание соперника' : 'Этап не пройден';
      }

      const userProgress = progressByTid.get(t.id);
      const answered = userProgress?.q ?? 0;
      if (answered < QUESTIONS_PER_ROUND) return 'Этап не пройден';

      const semiResult = getMoneySemiResult(t);
      if (semiResult.result === 'lost') return 'Поражение';
      if (semiResult.result === 'won') {
        if (answered < 2 * QUESTIONS_PER_ROUND) return 'Ожидание соперника';
        const players = t.players ?? [];
        if (players.length < 4) {
          return resultByTournamentId.get(t.id) ? 'Победа' : 'Поражение';
        }
        const otherFin = getOtherFinalist(t);
        if (!otherFin || otherFin.q < 2 * QUESTIONS_PER_ROUND) return 'Ожидание соперника';
        const myFinalCorrect = (userProgress?.totalCorrect ?? 0) - (userProgress?.semiCorrect ?? 0);
        const oppFinalCorrect = otherFin.totalCorrect - (otherFin.semiCorrect ?? 0);
        if (myFinalCorrect > oppFinalCorrect) return 'Победа';
        if (myFinalCorrect < oppFinalCorrect) return 'Поражение';
        return 'Победа';
      }
      return 'Ожидание соперника';
    };

    const getUserStatus = (t: Tournament): 'passed' | 'not_passed' => {
      if (t.gameType === 'training' && (t.players?.length ?? 0) < 2) {
        const answered = progressByTid.get(t.id)?.q ?? 0;
        return answered >= QUESTIONS_PER_ROUND ? 'passed' : 'not_passed';
      }
      return resultByTournamentId.get(t.id) === true ? 'passed' : 'not_passed';
    };

    const isTimeExpired = (t: Tournament): boolean => {
      const deadline = deadlineByTournamentId[t.id] ?? this.getDeadline(t.createdAt);
      return new Date(deadline) < now;
    };

    const belongsToHistory = (t: Tournament): boolean => {
      const label = getResultLabel(t);
      if (label === 'Поражение' || label === 'Победа') return true;
      if (currentTournamentId === t.id) return false;
      return isTimeExpired(t);
    };

    const getDisplayResultLabel = (t: Tournament, inCompleted: boolean): string => {
      const label = getResultLabel(t);
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

    // Для денег: если выиграл полуфинал — турнир и в активных (есть финал), и в истории (пройден этап).
    const moneySemiWonFinalPending = tournaments.filter(
      (t) =>
        t.gameType === 'money' &&
        getMoneySemiResult(t).result === 'won' &&
        (progressByTid.get(t.id)?.q ?? 0) < 2 * QUESTIONS_PER_ROUND &&
        !belongsToHistory(t),
    );
    const semiWonCompletedItems = moneySemiWonFinalPending.map((t) =>
      toItem(t, deadlineByTournamentId[t.id] ?? '', 'passed', 'Ожидание соперника', 'semi'),
    );

    const activeRaw = activeTournamentsRaw.map((t) =>
      toItem(t, deadlineByTournamentId[t.id] ?? this.getDeadline(t.createdAt), getUserStatus(t), getDisplayResultLabel(t, false)),
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
    if (tournament.status !== TournamentStatus.WAITING && tournament.status !== TournamentStatus.ACTIVE) {
      throw new BadRequestException('Tournament is not active');
    }
    const playerIndex = tournament.players?.findIndex((p) => p.id === userId) ?? -1;
    if (playerIndex < 0) throw new BadRequestException('You are not in this tournament');

    const entries = await this.tournamentEntryRepository.find({
      where: { tournament: { id: tournamentId } },
    });
    const lastJoinedAt =
      entries.length > 0
        ? entries.reduce((max, e) => (e.joinedAt > max ? e.joinedAt : max), entries[0]!.joinedAt)
        : null;
    const from = lastJoinedAt ?? tournament.createdAt ?? new Date();
    const deadline = this.getDeadline(from);

    const playerSlot = playerIndex;
    const semiIndex = playerSlot < 2 ? 0 : 1;
    const positionInSemi = playerSlot % 2;
    const isCreator = playerSlot === 0;

    const progress = await this.tournamentProgressRepository.findOne({ where: { userId, tournamentId } });
    const opponentSlot = playerSlot % 2 === 0 ? playerSlot + 1 : playerSlot - 1;
    const opponent = opponentSlot >= 0 && (tournament.players?.length ?? 0) > opponentSlot ? tournament.players![opponentSlot]! : null;
    let tiebreakerRound = 0;
    let tiebreakerQuestions: { id: number; question: string; options: string[]; correctAnswer: number }[] = [];

    if (opponent && tournament.gameType === 'money' && progress) {
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
              const pool = this.pickRandomQuestions(this.TIEBREAKER_QUESTIONS);
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
    const isPlayer = tournament.players?.some((p) => p.id === userId);
    if (!isPlayer) throw new BadRequestException('You are not in this tournament');

    const QUESTIONS_PER_ROUND = 10;
    let effectivePassed = passed;

    // Тренировка: при "Завершить турнир" (passed=true) проверяем наличие второго игрока,
    // ответившего на 10 вопросов. Если второго нет — статус "Ожидание соперника", этап "Полуфинал",
    // турнир остаётся в активных (passed=0), не уходит в историю.
    if (tournament.gameType === 'training' && passed) {
      const players = tournament.players ?? [];
      if (players.length < 2) {
        effectivePassed = false;
      } else {
        const playerSlot = players.findIndex((p) => p.id === userId);
        const opponentSlot = playerSlot >= 0 && playerSlot < 4 ? (playerSlot % 2 === 0 ? playerSlot + 1 : playerSlot - 1) : -1;
        const opponent = opponentSlot >= 0 && players.length > opponentSlot ? players[opponentSlot]! : null;
        if (!opponent) {
          effectivePassed = false;
        } else {
          const oppProgress = await this.tournamentProgressRepository.findOne({
            where: { userId: opponent.id, tournamentId },
          });
          const oppAnswered = oppProgress?.questionsAnsweredCount ?? 0;
          if (oppAnswered < QUESTIONS_PER_ROUND) {
            effectivePassed = false;
          }
        }
      }
    }

    let result = await this.tournamentResultRepository.findOne({
      where: { userId, tournamentId },
    });
    if (result) {
      result.passed = effectivePassed ? 1 : 0;
      await this.tournamentResultRepository.save(result);
    } else {
      result = this.tournamentResultRepository.create({
        userId,
        tournamentId,
        passed: effectivePassed ? 1 : 0,
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
    questionsAnsweredCount: number;
    currentQuestionIndex: number;
    timeLeftSeconds: number | null;
    leftAt: string | null;
    correctAnswersCount: number;
    semiFinalCorrectCount: number | null;
    answersChosen: number[];
    userSemiIndex: number;
    semiResult: 'playing' | 'won' | 'lost' | 'tie' | 'waiting';
  }> {
    const tournament = await this.tournamentRepository.findOne({
      where: { id: tournamentId },
      relations: ['players'],
    });
    if (!tournament) throw new NotFoundException('Tournament not found');
    const isPlayer = tournament.players?.some((p) => p.id === userId);
    if (!isPlayer) throw new BadRequestException('You are not in this tournament');

    let questions = await this.questionRepository.find({
      where: { tournament: { id: tournamentId } },
      order: { roundIndex: 'ASC', id: 'ASC' },
    });

    if (questions.filter((q) => q.roundIndex === 0).length === 0) {
      const { semi1, semi2 } = this.pickQuestionsForSemi();
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
        const finalPool = this.pickQuestionsForFinal();
        const created: typeof questionsFinal = [];
        for (const q of finalPool) {
          const row = this.questionRepository.create({ ...q, tournament, roundIndex: 2 });
          await this.questionRepository.save(row);
          created.push(toDto(row));
        }
        questionsFinal = created;
      }
    }

    let deadline: string;
    if (tournament.gameType === 'money') {
      try {
        const entries = await this.tournamentEntryRepository.find({
          where: { tournament: { id: tournamentId } } as any,
        });
        const lastJoinedAt =
          entries.length > 0
            ? entries.reduce((max, e) => (e.joinedAt > max ? e.joinedAt : max), entries[0]!.joinedAt)
            : null;
        const from = lastJoinedAt ?? tournament.createdAt ?? new Date();
        deadline = this.getDeadline(from);
      } catch {
        deadline = this.getDeadline(tournament.createdAt ?? new Date());
      }
    } else {
      deadline = this.getDeadline(tournament.createdAt ?? new Date());
    }

    const progress = await this.tournamentProgressRepository.findOne({
      where: { userId, tournamentId },
    });
    const questionsAnsweredCount = progress?.questionsAnsweredCount ?? 0;
    const currentQuestionIndex = progress?.currentQuestionIndex ?? 0;
    const timeLeftSeconds = progress?.timeLeftSeconds ?? null;
    const leftAt = progress?.leftAt ?? null;
    const correctAnswersCount = progress?.correctAnswersCount ?? 0;
    const semiFinalCorrectCount = progress?.semiFinalCorrectCount ?? null;
    const playerIndex = tournament.players?.findIndex((p) => p.id === userId) ?? -1;
    const userSemiIndex = tournament.gameType === 'money' && playerIndex >= 0 ? (playerIndex < 2 ? 0 : 1) : 0;

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

    return {
      tournamentId: tournament.id,
      deadline,
      questionsSemi1,
      questionsSemi2,
      questionsFinal,
      questionsAnsweredCount,
      currentQuestionIndex,
      timeLeftSeconds,
      leftAt: leftAt ? (leftAt instanceof Date ? leftAt.toISOString() : String(leftAt)) : null,
      correctAnswersCount,
      semiFinalCorrectCount,
      answersChosen,
      userSemiIndex,
      semiResult,
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
    const wrong = [correctVal - 2, correctVal - 1, correctVal + 1, correctVal + 2].filter((x) => x !== correctVal && x >= 0);
    const newOpts: string[] = [correctStr];
    wrong.forEach((w) => { if (newOpts.length < 4) newOpts.push(String(w)); });
    for (let k = 1; newOpts.length < 4; k++) {
      if (!newOpts.includes(String(correctVal + k))) newOpts.push(String(correctVal + k));
      else if (correctVal - k >= 0 && !newOpts.includes(String(correctVal - k))) newOpts.push(String(correctVal - k));
    }
    for (let i = newOpts.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newOpts[i], newOpts[j]] = [newOpts[j]!, newOpts[i]!];
    }
    return { options: newOpts, correctAnswer: newOpts.indexOf(correctStr) };
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
  private readonly TIEBREAKER_QUESTIONS = 5;

  /**
   * Определяет, выиграл ли пользователь полуфинал.
   * Тренировка (1 игрок): финал доступен после завершения 10 вопросов полуфинала.
   * Деньги (2+ игрока): финал доступен только если у пользователя больше правильных, чем у оппонента,
   * либо он выиграл тайбрейкер.
   */
  private async didUserWinSemiFinal(tournament: Tournament, userId: number): Promise<boolean> {
    const players = tournament.players ?? [];
    const playerSlot = players.findIndex((p) => p.id === userId);
    if (playerSlot < 0) return false;
    const opponentSlot = playerSlot % 2 === 0 ? playerSlot + 1 : playerSlot - 1;
    if (opponentSlot < 0 || opponentSlot >= players.length) return false;
    const opponent = players[opponentSlot];
    if (!opponent) return false;

    const myProgress = await this.tournamentProgressRepository.findOne({ where: { userId, tournamentId: tournament.id } });
    const oppProgress = await this.tournamentProgressRepository.findOne({ where: { userId: opponent.id, tournamentId: tournament.id } });

    const myQ = myProgress?.questionsAnsweredCount ?? 0;
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

    const playerSlot = players.findIndex((p) => p.id === userId);
    if (playerSlot < 0) return 'playing';
    const opponentSlot = playerSlot % 2 === 0 ? playerSlot + 1 : playerSlot - 1;
    if (opponentSlot < 0 || opponentSlot >= players.length) return 'waiting';
    const opponent = players[opponentSlot];
    if (!opponent) return 'waiting';

    const oppProgress = await this.tournamentProgressRepository.findOne({ where: { userId: opponent.id, tournamentId: tournament.id } });
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

  /** Подсчитать количество верных ответов на основе answersChosen и вопросов турнира. */
  private async computeCorrectFromAnswers(
    tournamentId: number,
    answersChosen: number[],
  ): Promise<{ total: number; semi: number }> {
    if (!answersChosen || answersChosen.length === 0) return { total: 0, semi: 0 };
    const questions = await this.questionRepository.find({
      where: { tournament: { id: tournamentId } },
      order: { roundIndex: 'ASC', id: 'ASC' },
    });
    let total = 0;
    let semi = 0;
    for (let i = 0; i < answersChosen.length && i < questions.length; i++) {
      if (answersChosen[i] >= 0 && answersChosen[i] === questions[i].correctAnswer) {
        total++;
        if (i < this.QUESTIONS_PER_ROUND) semi++;
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
  ): Promise<{ ok: boolean }> {
    const normalizedChosen = this.normalizeAnswersChosen(answersChosen);
    const tournament = await this.tournamentRepository.findOne({
      where: { id: tournamentId },
      relations: ['players'],
    });
    if (!tournament) throw new NotFoundException('Tournament not found');
    const isPlayer = tournament.players?.some((p) => p.id === userId);
    if (!isPlayer) throw new BadRequestException('You are not in this tournament');
    const safeCount = Math.max(0, Math.floor(count));
    const maxIndex = tournament.gameType === 'money' ? 259 : 19;
    const safeCurrent = currentIndex !== undefined ? Math.max(0, Math.min(maxIndex, Math.floor(currentIndex))) : safeCount;
    const safeTimeLeft = timeLeft !== undefined ? Math.max(0, Math.min(5, Math.floor(timeLeft))) : null;

    const chosenToSave = normalizedChosen.slice(0, Math.max(safeCount, normalizedChosen.length));
    const { total: computedCorrect, semi: computedSemi } = await this.computeCorrectFromAnswers(tournamentId, chosenToSave);

    let progress = await this.tournamentProgressRepository.findOne({
      where: { userId, tournamentId },
    });
    if (progress) {
      if (safeCount >= progress.questionsAnsweredCount) {
        progress.questionsAnsweredCount = safeCount;
      }

      const currentLen = progress.answersChosen?.length ?? 0;
      if (chosenToSave.length >= currentLen && (chosenToSave.length >= safeCount || chosenToSave.length > currentLen)) {
        progress.answersChosen = chosenToSave;
        progress.correctAnswersCount = computedCorrect;
        if (chosenToSave.length >= this.QUESTIONS_PER_ROUND) {
          progress.semiFinalCorrectCount = computedSemi;
        }
      } else if (chosenToSave.length >= this.QUESTIONS_PER_ROUND && chosenToSave.length >= currentLen) {
        progress.correctAnswersCount = computedCorrect;
        progress.semiFinalCorrectCount = computedSemi;
      } else {
        const fallbackCorrect = correctCount !== undefined ? Math.max(0, Math.floor(correctCount)) : null;
        if (fallbackCorrect !== null && (progress.correctAnswersCount === 0 || fallbackCorrect > progress.correctAnswersCount)) {
          progress.correctAnswersCount = fallbackCorrect;
        }
      }

      if (tournament.gameType === 'money' && progress.semiFinalCorrectCount != null) {
        const currentCorrect = progress.correctAnswersCount;
        const rounds = progress.tiebreakerRoundsCorrect ?? [];
        for (let r = 1; r <= 50; r++) {
          const roundEnd = this.QUESTIONS_PER_ROUND + r * this.TIEBREAKER_QUESTIONS;
          if (safeCount === roundEnd && rounds.length < r) {
            const prevSum = rounds.reduce((a, b) => a + b, 0);
            const roundCorrect = currentCorrect - progress.semiFinalCorrectCount - prevSum;
            progress.tiebreakerRoundsCorrect = [...rounds, Math.max(0, roundCorrect)];
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

      // Re-read answersChosen from DB right before save to prevent lost-update race condition:
      // another concurrent request may have saved a longer array between our initial read and now.
      const freshRows = await this.tournamentProgressRepository.query(
        'SELECT "answersChosen", "questionsAnsweredCount" FROM tournament_progress WHERE id = $1',
        [progress.id],
      );
      if (freshRows?.[0]) {
        const freshChosen = this.normalizeAnswersChosen(freshRows[0].answersChosen);
        if (freshChosen.length > (progress.answersChosen?.length ?? 0)) {
          progress.answersChosen = freshChosen;
        }
        const freshCount = Number(freshRows[0].questionsAnsweredCount) || 0;
        if (freshCount > progress.questionsAnsweredCount) {
          progress.questionsAnsweredCount = freshCount;
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
        ...(safeTimeLeft !== null && { timeLeftSeconds: safeTimeLeft, leftAt: new Date() }),
        ...(chosenToSave.length > 0 && { answersChosen: chosenToSave }),
      });
      await this.tournamentProgressRepository.save(progress);
    }
    return { ok: true };
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
    semi1: { players: { id: number; username: string; nickname?: string | null; semiScore?: number; questionsAnswered?: number; correctAnswersCount?: number; isLoser?: boolean }[] };
    semi2: { players: { id: number; username: string; nickname?: string | null; semiScore?: number; questionsAnswered?: number; correctAnswersCount?: number; isLoser?: boolean }[] } | null;
    final: { players: { id: number; username: string; nickname?: string | null; finalScore?: number; finalAnswered?: number; finalCorrect?: number }[] };
  }> {
    const tournament = await this.tournamentRepository.findOne({
      where: { id: tournamentId },
      relations: ['players'],
    });
    if (!tournament) throw new NotFoundException('Tournament not found');
    const isPlayer = tournament.players?.some((p) => p.id === userId);
    if (!isPlayer) throw new BadRequestException('You are not in this tournament');

    const entries = await this.tournamentEntryRepository.find({
      where: { tournament: { id: tournamentId } },
    });
    const lastJoinedAt =
      entries.length > 0
        ? entries.reduce((max, e) => (e.joinedAt > max ? e.joinedAt : max), entries[0]!.joinedAt)
        : null;
    const deadline = this.getDeadline(lastJoinedAt ?? tournament.createdAt ?? new Date());
    const isTimeExpired = new Date(deadline) < new Date();
    const hasWinner =
      (await this.tournamentResultRepository.findOne({
        where: { tournamentId, passed: 1 },
      })) != null;
    const isCompleted =
      tournament.status === TournamentStatus.FINISHED || hasWinner || isTimeExpired;
    const isActive = !isCompleted;

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

    const toPlayer = (p: User, isLoser?: boolean) => {
      const prog = progressByUser.get(p.id);
      const q = prog?.questionsAnsweredCount ?? 0;
      // Для полуфинала показываем только верные ответы полуфинала. correctAnswersCount при q>10 — это сумма полуфинал+финал.
      // semiFinalCorrectCount не может быть > 10 — если есть такой баг, игнорируем.
      let semiScore: number | undefined;
      if (prog?.semiFinalCorrectCount != null && prog.semiFinalCorrectCount <= this.QUESTIONS_PER_ROUND) {
        semiScore = prog.semiFinalCorrectCount;
      } else if (q <= this.QUESTIONS_PER_ROUND) {
        semiScore = prog?.correctAnswersCount ?? 0;
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
      const R = 10;
      const T = 5;
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

    const toSemiPlayers = (idx0: number, idx1: number) => {
      const p0 = players[idx0];
      const p1 = players[idx1];
      if (!p0 || !p1) {
        return players.slice(idx0, idx1 + 1).map((p) => toPlayer(p));
      }
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
      prog: { questionsAnsweredCount?: number; correctAnswersCount?: number; semiFinalCorrectCount?: number | null } | undefined,
    ) => {
      const q = prog?.questionsAnsweredCount ?? 0;
      const semiCorrect = prog?.semiFinalCorrectCount ?? 0;
      const totalCorrect = prog?.correctAnswersCount ?? 0;
      const finalAnswered = q > 10 ? Math.min(10, q - 10) : 0;
      const finalCorrect = q > 10 ? (totalCorrect - semiCorrect) : 0;
      const finalScore = q >= 20 ? finalCorrect : undefined;
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

    if (tournament.gameType === 'training') {
      const semi1Players = players.length >= 2 ? toSemiPlayers(0, 1) : players.slice(0, 2).map((p) => toPlayer(p));
      const semi2Players = players.length >= 4 ? toSemiPlayers(2, 3) : players.length > 2 ? players.slice(2, 4).map((p) => toPlayer(p)) : [];
      const finalPlayers: { id: number; username: string; nickname?: string | null; finalScore?: number; finalAnswered?: number; finalCorrect?: number }[] = [];
      if (players.length >= 2) {
        const p0 = progressByUser.get(players[0]!.id);
        const p1 = progressByUser.get(players[1]!.id);
        const s0 = p0?.semiFinalCorrectCount ?? 0;
        const s1 = p1?.semiFinalCorrectCount ?? 0;
        if (p0 && p1 && (p0.questionsAnsweredCount ?? 0) >= 10 && (p1.questionsAnsweredCount ?? 0) >= 10) {
          if (s0 > s1) finalPlayers.push(enrichFinalPlayer(players[0]!, p0));
          else if (s1 > s0) finalPlayers.push(enrichFinalPlayer(players[1]!, p1));
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
      };
    }

    const semi1Players = players.length >= 2 ? toSemiPlayers(0, 1) : players.slice(0, 2).map((p) => toPlayer(p));
    const semi2Players = players.length >= 4 ? toSemiPlayers(2, 3) : players.length > 2 ? players.slice(2, 4).map((p) => toPlayer(p)) : [];
    const finalPlayers: { id: number; username: string; nickname?: string | null; finalScore?: number; finalAnswered?: number; finalCorrect?: number }[] = [];
    if (players.length >= 4) {
      const [p0, p1, p2, p3] = [0, 1, 2, 3].map((i) => progressByUser.get(players[i]!.id));
      const [s0, s1, s2, s3] = [
        p0?.semiFinalCorrectCount ?? 0,
        p1?.semiFinalCorrectCount ?? 0,
        p2?.semiFinalCorrectCount ?? 0,
        p3?.semiFinalCorrectCount ?? 0,
      ];
      const q0 = p0?.questionsAnsweredCount ?? 0;
      const q1 = p1?.questionsAnsweredCount ?? 0;
      const q2 = p2?.questionsAnsweredCount ?? 0;
      const q3 = p3?.questionsAnsweredCount ?? 0;
      if (q0 >= 10 && q1 >= 10 && s0 !== s1) {
        const winner = s0 > s1 ? players[0]! : players[1]!;
        const prog = s0 > s1 ? p0 : p1;
        finalPlayers.push(enrichFinalPlayer(winner, prog));
      }
      if (q2 >= 10 && q3 >= 10 && s2 !== s3) {
        const winner = s2 > s3 ? players[2]! : players[3]!;
        const prog = s2 > s3 ? p2 : p3;
        finalPlayers.push(enrichFinalPlayer(winner, prog));
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

  private generateQuestions(): Omit<Question, 'id' | 'tournament'>[] {
    return [
      { question: 'What is 234 + 567?', options: ['800', '801', '802', '803'], correctAnswer: 1, roundIndex: 0 },
      { question: 'Capital of France?', options: ['London', 'Berlin', 'Paris', 'Madrid'], correctAnswer: 2, roundIndex: 0 },
      { question: 'What is the largest planet?', options: ['Earth', 'Mars', 'Jupiter', 'Saturn'], correctAnswer: 2, roundIndex: 0 },
      { question: 'Who wrote Romeo and Juliet?', options: ['Shakespeare', 'Dickens', 'Hemingway', 'Tolkien'], correctAnswer: 0, roundIndex: 0 },
      { question: 'What is H2O?', options: ['Water', 'Oxygen', 'Hydrogen', 'Carbon'], correctAnswer: 0, roundIndex: 0 },
      { question: 'How many continents are there?', options: ['5', '6', '7', '8'], correctAnswer: 2, roundIndex: 0 },
      { question: 'What color is the sky?', options: ['Green', 'Blue', 'Red', 'Yellow'], correctAnswer: 1, roundIndex: 0 },
      { question: 'What is 120 * 5?', options: ['600', '500', '610', '650'], correctAnswer: 0, roundIndex: 0 },
      { question: 'Who painted the Mona Lisa?', options: ['Van Gogh', 'Picasso', 'Da Vinci', 'Michelangelo'], correctAnswer: 2, roundIndex: 0 },
      { question: 'What is the currency of Japan?', options: ['Yen', 'Won', 'Dollar', 'Euro'], correctAnswer: 0, roundIndex: 0 },
    ];
  }
}