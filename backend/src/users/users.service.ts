import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import {
  DataSource,
  EntityManager,
  In,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { generateReferralCode } from '../common/referral';
import { User } from './user.entity';
import { Transaction, type TransactionCategory } from './transaction.entity';
import { WithdrawalRequest } from './withdrawal-request.entity';
import * as fs from 'fs';
import * as path from 'path';
import {
  LEAGUE_AMOUNTS,
  LEAGUE_NAMES,
  LEAGUE_WINS_TO_UNLOCK,
  QUESTIONS_PER_ROUND,
  TIEBREAKER_QUESTIONS,
  getMinBalanceForLeague,
} from '../tournaments/domain/constants';
import {
  getOpponentSlot,
  parsePlayerOrder,
} from '../tournaments/domain/player-order';
import { type PaymentProvider } from '../payments/payment.entity';
import {
  buildAdminTopupDescription,
  buildApprovedWithdrawalDescription,
  buildPaymentTopupDescription,
  parseAdminTopupDescription,
  parseApprovedWithdrawalDescription,
  parsePaymentTopupDescription,
} from './ruble-ledger-descriptions';
import {
  buildEmptyUserStatsDto,
  type ReferralTreeDto,
  type ReferralTreeNodeDto,
  type UserAdminListItemDto,
  type UserGlobalStatsDto,
  type UserProfileDto,
  type UserStatsDto,
  type UserTransactionDto,
  type UserWithdrawalRequestDto,
  toUserTransactionDto,
  toUserWithdrawalRequestDto,
} from './dto/users-read.dto';

type ComputedBalanceMaps = {
  rubles: Map<number, number>;
  balanceL: Map<number, number>;
  pendingWithdrawals: Map<number, number>;
  heldEscrow: Map<number, number>;
};

type LedgerBalanceState = {
  rubles: number;
  balanceL: number;
};

type LedgerBalanceRow = {
  category: string;
  amount: number | string;
  description: string | null;
  tournamentId: number | null;
};

@Injectable()
export class UsersService implements OnModuleInit {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    @InjectRepository(WithdrawalRequest)
    private readonly withdrawalRepository: Repository<WithdrawalRequest>,
    private readonly dataSource: DataSource,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async onModuleInit(): Promise<void> {
    // Startup should stay read-only. Legacy refund description normalization
    // can be executed as an explicit maintenance action, not on every boot.
  }

  /** При старте приложения переписывает старые описания возвратов за турниры в формат «Возврат за турнир, {лига}, ID {id}». */
  async normalizeRefundDescriptions(): Promise<void> {
    const rows = (await this.dataSource.query(
      `SELECT id, description, "tournamentId" FROM "transaction"
       WHERE category = 'refund' AND description IS NOT NULL AND description != ''`,
    )) as { id: number; description: string; tournamentId: number | null }[];
    const getLeagueName = (amount: number | null): string =>
      amount != null ? (LEAGUE_NAMES[amount] ?? `Лига ${amount} L`) : 'Лига';
    const isOldFormat = (d: string): boolean => {
      const lower = d.toLowerCase();
      return (
        lower.includes('возврат взноса') &&
        (lower.includes('турнир') || lower.includes('№'))
      );
    };
    const extractTid = (d: string, fromRow: number | null): number | null => {
      if (fromRow != null) return fromRow;
      const m = d.match(/турнир\s*№?\s*(\d+)|ID\s*(\d+)/i);
      return m ? parseInt(m[1] ?? m[2] ?? '', 10) || null : null;
    };
    for (const row of rows) {
      if (!isOldFormat(row.description)) continue;
      const tournamentId = extractTid(row.description, row.tournamentId);
      if (tournamentId == null) continue;
      const tournaments = (await this.dataSource.query(
        'SELECT id, "leagueAmount" FROM tournament WHERE id = $1',
        [tournamentId],
      )) as { id: number; leagueAmount: number | null }[];
      const leagueAmount = tournaments[0]?.leagueAmount ?? null;
      const newDescription = `${getLeagueName(leagueAmount)}, ID ${tournamentId}`;
      await this.dataSource.query(
        'UPDATE "transaction" SET description = $1 WHERE id = $2',
        [newDescription, row.id],
      );
    }
  }

  private async getLockedUser(
    manager: EntityManager,
    userId: number,
  ): Promise<User> {
    const user = await manager
      .createQueryBuilder(User, 'user')
      .setLock('pessimistic_write')
      .where('user.id = :userId', { userId })
      .getOne();
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private static applyLedgerTransactionToBalanceState(
    current: LedgerBalanceState,
    row: LedgerBalanceRow,
  ): LedgerBalanceState {
    const next: LedgerBalanceState = {
      rubles: current.rubles,
      balanceL: current.balanceL,
    };
    const amount = Number(row.amount);
    const parsedAdminTopup = UsersService.parseAdminTopupDescription(
      row.description,
    );
    const isLegacyRublesOtherAdminTopup =
      row.category === 'other' && parsedAdminTopup.adminId != null;

    if (
      ['topup', 'admin_credit', 'withdraw', 'refund', 'convert', 'other'].includes(
        row.category,
      )
    ) {
      if (row.category !== 'other' || isLegacyRublesOtherAdminTopup) {
        if (
          !UsersService.isRejectedWithdrawalRefund(
            row.description,
            row.category,
          ) &&
          !UsersService.isNonRublesRefund(
            row.description,
            row.category,
            row.tournamentId,
          )
        ) {
          next.rubles += row.category === 'convert' ? -amount : amount;
        }
      }
    }

    if (
      ['win', 'loss', 'referral', 'other', 'convert', 'refund'].includes(
        row.category,
      )
    ) {
      if (row.category === 'other' && isLegacyRublesOtherAdminTopup) {
        return next;
      }
      if (
        UsersService.isRejectedWithdrawalRefund(row.description, row.category)
      ) {
        return next;
      }
      if (
        row.category === 'refund' &&
        !UsersService.isNonRublesRefund(
          row.description,
          row.category,
          row.tournamentId,
        )
      ) {
        return next;
      }
      next.balanceL += amount;
    }

    return next;
  }

  async getComputedBalanceMapsForUsers(
    userIds: number[],
  ): Promise<ComputedBalanceMaps> {
    const ids = Array.from(
      new Set(
        userIds
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value > 0),
      ),
    );
    const rubles = new Map<number, number>();
    const balanceL = new Map<number, number>();
    const pendingWithdrawals = new Map<number, number>();
    const heldEscrow = new Map<number, number>();

    for (const userId of ids) {
      rubles.set(userId, 0);
      balanceL.set(userId, 0);
      pendingWithdrawals.set(userId, 0);
      heldEscrow.set(userId, 0);
    }

    if (ids.length === 0) {
      return { rubles, balanceL, pendingWithdrawals, heldEscrow };
    }

    const txRows = (await this.dataSource.query(
      `SELECT "userId", category, amount, description, "tournamentId"
       FROM "transaction"
       WHERE "userId" = ANY($1::int[])
         AND category IN ('topup','admin_credit','withdraw','refund','convert','other','win','loss','referral')
       ORDER BY id ASC`,
      [ids],
    )) as {
      userId: number;
      category: string;
      amount: number | string;
      description: string | null;
      tournamentId: number | null;
    }[];

    for (const row of txRows) {
      const userId = Number(row.userId);
      if (!rubles.has(userId) || !balanceL.has(userId)) continue;
      const next = UsersService.applyLedgerTransactionToBalanceState(
        {
          rubles: rubles.get(userId) ?? 0,
          balanceL: balanceL.get(userId) ?? 0,
        },
        row,
      );
      rubles.set(userId, next.rubles);
      balanceL.set(userId, next.balanceL);
    }

    const pendingRows = (await this.dataSource.query(
      `SELECT "userId", COALESCE(SUM(amount), 0) AS total
       FROM withdrawal_request
       WHERE "userId" = ANY($1::int[]) AND status = 'pending'
       GROUP BY "userId"`,
      [ids],
    )) as { userId: number; total: number | string }[];
    for (const row of pendingRows) {
      pendingWithdrawals.set(Number(row.userId), Number(row.total));
    }

    const escrowRows = (await this.dataSource.query(
      `SELECT "userId", COALESCE(SUM(amount), 0) AS total
       FROM tournament_escrow
       WHERE "userId" = ANY($1::int[]) AND status = 'held'
       GROUP BY "userId"`,
      [ids],
    )) as { userId: number; total: number | string }[];
    for (const row of escrowRows) {
      heldEscrow.set(Number(row.userId), Number(row.total));
    }

    for (const userId of ids) {
      rubles.set(
        userId,
        Math.max(
          0,
          (rubles.get(userId) ?? 0) - (pendingWithdrawals.get(userId) ?? 0),
        ),
      );
      balanceL.set(userId, Math.max(0, balanceL.get(userId) ?? 0));
    }

    return { rubles, balanceL, pendingWithdrawals, heldEscrow };
  }

  async reconcileAllStoredBalances(targetUserIds?: number[]): Promise<{
    updatedCount: number;
    affectedUserIds: number[];
  }> {
    const ids =
      targetUserIds && targetUserIds.length > 0
        ? Array.from(
            new Set(
              targetUserIds
                .map((value) => Number(value))
                .filter((value) => Number.isInteger(value) && value > 0),
            ),
          )
        : [];
    const users = await this.userRepository.find({
      where: ids.length > 0 ? { id: In(ids) } : {},
      select: ['id', 'balance', 'balanceRubles'],
      order: { id: 'ASC' },
    });
    if (users.length === 0) {
      return { updatedCount: 0, affectedUserIds: [] };
    }

    const maps = await this.getComputedBalanceMapsForUsers(
      users.map((user) => user.id),
    );
    const affectedUserIds: number[] = [];

    await this.dataSource.transaction(async (manager) => {
      for (const user of users) {
        const nextBalance = maps.balanceL.get(user.id) ?? 0;
        const nextBalanceRubles = maps.rubles.get(user.id) ?? 0;
        if (
          Number(user.balance ?? 0) === nextBalance &&
          Number(user.balanceRubles ?? 0) === nextBalanceRubles
        ) {
          continue;
        }
        await manager.query(
          `UPDATE "user"
           SET balance = $1,
               "balanceRubles" = $2
           WHERE id = $3`,
          [nextBalance, nextBalanceRubles, user.id],
        );
        affectedUserIds.push(user.id);
      }
    });

    return {
      updatedCount: affectedUserIds.length,
      affectedUserIds,
    };
  }

  async findAll(): Promise<UserAdminListItemDto[]> {
    const users = await this.userRepository.find({
      order: { id: 'ASC' },
      select: [
        'id',
        'username',
        'email',
        'nickname',
        'balance',
        'balanceRubles',
        'isAdmin',
        'referralCode',
        'createdAt',
      ],
    });
    const balanceMaps = await this.getComputedBalanceMapsForUsers(
      users.map((user) => user.id),
    );
    return users.map((user) => ({
      id: user.id,
      username: user.username,
      email: user.email,
      nickname: user.nickname ?? null,
      balance: balanceMaps.balanceL.get(user.id) ?? 0,
      balanceRubles: balanceMaps.rubles.get(user.id) ?? 0,
      isAdmin: !!user.isAdmin,
      referralCode: user.referralCode ?? null,
      createdAt: user.createdAt?.toISOString?.() ?? null,
    }));
  }

  create(userData: { username: string; email: string; password: string }) {
    const user = this.userRepository.create(userData);
    return this.userRepository.save(user);
  }

  findById(id: number) {
    return this.userRepository.findOne({ where: { id } });
  }

  findByEmail(email: string) {
    return this.userRepository.findOne({
      where: {
        email: String(email || '')
          .trim()
          .toLowerCase(),
      },
    });
  }

  /**
   * Итоговый рублёвый баланс: учитываются только транзакции, связанные с рублями (₽), не с L.
   * Учитываются: topup (пополнение), legacy admin_credit, withdraw (вывод), convert (₽↔L), refund только по рублям.
   * Не учитываются: возврат по отклонённой заявке на вывод; любые refund, связанные с турнирами/L (взносы, возврат за турнир).
   */
  async getBalanceRublesFromTransactions(userId: number): Promise<number> {
    const rows = (await this.dataSource.query(
      `SELECT category, amount, description, "tournamentId" FROM "transaction"
       WHERE "userId" = $1 AND category IN ('topup','admin_credit','withdraw','refund','convert','other')`,
      [userId],
    )) as {
      category: string;
      amount: number;
      description: string | null;
      tournamentId: number | null;
    }[];
    const list = Array.isArray(rows) ? rows : [];
    let total = 0;
    for (const r of list) {
      const parsedAdminTopup = UsersService.parseAdminTopupDescription(
        r.description,
      );
      const isLegacyRublesOtherAdminTopup =
        r.category === 'other' && parsedAdminTopup.adminId != null;
      if (r.category === 'other' && !isLegacyRublesOtherAdminTopup) continue;
      if (UsersService.isRejectedWithdrawalRefund(r.description, r.category))
        continue;
      if (
        UsersService.isNonRublesRefund(
          r.description,
          r.category,
          r.tournamentId,
        )
      )
        continue;
      total += r.category === 'convert' ? -Number(r.amount) : Number(r.amount);
    }
    return total;
  }

  /**
   * Итоговый L-баланс: учитываются только транзакции, связанные с L.
   * Категории L: win, loss, referral, other, convert (amount as-is).
   * Refund: только турнирные (есть tournamentId), кроме возвратов по отклонённым заявкам.
   * Не учитываются: topup, withdraw, admin_credit (рубли).
   */
  async getBalanceLFromTransactions(userId: number): Promise<number> {
    const rows = (await this.dataSource.query(
      `SELECT category, amount, description, "tournamentId" FROM "transaction"
       WHERE "userId" = $1 AND category IN ('win','loss','referral','other','convert','refund')`,
      [userId],
    )) as {
      category: string;
      amount: number;
      description: string | null;
      tournamentId: number | null;
    }[];
    const list = Array.isArray(rows) ? rows : [];
    let total = 0;
    for (const r of list) {
      const parsedAdminTopup = UsersService.parseAdminTopupDescription(
        r.description,
      );
      if (r.category === 'other' && parsedAdminTopup.adminId != null) continue;
      if (UsersService.isRejectedWithdrawalRefund(r.description, r.category))
        continue;
      if (
        r.category === 'refund' &&
        !UsersService.isNonRublesRefund(
          r.description,
          r.category,
          r.tournamentId,
        )
      )
        continue;
      total += Number(r.amount);
    }
    return Math.max(0, total);
  }

  /** Сумма заявок на вывод в статусе pending (уже снята с баланса, но транзакция withdraw ещё не создана). */
  async getPendingWithdrawalSum(userId: number): Promise<number> {
    const rows = await this.dataSource.query(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM withdrawal_request WHERE "userId" = $1 AND status = $2',
      [userId, 'pending'],
    );
    return rows?.[0]?.total != null ? Number(rows[0].total) : 0;
  }

  /** Итоговый доступный баланс в рублях: по транзакциям минус суммы в pending-заявках на вывод. */
  async getComputedBalanceRubles(userId: number): Promise<number> {
    const fromTx = await this.getBalanceRublesFromTransactions(userId);
    const pending = await this.getPendingWithdrawalSum(userId);
    return Math.max(0, fromTx - pending);
  }

  /** Приводит user.balanceRubles в БД в соответствие с расчётом по транзакциям (и pending-заявкам). */
  async reconcileBalanceRubles(userId: number): Promise<void> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) return;
    const computed = await this.getComputedBalanceRubles(userId);
    const stored = Number(user.balanceRubles ?? 0);
    if (stored !== computed) {
      user.balanceRubles = computed;
      await this.userRepository.save(user);
    }
  }

  /** Принудительно перезаписать баланс в рублях по транзакциям (исправляет рассинхрон). */
  async forceReconcileBalanceRubles(userId: number): Promise<number> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const computed = await this.getComputedBalanceRubles(userId);
    user.balanceRubles = computed;
    await this.userRepository.save(user);
    return computed;
  }

  /** Принудительно перезаписать L-баланс по транзакциям (исправляет рассинхрон). */
  async forceReconcileBalanceL(userId: number): Promise<number> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const computed = await this.getBalanceLFromTransactions(userId);
    user.balance = computed;
    await this.userRepository.save(user);
    return computed;
  }

  private static toLocalDateStr(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private static parseDate(s: string): Date | null {
    if (!s || typeof s !== 'string') return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
    if (!m) return null;
    const d = new Date(
      parseInt(m[1]!, 10),
      parseInt(m[2]!, 10) - 1,
      parseInt(m[3]!, 10),
    );
    return isNaN(d.getTime()) ? null : d;
  }

  async getProfile(userId: number): Promise<UserProfileDto> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const balanceMaps = await this.getComputedBalanceMapsForUsers([userId]);
    const balanceRublesFromTx = balanceMaps.rubles.get(userId) ?? 0;
    const balanceLFromTx = balanceMaps.balanceL.get(userId) ?? 0;
    const reservedBalance = balanceMaps.heldEscrow.get(userId) ?? 0;
    return {
      id: user.id,
      username: user.username,
      nickname: user.nickname ?? null,
      email: user.email,
      balance: balanceLFromTx,
      balanceRubles: balanceRublesFromTx,
      reservedBalance,
      referralCode: user.referralCode ?? null,
      referrerId: user.referrerId ?? null,
      isAdmin: !!user.isAdmin,
      gender: user.gender ?? null,
      birthDate: user.birthDate ?? null,
      avatarUrl: user.avatarUrl ?? null,
      readNewsIds: Array.isArray(user.readNewsIds) ? user.readNewsIds : [],
    };
  }

  async markNewsAsRead(
    userId: number,
    newsId: number,
  ): Promise<{ readNewsIds: number[] }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const current: number[] = Array.isArray(user.readNewsIds)
      ? user.readNewsIds
      : [];
    if (!current.includes(newsId)) {
      current.push(newsId);
      user.readNewsIds = current;
      await this.userRepository.save(user);
    }
    return { readNewsIds: current };
  }

  async updateAvatar(
    userId: number,
    avatarData: string | null,
  ): Promise<{ avatarUrl: string | null }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (avatarData && avatarData.length > 14_000_000) {
      throw new BadRequestException('Файл слишком большой (макс. 10 МБ)');
    }
    user.avatarUrl = avatarData || null;
    await this.userRepository.save(user);
    return { avatarUrl: user.avatarUrl };
  }

  async updateNickname(
    userId: number,
    nickname: string | null,
  ): Promise<{ nickname: string | null }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const trimmed = nickname != null ? nickname.trim().slice(0, 15) : '';
    user.nickname = trimmed || null;
    await this.userRepository.save(user);
    return { nickname: user.nickname };
  }

  async updatePersonal(
    userId: number,
    gender?: string | null,
    birthDate?: string | null,
  ): Promise<{ gender: string | null; birthDate: string | null }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (gender !== undefined) {
      user.gender = gender === 'male' || gender === 'female' ? gender : null;
    }
    if (birthDate !== undefined) {
      if (birthDate && /^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
        user.birthDate = birthDate;
      } else {
        user.birthDate = null;
      }
    }
    await this.userRepository.save(user);
    return { gender: user.gender ?? null, birthDate: user.birthDate ?? null };
  }

  /** Обновляет время последнего нахождения в личном кабинете (для подсчёта «онлайн»). */
  async updateCabinetSeenAt(userId: number): Promise<{ ok: boolean }> {
    await this.userRepository.update(userId, { lastCabinetSeenAt: new Date() });
    return { ok: true };
  }

  /** Read-only: вернуть уже существующий реферальный код без скрытой записи в GET. */
  async getReferralCode(userId: number): Promise<string | null> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return user.referralCode ?? null;
  }

  /** Explicit write-path: создать реферальный код, если его ещё нет. */
  async ensureReferralCode(userId: number): Promise<string> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.referralCode) return user.referralCode;
    let code = generateReferralCode();
    while (
      await this.userRepository.findOne({ where: { referralCode: code } })
    ) {
      code = generateReferralCode();
    }
    user.referralCode = code;
    await this.userRepository.save(user);
    return code;
  }

  /** Древо рефералов: 10 линий. Каждый пользователь возвращается с referrerId для связи родитель–потомок. */
  async getReferralTree(userId: number): Promise<ReferralTreeDto> {
    const MAX_LEVELS = 10;
    const levels: ReferralTreeNodeDto[][] = [];
    const rootId = Number(userId);

    try {
      let parentIds: number[] = [rootId];

      for (let level = 0; level < MAX_LEVELS; level++) {
        if (parentIds.length === 0) {
          levels.push([]);
          continue;
        }
        const users = await this.userRepository
          .createQueryBuilder('u')
          .select([
            'u.id',
            'u.username',
            'u.nickname',
            'u.referrerId',
            'u.avatarUrl',
          ])
          .where('u.referrerId IN (:...ids)', { ids: parentIds })
          .getMany();
        const nextLevel = users.map((u) => {
          let displayName =
            u.nickname && String(u.nickname).trim()
              ? String(u.nickname).trim()
              : String(u.username);
          if (displayName.startsWith('ref_model_'))
            displayName = displayName.slice(0, 10);
          return {
            id: Number(u.id),
            displayName,
            referrerId: u.referrerId != null ? Number(u.referrerId) : null,
            avatarUrl: u.avatarUrl ?? null,
          };
        });
        levels.push(nextLevel);
        parentIds = nextLevel.map((u) => u.id);
      }

      while (levels.length < MAX_LEVELS) {
        levels.push([]);
      }
    } catch (e) {
      console.error('[getReferralTree]', e);
      while (levels.length < MAX_LEVELS) {
        levels.push([]);
      }
    }

    return { rootUserId: rootId, levels };
  }

  /** Создать модель реферальной структуры ~100 человек: случайное число приглашённых (0–3) у каждого, до 10 линий. */
  async seedReferralModel(
    currentUserId: number,
  ): Promise<{ created: number; message: string }> {
    const bcrypt = await import('bcryptjs');
    const hash = (p: string) => bcrypt.hash(p, 10);
    const prefix = `ref_model_${Date.now()}_`;
    let created = 0;
    const TARGET = 100;
    const MAX_DEPTH = 10;

    const addUser = async (referrerId: number): Promise<number> => {
      const username = `${prefix}${created + 1}`;
      const user = this.userRepository.create({
        username,
        email: `${username}@test.local`,
        password: await hash('test123'),
        referralCode: `${username}_${Math.random().toString(36).slice(2, 9)}`,
        referrerId,
      });
      const saved = await this.userRepository.save(user);
      created++;
      return saved.id;
    };

    type Item = { parentId: number; depth: number };
    const queue: Item[] = [{ parentId: currentUserId, depth: 0 }];

    while (created < TARGET && queue.length > 0) {
      const { parentId, depth } = queue.shift()!;
      if (depth >= MAX_DEPTH) continue;
      const remaining = TARGET - created;
      if (remaining <= 0) break;
      const maxThis = Math.min(remaining, 4);
      const numChildren =
        maxThis === 0
          ? 0
          : Math.max(1, Math.floor(Math.random() * (maxThis + 1)));
      for (let i = 0; i < numChildren && created < TARGET; i++) {
        const id = await addUser(parentId);
        queue.push({ parentId: id, depth: depth + 1 });
      }
    }

    return {
      created,
      message: `Создана модель: ${created} человек в случайной структуре до ${MAX_DEPTH} линий.`,
    };
  }

  /** Транзакции «Возврат по отклонённой заявке» не показываем и не учитываем в балансе (деньги формально оставались у игрока). */
  private static isRejectedWithdrawalRefund(
    description: string | null,
    category: string,
  ): boolean {
    if (category !== 'refund' || !description) return false;
    const d = description.toLowerCase().replace(/ё/g, 'е');
    return (
      (d.includes('отклонен') &&
        (d.includes('заявк') || d.includes('вывод'))) ||
      d.includes('возврат по отклонен') ||
      (d.includes('возврат') &&
        d.includes('заявк') &&
        (d.includes('вывод') || d.includes('отклонен')))
    );
  }

  /** Refund, связанные с L/турнирами: не учитывать в балансе в рублях (только рублёвые движения). */
  private static isNonRublesRefund(
    description: string | null,
    category: string,
    tournamentId?: number | null,
  ): boolean {
    if (category !== 'refund') return false;
    if (tournamentId != null) return true;
    if (!description) return false;
    const d = description.toLowerCase().replace(/ё/g, 'е');
    return (
      d.includes('турнир') ||
      d.includes('возврат за турнир') ||
      d.includes('возврат взноса') ||
      d.includes('лига')
    );
  }

  async getTransactions(userId: number): Promise<UserTransactionDto[]> {
    const list = await this.transactionRepository.find({
      where: { userId },
      order: { id: 'ASC' },
    });
    let running: LedgerBalanceState = { rubles: 0, balanceL: 0 };
    const dtoList = list
      .filter(
        (t) =>
          !UsersService.isRejectedWithdrawalRefund(t.description, t.category),
      )
      .map((transaction) => {
        running = UsersService.applyLedgerTransactionToBalanceState(running, {
          category: transaction.category ?? 'other',
          amount: transaction.amount ?? 0,
          description: transaction.description ?? null,
          tournamentId: transaction.tournamentId ?? null,
        });
        return toUserTransactionDto(transaction, running);
      });
    return dtoList.reverse();
  }

  /**
   * Распределяет реферальные начисления при победе реферала в турнире.
   * Формула: 4 × стоимость участия × % линии. Линия 1 — 2,36 %, линии 2–10 — 0,11 %.
   * Округление вниз до 2 знаков после запятой.
   * Начисление только тем, кто есть в цепочке — если вышестоящих меньше 10, платим только им.
   */
  async distributeReferralRewards(
    winnerId: number,
    leagueAmount: number,
    tournamentId: number,
  ): Promise<void> {
    const baseAmount = 4 * leagueAmount;
    const LINE1_PCT = 0.0236;
    const LINE2_10_PCT = 0.0011;

    let currentUserId: number | null = winnerId;
    for (let line = 1; line <= 10; line++) {
      const u = currentUserId
        ? await this.userRepository.findOne({
            where: { id: currentUserId },
            select: ['id', 'referrerId'],
          })
        : null;
      if (!u?.referrerId) break;

      const referrerId: number = Number(u.referrerId);
      const pct = line === 1 ? LINE1_PCT : LINE2_10_PCT;
      const rawReward = baseAmount * pct;
      const reward = Math.floor(rawReward * 100) / 100;

      if (reward > 0) {
        await this.addToBalanceL(
          referrerId,
          reward,
          `Реферал (линия ${line}) выиграл турнир, ID ${tournamentId}`,
          'referral',
          tournamentId,
        );
      }

      currentUserId = referrerId;
    }
  }

  async addTransaction(
    userId: number,
    amount: number,
    description: string,
    category: TransactionCategory = 'other',
    tournamentId?: number,
  ) {
    const transaction = this.transactionRepository.create({
      userId,
      amount,
      description,
      category,
      ...(tournamentId != null && { tournamentId }),
    });
    return this.transactionRepository.save(transaction);
  }

  async addTransactionWithManager(
    manager: EntityManager,
    userId: number,
    amount: number,
    description: string,
    category: TransactionCategory = 'other',
    tournamentId?: number,
  ) {
    const transaction = manager.create(Transaction, {
      userId,
      amount,
      description,
      category,
      ...(tournamentId != null && { tournamentId }),
    });
    return manager.save(transaction);
  }

  static buildAdminTopupDescription(
    adminId: number,
    comment?: string | null,
  ): string {
    return buildAdminTopupDescription(adminId, comment);
  }

  static parseAdminTopupDescription(description: string | null | undefined): {
    adminId: number | null;
    comment: string | null;
  } {
    return parseAdminTopupDescription(description);
  }

  static buildPaymentTopupDescription(
    provider: PaymentProvider,
    paymentId: number,
    externalId?: string | null,
  ): string {
    return buildPaymentTopupDescription(provider, paymentId, externalId);
  }

  static parsePaymentTopupDescription(description: string | null | undefined): {
    provider: PaymentProvider | null;
    paymentId: number | null;
    externalId: string | null;
  } {
    return parsePaymentTopupDescription(description);
  }

  static buildApprovedWithdrawalDescription(requestId: number): string {
    return buildApprovedWithdrawalDescription(requestId);
  }

  static parseApprovedWithdrawalDescription(
    description: string | null | undefined,
  ): { requestId: number | null } {
    return parseApprovedWithdrawalDescription(description);
  }

  async creditRublesWithManager(
    manager: EntityManager,
    userId: number,
    amount: number,
    description: string,
  ): Promise<User> {
    if (amount <= 0)
      throw new BadRequestException('Сумма должна быть положительной');
    const user = await this.getLockedUser(manager, userId);
    user.balanceRubles = Number(user.balanceRubles ?? 0) + amount;
    await manager.save(user);
    await this.addTransactionWithManager(
      manager,
      userId,
      amount,
      description,
      'topup',
    );
    return user;
  }

  async addManualAdminTopup(
    adminId: number,
    targetUserId: number,
    amount: number,
    comment?: string | null,
  ): Promise<{ success: true; newBalanceRubles: number }> {
    return this.dataSource.transaction(async (manager) => {
      const user = await this.creditRublesWithManager(
        manager,
        targetUserId,
        amount,
        UsersService.buildAdminTopupDescription(adminId, comment),
      );
      return {
        success: true as const,
        newBalanceRubles: Number(user.balanceRubles ?? 0),
      };
    });
  }

  async normalizeLegacyAdminCreditTransactions(): Promise<{
    updatedCount: number;
    affectedUserIds: number[];
  }> {
    const legacyRows = (await this.dataSource.query(
      `SELECT id, "userId", description, "tournamentId"
       FROM "transaction"
       WHERE category = 'admin_credit'
       ORDER BY id ASC`,
    )) as {
      id: number;
      userId: number;
      description: string | null;
      tournamentId: number | null;
    }[];

    if (legacyRows.length === 0) {
      return { updatedCount: 0, affectedUserIds: [] };
    }

    const affectedUserIds = new Set<number>();
    await this.dataSource.transaction(async (manager) => {
      for (const row of legacyRows) {
        const adminId =
          row.tournamentId != null ? Number(row.tournamentId) : null;
        const parsed = UsersService.parseAdminTopupDescription(row.description);
        const legacyComment =
          (row.description?.trim() || '') === 'Пополнение баланса'
            ? null
            : (row.description ?? null);
        const normalizedDescription =
          adminId && adminId > 0
            ? UsersService.buildAdminTopupDescription(
                adminId,
                parsed.comment ?? legacyComment,
              )
            : row.description?.trim() || 'Пополнение баланса';
        await manager.query(
          `UPDATE "transaction"
           SET category = 'topup',
               description = $1,
               "tournamentId" = NULL
           WHERE id = $2`,
          [normalizedDescription, row.id],
        );
        affectedUserIds.add(Number(row.userId));
      }
    });

    for (const userId of affectedUserIds) {
      await this.reconcileBalanceRubles(userId);
    }

    return {
      updatedCount: legacyRows.length,
      affectedUserIds: Array.from(affectedUserIds),
    };
  }

  async repairPaymentTopupTransactions(): Promise<{
    insertedCount: number;
    normalizedCount: number;
    affectedUserIds: number[];
  }> {
    const payments = (await this.dataSource.query(
      `SELECT id, "userId", amount, provider, "externalId", status, "createdAt"
       FROM payment
       WHERE status = 'succeeded'
       ORDER BY id ASC`,
    )) as {
      id: number;
      userId: number;
      amount: number;
      provider: 'yookassa' | 'robokassa';
      externalId: string | null;
      status: string;
      createdAt: string | Date;
    }[];

    if (payments.length === 0) {
      return { insertedCount: 0, normalizedCount: 0, affectedUserIds: [] };
    }

    const rows = (await this.dataSource.query(
      `SELECT id, "userId", amount, category, description, "createdAt"
       FROM "transaction"
       WHERE category = 'topup'
       ORDER BY id ASC`,
    )) as {
      id: number;
      userId: number;
      amount: number;
      category: string;
      description: string | null;
      createdAt: string | Date;
    }[];

    const affectedUserIds = new Set<number>();
    let insertedCount = 0;
    let normalizedCount = 0;

    const matchedTransactionIds = new Set<number>();
    await this.dataSource.transaction(async (manager) => {
      for (const payment of payments) {
        const structuredDescription = UsersService.buildPaymentTopupDescription(
          payment.provider,
          Number(payment.id),
          payment.externalId,
        );

        const exactMatch = rows.find((row) => {
          if (matchedTransactionIds.has(row.id)) return false;
          const parsed = UsersService.parsePaymentTopupDescription(
            row.description,
          );
          return (
            parsed.paymentId === Number(payment.id) &&
            parsed.provider === payment.provider
          );
        });

        if (exactMatch) {
          matchedTransactionIds.add(exactMatch.id);
          continue;
        }

        const fuzzyMatch = rows.find((row) => {
          if (matchedTransactionIds.has(row.id)) return false;
          if (Number(row.userId) !== Number(payment.userId)) return false;
          if (Math.abs(Number(row.amount) - Number(payment.amount)) >= 0.01)
            return false;
          const desc = String(row.description ?? '').trim();
          if (!desc) return false;
          if (UsersService.parseAdminTopupDescription(desc).adminId)
            return false;
          const lower = desc.toLowerCase();
          if (!lower.includes('пополнение')) return false;
          const txTime = new Date(row.createdAt).getTime();
          const paymentTime = new Date(payment.createdAt).getTime();
          return Math.abs(txTime - paymentTime) <= 24 * 60 * 60 * 1000;
        });

        if (fuzzyMatch) {
          matchedTransactionIds.add(fuzzyMatch.id);
          if (
            String(fuzzyMatch.description ?? '').trim() !==
            structuredDescription
          ) {
            await manager.query(
              `UPDATE "transaction" SET description = $1 WHERE id = $2`,
              [structuredDescription, fuzzyMatch.id],
            );
            normalizedCount += 1;
            affectedUserIds.add(Number(payment.userId));
          }
          continue;
        }

        await this.addTransactionWithManager(
          manager,
          Number(payment.userId),
          Number(payment.amount),
          structuredDescription,
          'topup',
        );
        insertedCount += 1;
        affectedUserIds.add(Number(payment.userId));
      }
    });

    for (const userId of affectedUserIds) {
      await this.reconcileBalanceRubles(userId);
    }

    return {
      insertedCount,
      normalizedCount,
      affectedUserIds: Array.from(affectedUserIds),
    };
  }

  /** Добавляет сумму на баланс L (для игр) и создаёт транзакцию. Атомарно через DB-транзакцию. */
  async addToBalanceL(
    userId: number,
    amount: number,
    description: string,
    category: 'win' | 'other' | 'referral' | 'refund' = 'win',
    tournamentId?: number,
  ): Promise<User> {
    if (amount <= 0)
      throw new BadRequestException('Сумма должна быть положительной');
    return this.dataSource.transaction(async (manager) => {
      const user = await this.getLockedUser(manager, userId);
      user.balance = Number(user.balance ?? 0) + amount;
      await manager.save(user);
      const tx = manager.create(Transaction, {
        userId,
        amount,
        description,
        category,
        ...(tournamentId != null && { tournamentId }),
      });
      await manager.save(tx);
      return user;
    });
  }

  /** Добавляет сумму на баланс в рублях (пополнение) и создаёт транзакцию. Атомарно через DB-транзакцию. */
  async addToBalance(
    userId: number,
    amount: number,
    description: string = 'Пополнение баланса',
  ): Promise<User> {
    if (amount <= 0)
      throw new BadRequestException('Сумма должна быть положительной');
    return this.dataSource.transaction((manager) =>
      this.creditRublesWithManager(manager, userId, amount, description),
    );
  }

  /** Конвертирует рубли в L или L в рубли. Атомарно через DB-транзакцию. */
  async convertCurrency(
    userId: number,
    amount: number,
    direction: 'rubles_to_l' | 'l_to_rubles',
  ): Promise<{ balance: number; balanceRubles: number }> {
    const amt = Number(amount);
    if (!amt || amt <= 0)
      throw new BadRequestException('Сумма должна быть положительной');
    return this.dataSource.transaction(async (manager) => {
      const user = await this.getLockedUser(manager, userId);
      const balanceL = Number(user.balance ?? 0);
      const balanceRubles = Number(user.balanceRubles ?? 0);
      let newBalanceL: number;
      let newBalanceRubles: number;
      let txAmount: number;
      let txDesc: string;
      if (direction === 'rubles_to_l') {
        if (balanceRubles < amt)
          throw new BadRequestException('Недостаточно рублей для конвертации');
        newBalanceL = balanceL + amt;
        newBalanceRubles = balanceRubles - amt;
        txAmount = amt;
        txDesc = `${amt} ₽ → ${amt} L`;
      } else {
        if (balanceL < amt)
          throw new BadRequestException('Недостаточно L для конвертации');
        newBalanceL = balanceL - amt;
        newBalanceRubles = balanceRubles + amt;
        txAmount = -amt;
        txDesc = `${amt} L → ${amt} ₽`;
      }
      user.balance = newBalanceL;
      user.balanceRubles = newBalanceRubles;
      await manager.save(user);
      const tx = manager.create(Transaction, {
        userId,
        amount: txAmount,
        description: txDesc,
        category: 'convert',
      });
      await manager.save(tx);
      return { balance: newBalanceL, balanceRubles: newBalanceRubles };
    });
  }

  /** Списывает сумму с баланса L и создаёт транзакцию. Атомарно через DB-транзакцию. */
  async deductBalance(
    userId: number,
    amount: number,
    description: string,
    category: 'loss' | 'withdraw' = 'loss',
    tournamentId?: number,
  ): Promise<User> {
    return this.dataSource.transaction(async (manager) => {
      const user = await this.getLockedUser(manager, userId);
      if (user.balance < amount)
        throw new BadRequestException('Недостаточно средств на балансе');
      user.balance -= amount;
      await manager.save(user);
      const tx = manager.create(Transaction, {
        userId,
        amount: -amount,
        description,
        category,
        ...(tournamentId != null && { tournamentId }),
      });
      await manager.save(tx);
      return user;
    });
  }

  /** Списывает рубли с баланса в рублях (вывод средств) и создаёт транзакцию. Атомарно через DB-транзакцию. */
  async deductBalanceRubles(
    userId: number,
    amount: number,
    description: string,
  ): Promise<User> {
    if (amount <= 0)
      throw new BadRequestException('Сумма должна быть положительной');
    return this.dataSource.transaction(async (manager) => {
      const user = await this.getLockedUser(manager, userId);
      const rubles = Number(user.balanceRubles ?? 0);
      if (rubles < amount)
        throw new BadRequestException(
          'Недостаточно средств на балансе в рублях',
        );
      user.balanceRubles = rubles - amount;
      await manager.save(user);
      const tx = manager.create(Transaction, {
        userId,
        amount: -amount,
        description,
        category: 'withdraw',
      });
      await manager.save(tx);
      return user;
    });
  }

  /** Снять рубли с баланса без записи транзакции (резерв при подаче заявки на вывод). */
  async deductBalanceRublesHold(userId: number, amount: number): Promise<void> {
    if (amount <= 0)
      throw new BadRequestException('Сумма должна быть положительной');
    await this.dataSource.transaction(async (manager) => {
      const user = await this.getLockedUser(manager, userId);
      const rubles = Number(user.balanceRubles ?? 0);
      if (rubles < amount)
        throw new BadRequestException(
          'Недостаточно средств на балансе в рублях',
        );
      user.balanceRubles = rubles - amount;
      await manager.save(user);
    });
  }

  /** Вернуть рубли на баланс и записать транзакцию (для реальных возвратов, не при отклонении заявки на вывод). */
  async refundBalanceRubles(
    userId: number,
    amount: number,
    description: string,
  ): Promise<User> {
    if (amount <= 0)
      throw new BadRequestException('Сумма должна быть положительной');
    return this.dataSource.transaction(async (manager) => {
      const user = await this.getLockedUser(manager, userId);
      user.balanceRubles = Number(user.balanceRubles ?? 0) + amount;
      await manager.save(user);
      await this.addTransactionWithManager(
        manager,
        userId,
        amount,
        description,
        'refund',
      );
      return user;
    });
  }

  /** Вернуть рубли на баланс после отклонения заявки на вывод — без записи транзакции (деньги формально оставались у игрока, только были заблокированы). */
  async restoreBalanceRublesAfterRejectedWithdrawal(
    userId: number,
    amount: number,
  ): Promise<User> {
    if (amount <= 0)
      throw new BadRequestException('Сумма должна быть положительной');
    return this.dataSource.transaction(async (manager) => {
      const user = await this.getLockedUser(manager, userId);
      user.balanceRubles = Number(user.balanceRubles ?? 0) + amount;
      await manager.save(user);
      return user;
    });
  }

  /** Создать заявку на вывод средств (рубли). Сумма сразу снимается с баланса (без записи транзакции); при отклонении — возвращается. */
  async createWithdrawalRequest(
    userId: number,
    amount: number,
    details?: string,
  ): Promise<WithdrawalRequest> {
    const amountNum = Number(amount);
    if (!amountNum || amountNum < 100)
      throw new BadRequestException('Минимальная сумма вывода — 100 ₽');
    const detailsStr = (details?.trim() || '').slice(0, 500);
    if (!detailsStr)
      throw new BadRequestException(
        'Укажите реквизиты для перевода (карта, счёт и т.д.)',
      );
    return this.dataSource.transaction(async (manager) => {
      const user = await this.getLockedUser(manager, userId);

      const rubles = Number(user.balanceRubles ?? 0);
      if (rubles < amountNum)
        throw new BadRequestException(
          'Недостаточно средств на балансе в рублях',
        );

      user.balanceRubles = rubles - amountNum;
      await manager.save(user);

      const req = manager.create(WithdrawalRequest, {
        userId,
        amount: amountNum,
        details: detailsStr,
        status: 'pending',
      });
      return manager.save(req);
    });
  }

  /** Список заявок на вывод текущего пользователя (для личного кабинета). */
  async getMyWithdrawalRequests(
    userId: number,
  ): Promise<UserWithdrawalRequestDto[]> {
    const requests = await this.withdrawalRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    return requests.map(toUserWithdrawalRequestDto);
  }

  async updateBalance(userId: number, newBalance: number) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const oldBalance = user.balance;
    const difference = newBalance - oldBalance;
    user.balance = newBalance;
    await this.userRepository.save(user);
    // Добавить транзакцию
    await this.addTransaction(
      userId,
      difference,
      `Баланс изменён на ${newBalance} L`,
      'other',
    );
    return user;
  }

  async importFromFile(filePath: string) {
    const fullPath = path.join(__dirname, '..', '..', filePath);
    const fileContent = fs.readFileSync(fullPath, 'utf-8');
    const lines = fileContent.trim().split('\n');
    const results = [];

    for (const line of lines) {
      const [id, username, email, balance] = line.split(',');
      const userId = parseInt(id);
      const newBalance = parseFloat(balance);

      const user = await this.userRepository.findOne({ where: { id: userId } });
      if (!user) continue;

      const oldBalance = user.balance;
      const difference = newBalance - oldBalance;

      if (difference !== 0) {
        user.balance = newBalance;
        await this.userRepository.save(user);
        await this.addTransaction(
          userId,
          difference,
          `Баланс ручного импорта: +${difference} L`,
          'other',
        );
        results.push({
          id: userId,
          username,
          oldBalance,
          newBalance,
          difference,
        });
      }
    }
    return results;
  }

  async getStats(userId: number): Promise<UserStatsDto> {
    const empty = buildEmptyUserStatsDto();
    try {
      const cacheKey = `user:stats:${userId}`;
      const cached = await this.cache.get<typeof empty>(cacheKey);
      if (cached) return cached;

      const manager = this.userRepository.manager;

      const progressRows = await manager.query(
        `SELECT p."questionsAnsweredCount", p."tiebreakerRoundsCorrect", p."finalTiebreakerRoundsCorrect", t."gameType"
       FROM tournament_progress p
       INNER JOIN tournament t ON t.id = p."tournamentId"
       WHERE p."userId" = $1 AND p."questionsAnsweredCount" > 0`,
        [userId],
      );
      let gamesPlayed = 0;
      let gamesPlayedTraining = 0;
      let gamesPlayedMoney = 0;
      for (const row of progressRows) {
        const rounds = UsersService.countRoundsFromRow(row);
        gamesPlayed += rounds;
        if (row.gameType === 'money') {
          gamesPlayedMoney += rounds;
        } else {
          gamesPlayedTraining += rounds;
        }
      }

      // Победы (полуфинал + финал) для всех типов игр.
      const { wins, winsTraining, winsMoney } = await UsersService.countAllWins(
        manager,
        userId,
      );

      const QUESTIONS_PER_ROUND = 10;

      // Завершённые тренировочные матчи (оба игрока ответили на 10 вопросов)
      const trainingMatchesRow = await manager.query(
        `SELECT COUNT(DISTINCT t.id) as cnt FROM tournament t
       INNER JOIN tournament_players_user tpu ON tpu."tournamentId" = t.id
       WHERE (t."gameType" = 'training' OR t."gameType" IS NULL) AND tpu."userId" = $1
       AND t.id IN (
         SELECT p."tournamentId" FROM tournament_progress p
         WHERE p."questionsAnsweredCount" >= $2
         GROUP BY p."tournamentId"
         HAVING COUNT(*) >= 2
       )`,
        [userId, QUESTIONS_PER_ROUND],
      );
      const totalTrainingWithResult = Number(trainingMatchesRow?.[0]?.cnt) || 0;

      const moneyToursRow = await manager.query(
        `SELECT t.id as tid, t."playerOrder" as "playerOrder" FROM tournament t
       INNER JOIN tournament_players_user tpu ON tpu."tournamentId" = t.id
       WHERE t."gameType" = 'money' AND tpu."userId" = $1
       AND t.id IN (SELECT "tournamentId" FROM tournament_players_user GROUP BY "tournamentId" HAVING COUNT(*) >= 2)`,
        [userId],
      );
      let totalMoneyWithResult = 0;
      for (const row of (moneyToursRow as {
        tid: number;
        playerOrder: string | null;
      }[]) || []) {
        const tid = row.tid;
        const playerIds = parsePlayerOrder(row.playerOrder).filter(
          (id) => id > 0,
        );
        const userSlot = playerIds.indexOf(userId);
        if (userSlot < 0) continue;
        const opponentSlot = getOpponentSlot(userSlot, playerIds.length);
        if (opponentSlot == null) continue;
        const opponentId = playerIds[opponentSlot]!;
        const progressRows = (await manager.query(
          `SELECT "userId", "questionsAnsweredCount" as q FROM tournament_progress WHERE "tournamentId" = $1 AND "userId" IN ($2, $3)`,
          [tid, userId, opponentId],
        )) as { userId: number; q: number }[];
        const byUser = new Map(progressRows.map((r) => [r.userId, r.q]));
        const myQ = byUser.get(userId) ?? 0;
        const oppQ = byUser.get(opponentId) ?? 0;
        if (myQ >= QUESTIONS_PER_ROUND && oppQ >= QUESTIONS_PER_ROUND) {
          totalMoneyWithResult += 1;
        }
      }

      const completedMatches = totalMoneyWithResult + totalTrainingWithResult;

      const completedMatchesTraining = totalTrainingWithResult;
      const completedMatchesMoney = totalMoneyWithResult;

      const correctRow = await manager.query(
        'SELECT COALESCE(SUM("correctAnswersCount"), 0) as cnt FROM tournament_progress WHERE "userId" = $1',
        [userId],
      );
      const correctAnswers = Number(correctRow?.[0]?.cnt) || 0;

      const totalQuestionsRow = await manager.query(
        'SELECT COALESCE(SUM("questionsAnsweredCount"), 0) as cnt FROM tournament_progress WHERE "userId" = $1',
        [userId],
      );
      const totalQuestions = Number(totalQuestionsRow?.[0]?.cnt) || 0;

      const correctTrainingRow = await manager.query(
        `SELECT COALESCE(SUM(p."correctAnswersCount"), 0) as cnt FROM tournament_progress p
       INNER JOIN tournament t ON t.id = p."tournamentId"
       WHERE p."userId" = $1 AND (t."gameType" = 'training' OR t."gameType" IS NULL)`,
        [userId],
      );
      const correctAnswersTraining = Number(correctTrainingRow?.[0]?.cnt) || 0;

      const questionsTrainingRow = await manager.query(
        `SELECT COALESCE(SUM(p."questionsAnsweredCount"), 0) as cnt FROM tournament_progress p
       INNER JOIN tournament t ON t.id = p."tournamentId"
       WHERE p."userId" = $1 AND (t."gameType" = 'training' OR t."gameType" IS NULL)`,
        [userId],
      );
      const totalQuestionsTraining =
        Number(questionsTrainingRow?.[0]?.cnt) || 0;

      const correctMoneyRow = await manager.query(
        `SELECT COALESCE(SUM(p."correctAnswersCount"), 0) as cnt FROM tournament_progress p
       INNER JOIN tournament t ON t.id = p."tournamentId"
       WHERE p."userId" = $1 AND t."gameType" = 'money'`,
        [userId],
      );
      const correctAnswersMoney = Number(correctMoneyRow?.[0]?.cnt) || 0;

      const questionsMoneyRow = await manager.query(
        `SELECT COALESCE(SUM(p."questionsAnsweredCount"), 0) as cnt FROM tournament_progress p
       INNER JOIN tournament t ON t.id = p."tournamentId"
       WHERE p."userId" = $1 AND t."gameType" = 'money'`,
        [userId],
      );
      const totalQuestionsMoney = Number(questionsMoneyRow?.[0]?.cnt) || 0;

      // % побед считаем только по завершённым матчам.
      const winRatePercent =
        completedMatches > 0
          ? parseFloat(((wins / completedMatches) * 100).toFixed(2))
          : null;

      // Сумма выигрышей в турнирах (category = 'win' в транзакциях).
      let totalWinnings = 0;
      try {
        const winSumRow = await manager.query(
          `SELECT COALESCE(SUM(amount), 0) as total FROM "transaction" WHERE "userId" = $1 AND category = 'win'`,
          [userId],
        );
        totalWinnings = Number(winSumRow?.[0]?.total) || 0;
      } catch {
        // игнорируем
      }

      let totalWithdrawn = 0;
      try {
        const wdRow = await manager.query(
          `SELECT COALESCE(SUM(amount), 0) as total FROM withdrawal_request WHERE "userId" = $1 AND status = 'approved'`,
          [userId],
        );
        totalWithdrawn = Number(wdRow?.[0]?.total ?? 0) || 0;
      } catch {
        // игнорируем
      }

      // Максимальная лига: баланс ≥ 10×ставка; для лиги > 5 L — 10 побед в предыдущей.
      let maxLeague: number | null = null;
      let maxLeagueName: string | null = null;
      try {
        const balanceMaps = await this.getComputedBalanceMapsForUsers([userId]);
        const balance = balanceMaps.balanceL.get(userId) ?? 0;
        const leagueWinsRows = (await manager.query(
          `SELECT t."leagueAmount" as amt, COUNT(*) as wins FROM tournament_result r
         INNER JOIN tournament t ON t.id = r."tournamentId"
         WHERE r."userId" = $1 AND r.passed = 1 AND t."gameType" = 'money' AND t."leagueAmount" IS NOT NULL
         GROUP BY t."leagueAmount"`,
          [userId],
        )) as { amt: number; wins: number }[];
        const leagueWins = new Map<number, number>();
        for (const row of leagueWinsRows) {
          const amt = Number(row.amt);
          if (!Number.isNaN(amt)) leagueWins.set(amt, Number(row.wins) || 0);
        }
        const wins = (amt: number) => leagueWins.get(amt) ?? 0;
        const allowedLeagues: number[] = [];
        for (let i = 0; i < LEAGUE_AMOUNTS.length; i++) {
          const amount = LEAGUE_AMOUNTS[i]!;
          const minBalance = getMinBalanceForLeague(i, amount);
          if (balance < minBalance) continue;
          const prevAmount = i > 0 ? LEAGUE_AMOUNTS[i - 1]! : null;
          if (prevAmount != null && wins(prevAmount) < LEAGUE_WINS_TO_UNLOCK)
            continue;
          allowedLeagues.push(amount);
        }
        if (allowedLeagues.length > 0) {
          maxLeague = allowedLeagues[allowedLeagues.length - 1]!;
          maxLeagueName = LEAGUE_NAMES[maxLeague] ?? `Лига ${maxLeague} L`;
        }
      } catch {
        // игнорируем ошибки
      }

      const result = {
        gamesPlayed,
        gamesPlayedTraining,
        gamesPlayedMoney,
        completedMatches,
        completedMatchesTraining,
        completedMatchesMoney,
        wins,
        winsTraining,
        winsMoney,
        winRatePercent,
        correctAnswers,
        totalQuestions,
        correctAnswersTraining,
        totalQuestionsTraining,
        correctAnswersMoney,
        totalQuestionsMoney,
        totalWinnings,
        totalWithdrawn,
        maxLeague,
        maxLeagueName,
      };
      await this.cache.set(cacheKey, result, 15000);
      return result;
    } catch (err) {
      console.error('[getStats]', err);
      return empty;
    }
  }

  /** Рейтинг по метрике. Возвращает топ участников и место текущего пользователя. */
  async getRankings(
    metric:
      | 'gamesPlayed'
      | 'wins'
      | 'totalWinnings'
      | 'correctAnswers'
      | 'correctAnswerRate'
      | 'referrals'
      | 'totalWithdrawn',
    userId: number,
  ): Promise<{
    rankings: {
      rank: number;
      userId: number;
      displayName: string;
      value: number;
      valueFormatted: string;
    }[];
    myRank: number | null;
    myValue: number | null;
    totalParticipants: number;
  }> {
    const manager = this.userRepository.manager;
    let query: string;
    let valueCol: string;
    const desc = true; // больше = лучше для всех метрик

    switch (metric) {
      case 'gamesPlayed': {
        const rSQL = UsersService.roundsPerProgressSQL();
        query = `SELECT u.id as "userId", COALESCE(u.nickname, u.username) as "displayName",
          (SELECT COALESCE(SUM(${rSQL}), 0) FROM tournament_progress p WHERE p."userId" = u.id AND p."questionsAnsweredCount" > 0) as val
          FROM "user" u
          WHERE (SELECT COUNT(*) FROM tournament_progress p WHERE p."userId" = u.id AND p."questionsAnsweredCount" > 0) > 0
          ORDER BY val DESC, u.id DESC`;
        valueCol = 'val';
        break;
      }
      case 'wins':
        query = '';
        valueCol = 'val';
        break;
      case 'totalWinnings':
        query = `SELECT u.id as "userId", COALESCE(u.nickname, u.username) as "displayName",
          COALESCE((SELECT SUM(amount) FROM "transaction" WHERE "userId" = u.id AND category = 'win'), 0) as val
          FROM "user" u
          WHERE COALESCE((SELECT SUM(amount) FROM "transaction" WHERE "userId" = u.id AND category = 'win'), 0) > 0
          ORDER BY val DESC, u.id DESC`;
        valueCol = 'val';
        break;
      case 'correctAnswers':
        query = `SELECT u.id as "userId", COALESCE(u.nickname, u.username) as "displayName",
          COALESCE((SELECT SUM("correctAnswersCount") FROM tournament_progress WHERE "userId" = u.id), 0) as val
          FROM "user" u
          WHERE COALESCE((SELECT SUM("correctAnswersCount") FROM tournament_progress WHERE "userId" = u.id), 0) > 0
          ORDER BY val DESC, u.id DESC`;
        valueCol = 'val';
        break;
      case 'correctAnswerRate':
        query = `SELECT u.id as "userId", COALESCE(u.nickname, u.username) as "displayName",
          CASE WHEN COALESCE((SELECT SUM("questionsAnsweredCount") FROM tournament_progress WHERE "userId" = u.id), 0) > 0
            THEN ROUND(COALESCE((SELECT SUM("correctAnswersCount") FROM tournament_progress WHERE "userId" = u.id), 0)::numeric
              / COALESCE((SELECT SUM("questionsAnsweredCount") FROM tournament_progress WHERE "userId" = u.id), 1) * 100, 2)
            ELSE 0 END as val
          FROM "user" u
          WHERE COALESCE((SELECT SUM("questionsAnsweredCount") FROM tournament_progress WHERE "userId" = u.id), 0) > 0
          ORDER BY val DESC, u.id DESC`;
        valueCol = 'val';
        break;
      case 'referrals':
        query = `SELECT u.id as "userId", COALESCE(u.nickname, u.username) as "displayName",
          (SELECT COUNT(*) FROM "user" r WHERE r."referrerId" = u.id) as val
          FROM "user" u
          WHERE (SELECT COUNT(*) FROM "user" r WHERE r."referrerId" = u.id) > 0
          ORDER BY val DESC, u.id DESC`;
        valueCol = 'val';
        break;
      case 'totalWithdrawn':
        query = `SELECT u.id as "userId", COALESCE(u.nickname, u.username) as "displayName",
          COALESCE((SELECT SUM(amount) FROM withdrawal_request WHERE "userId" = u.id AND status = 'approved'), 0) as val
          FROM "user" u
          WHERE COALESCE((SELECT SUM(amount) FROM withdrawal_request WHERE "userId" = u.id AND status = 'approved'), 0) > 0
          ORDER BY val DESC, u.id DESC`;
        valueCol = 'val';
        break;
      default:
        query = `SELECT u.id as "userId", COALESCE(u.nickname, u.username) as "displayName", 0 as val
          FROM "user" u LIMIT 0`;
        valueCol = 'val';
    }

    try {
      const cacheKey = `rankings:${metric}`;
      let rankings: {
        rank: number;
        userId: number;
        displayName: string;
        value: number;
        valueFormatted: string;
      }[];
      const cached = await this.cache.get<typeof rankings>(cacheKey);
      if (cached) {
        rankings = cached;
      } else if (metric === 'wins') {
        try {
          rankings = await UsersService.computeWinsRankings(manager);
        } catch (e) {
          console.error('[getRankings] computeWinsRankings error:', e);
          rankings = [];
        }
        await this.cache.set(cacheKey, rankings, 60000);
      } else {
        const rows = (await manager.query(query)) as {
          userId: number;
          displayName: string;
          val: number;
        }[];
        rankings = rows.map((r, i) => ({
          rank: i + 1,
          userId: r.userId,
          displayName:
            String(r.displayName || `Игрок ${r.userId}`).trim() ||
            `Игрок ${r.userId}`,
          value: Number(r.val) || 0,
          valueFormatted:
            metric === 'totalWinnings'
              ? `${Number(r.val).toLocaleString('ru-RU')} L`
              : metric === 'totalWithdrawn'
                ? `${Number(r.val).toLocaleString('ru-RU')} ₽`
                : metric === 'correctAnswerRate'
                  ? `${Number(r.val).toLocaleString('ru-RU')}%`
                  : String(Number(r.val).toLocaleString('ru-RU')),
        }));
        await this.cache.set(cacheKey, rankings, 60000);
      }
      let myEntry = rankings.find((r) => r.userId === userId);
      let myRank: number | null = myEntry ? myEntry.rank : null;
      let myValue: number | null = myEntry ? myEntry.value : null;
      if (!myEntry) {
        if (metric === 'referrals') {
          const refRow = await manager.query(
            `SELECT COUNT(*) as cnt FROM "user" WHERE "referrerId" = $1`,
            [userId],
          );
          myValue = Number(refRow?.[0]?.cnt ?? 0);
        } else if (metric === 'totalWithdrawn') {
          const wdRow = await manager.query(
            `SELECT COALESCE(SUM(amount), 0) as total FROM withdrawal_request WHERE "userId" = $1 AND status = 'approved'`,
            [userId],
          );
          myValue = Number(wdRow?.[0]?.total ?? 0);
        } else {
          const myStats = await this.getStats(userId);
          myValue =
            metric === 'gamesPlayed'
              ? myStats.gamesPlayed
              : metric === 'wins'
                ? myStats.wins
                : metric === 'totalWinnings'
                  ? myStats.totalWinnings
                  : metric === 'correctAnswerRate'
                    ? myStats.totalQuestions > 0
                      ? parseFloat(
                          (
                            (myStats.correctAnswers / myStats.totalQuestions) *
                            100
                          ).toFixed(2),
                        )
                      : 0
                    : myStats.correctAnswers;
        }
        const betterCount = rankings.filter(
          (r) => r.value > (myValue ?? 0),
        ).length;
        myRank = betterCount + 1;
      }
      const totalUsers = await manager.query(
        'SELECT COUNT(*) as cnt FROM "user"',
      );
      const totalParticipants = Math.max(
        Number(totalUsers?.[0]?.cnt ?? 0),
        rankings.length,
      );
      return { rankings, myRank, myValue, totalParticipants };
    } catch (err) {
      console.error('[getRankings]', err);
      return {
        rankings: [],
        myRank: null,
        myValue: null,
        totalParticipants: 0,
      };
    }
  }

  /** Глобальная статичная статистика: всего пользователей, онлайн, общий заработок игроков, сыграно игр/турниров. */
  async getGlobalStats(): Promise<UserGlobalStatsDto> {
    const manager = this.userRepository.manager;
    let totalUsers = 0;
    let onlineCount = 0;
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    try {
      totalUsers = await this.userRepository.count();
    } catch (e) {
      console.error('[getGlobalStats] totalUsers', e);
    }
    try {
      onlineCount = await this.userRepository.count({
        where: { lastCabinetSeenAt: MoreThanOrEqual(twoMinutesAgo) },
      });
    } catch (e) {
      console.error('[getGlobalStats] onlineCount', e);
    }
    let totalEarnings = 0;
    try {
      const rows = await manager.query(
        `SELECT COALESCE(SUM(amount), 0) as total FROM "transaction" WHERE category = 'win'`,
      );
      const first = rows?.[0] as { total?: unknown } | undefined;
      totalEarnings = Number(first?.total ?? 0) || 0;
    } catch (e) {
      console.error('[getGlobalStats] totalEarnings', e);
    }
    let totalGamesPlayed = 0;
    try {
      const rSQL = UsersService.roundsPerProgressSQL();
      const rows = await manager.query(
        `SELECT COALESCE(SUM(${rSQL}), 0) as cnt FROM tournament_progress p WHERE p."questionsAnsweredCount" > 0`,
      );
      totalGamesPlayed = Number(rows?.[0]?.cnt ?? 0) || 0;
    } catch (e) {
      console.error('[getGlobalStats] totalGamesPlayed', e);
    }
    let totalTournaments = 0;
    try {
      const rows = await manager.query(
        `SELECT COUNT(DISTINCT "tournamentId") as cnt FROM tournament_result WHERE passed = 1`,
      );
      totalTournaments = Number(rows?.[0]?.cnt ?? 0) || 0;
    } catch (e) {
      console.error('[getGlobalStats] totalTournaments', e);
    }
    let totalWithdrawn = 0;
    try {
      const rows = await manager.query(
        `SELECT COALESCE(SUM(amount), 0) as total FROM withdrawal_request WHERE status = 'approved'`,
      );
      totalWithdrawn = Number(rows?.[0]?.total ?? 0) || 0;
    } catch (e) {
      console.error('[getGlobalStats] totalWithdrawn', e);
    }
    return {
      totalUsers,
      onlineCount,
      totalEarnings,
      totalGamesPlayed,
      totalTournaments,
      totalWithdrawn,
    };
  }

  /** Только число игроков онлайн (для хедера). */
  async getOnlineCount(): Promise<{ onlineCount: number }> {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    let onlineCount = 0;
    try {
      onlineCount = await this.userRepository.count({
        where: { lastCabinetSeenAt: MoreThanOrEqual(twoMinutesAgo) },
      });
    } catch (e) {
      console.error('[getOnlineCount]', e);
    }
    return { onlineCount };
  }

  /** Статистика по дням для графика. from/to в формате YYYY-MM-DD. gameType: training | money | all */
  async getStatsByDay(
    userId: number,
    fromDate: string,
    toDate: string,
    metric: 'gamesPlayed' | 'wins' | 'totalWinnings' | 'correctAnswers',
    gameType: 'training' | 'money' | 'all' = 'all',
  ): Promise<{
    data: { date: string; value: number }[];
    availableMetrics: string[];
  }> {
    const manager = this.userRepository.manager;
    const availableMetrics = [
      'gamesPlayed',
      'wins',
      'totalWinnings',
      'correctAnswers',
    ];

    const from =
      UsersService.parseDate(fromDate) ??
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = UsersService.parseDate(toDate) ?? new Date();
    if (from > to) return { data: [], availableMetrics };

    const fromStr = UsersService.toLocalDateStr(from);
    const toStr = UsersService.toLocalDateStr(to);

    const days: string[] = [];
    for (
      let d = new Date(from.getTime());
      d <= to;
      d.setDate(d.getDate() + 1)
    ) {
      days.push(UsersService.toLocalDateStr(d));
    }

    const gameTypeTraining =
      gameType === 'training'
        ? ` AND (t."gameType" = 'training' OR t."gameType" IS NULL)`
        : '';
    const gameTypeMoney =
      gameType === 'money' ? ` AND t."gameType" = 'money'` : '';
    const gameTypeFilter =
      gameType === 'all'
        ? ''
        : gameType === 'training'
          ? gameTypeTraining
          : gameTypeMoney;

    let rows: { d: string; val: number }[] = [];
    try {
      switch (metric) {
        case 'gamesPlayed': {
          const rSQL = UsersService.roundsPerProgressSQL();
          rows = (await manager.query(
            `SELECT t."createdAt"::date::text as d, COALESCE(SUM(${rSQL}), 0) as val
             FROM tournament_progress p
             INNER JOIN tournament t ON t.id = p."tournamentId"
             WHERE p."userId" = $1 AND p."questionsAnsweredCount" > 0
             AND t."createdAt"::date >= $2::date AND t."createdAt"::date <= $3::date
             ${gameTypeFilter}
             GROUP BY t."createdAt"::date::text`,
            [userId, fromStr, toStr],
          )) as { d: string; val: number }[];
          break;
        }
        case 'wins': {
          const byDate = new Map<string, number>();
          for (const day of days) byDate.set(day, 0);

          const userTourn = (await manager.query(
            `SELECT t.id as "tournamentId", t."playerOrder", t."createdAt"::date::text as d
             FROM tournament_progress p
             INNER JOIN tournament t ON t.id = p."tournamentId"
             WHERE p."userId" = $1 AND p."questionsAnsweredCount" >= 10
             AND t."createdAt"::date >= $2::date AND t."createdAt"::date <= $3::date
             ${gameTypeFilter}`,
            [userId, fromStr, toStr],
          )) as any[];

          if (userTourn.length > 0) {
            const tids = userTourn.map((r: any) => Number(r.tournamentId));

            const finalWins = (await manager.query(
              `SELECT "tournamentId" FROM tournament_result
               WHERE "userId" = $1 AND passed = 1
               AND "tournamentId" IN (${tids.map((_: any, i: number) => `$${i + 2}`).join(',')})`,
              [userId, ...tids],
            )) as any[];
            const finalWinTids = new Set(
              finalWins.map((r: any) => Number(r.tournamentId)),
            );

            const allProg = (await manager.query(
              `SELECT "tournamentId", "userId", "questionsAnsweredCount", "semiFinalCorrectCount", "tiebreakerRoundsCorrect"
               FROM tournament_progress
               WHERE "tournamentId" IN (${tids.map((_: any, i: number) => `$${i + 1}`).join(',')})`,
              tids,
            )) as any[];
            const progressByTid = UsersService.buildProgressMap(allProg);

            for (const row of userTourn) {
              const tid = Number(row.tournamentId);
              const dateStr = row.d && String(row.d).slice(0, 10);
              if (!dateStr || !days.includes(dateStr)) continue;

              const po = parsePlayerOrder(row.playerOrder);
              const progMap = progressByTid.get(tid);

              let w = 0;
              if (UsersService.didWinSemifinal(userId, po, progMap)) w++;
              if (finalWinTids.has(tid)) w++;

              if (w > 0) byDate.set(dateStr, (byDate.get(dateStr) ?? 0) + w);
            }
          }

          rows = Array.from(byDate.entries()).map(([d, val]) => ({ d, val }));
          break;
        }
        case 'totalWinnings':
          rows = (await manager.query(
            `SELECT "createdAt"::date::text as d, COALESCE(SUM(amount), 0) as val
             FROM "transaction"
             WHERE "userId" = $1 AND category = 'win' AND "createdAt"::date >= $2::date AND "createdAt"::date <= $3::date
             GROUP BY "createdAt"::date::text`,
            [userId, fromStr, toStr],
          )) as { d: string; val: number }[];
          break;
        case 'correctAnswers':
          rows = (await manager.query(
            `SELECT t."createdAt"::date::text as d, COALESCE(SUM(p."correctAnswersCount"), 0) as val
             FROM tournament_progress p
             INNER JOIN tournament t ON t.id = p."tournamentId"
             WHERE p."userId" = $1 AND t."createdAt"::date >= $2::date AND t."createdAt"::date <= $3::date
             ${gameTypeFilter}
             GROUP BY t."createdAt"::date::text`,
            [userId, fromStr, toStr],
          )) as { d: string; val: number }[];
          break;
        default:
          break;
      }
    } catch (err) {
      console.error('[getStatsByDay]', err);
      return {
        data: days.map((date) => ({ date, value: 0 })),
        availableMetrics,
      };
    }

    const byDate = new Map<string, number>();
    for (const r of rows) {
      const d = r.d && String(r.d).slice(0, 10);
      if (d) byDate.set(d, Number(r.val) || 0);
    }
    const data = days.map((date) => ({ date, value: byDate.get(date) ?? 0 }));
    return { data, availableMetrics };
  }

  /** Реферальная статистика по дням. metric: referralCount | referralEarnings */
  async getReferralStatsByDay(
    userId: number,
    fromDate: string,
    toDate: string,
    metric: 'referralCount' | 'referralEarnings',
  ): Promise<{
    data: { date: string; value: number }[];
    availableMetrics: string[];
  }> {
    const manager = this.userRepository.manager;
    const availableMetrics = ['referralCount', 'referralEarnings'];

    const from =
      UsersService.parseDate(fromDate) ??
      new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = UsersService.parseDate(toDate) ?? new Date();
    if (from > to) return { data: [], availableMetrics };

    const fromStr = UsersService.toLocalDateStr(from);
    const toStr = UsersService.toLocalDateStr(to);

    const days: string[] = [];
    for (
      let d = new Date(from.getTime());
      d <= to;
      d.setDate(d.getDate() + 1)
    ) {
      days.push(UsersService.toLocalDateStr(d));
    }

    let rows: { d: string; val: number }[] = [];
    try {
      if (metric === 'referralCount') {
        rows = (await manager.query(
          `SELECT "createdAt"::date::text as d, COUNT(*) as val
           FROM "user"
           WHERE "referrerId" = $1 AND "createdAt"::date >= $2::date AND "createdAt"::date <= $3::date
           GROUP BY "createdAt"::date::text`,
          [userId, fromStr, toStr],
        )) as { d: string; val: number }[];
      } else if (metric === 'referralEarnings') {
        rows = (await manager.query(
          `SELECT "createdAt"::date::text as d, COALESCE(SUM(amount), 0) as val
           FROM "transaction"
           WHERE "userId" = $1 AND category = 'referral' AND "createdAt"::date >= $2::date AND "createdAt"::date <= $3::date
           GROUP BY "createdAt"::date::text`,
          [userId, fromStr, toStr],
        )) as { d: string; val: number }[];
      }
    } catch (err) {
      console.error('[getReferralStatsByDay]', err);
      return {
        data: days.map((date) => ({ date, value: 0 })),
        availableMetrics,
      };
    }

    const byDate = new Map<string, number>();
    for (const r of rows) {
      const d = r.d && String(r.d).slice(0, 10);
      if (d) byDate.set(d, Number(r.val) || 0);
    }
    const data = days.map((date) => ({ date, value: byDate.get(date) ?? 0 }));
    return { data, availableMetrics };
  }

  private static readonly QUESTIONS_PER_ROUND = QUESTIONS_PER_ROUND;
  private static readonly TIEBREAKER_QUESTIONS = TIEBREAKER_QUESTIONS;

  private static parseJsonArray(val: unknown): number[] {
    if (Array.isArray(val)) return val;
    if (typeof val === 'string' && val !== 'null' && val !== '') {
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) return parsed;
      } catch {}
    }
    return [];
  }

  static countRoundsFromRow(row: {
    questionsAnsweredCount: number;
    tiebreakerRoundsCorrect?: unknown;
    finalTiebreakerRoundsCorrect?: unknown;
  }): number {
    const q = row.questionsAnsweredCount ?? 0;
    if (q <= 0) return 0;

    let rounds = 1; // semifinal

    const semiTB = UsersService.parseJsonArray(row.tiebreakerRoundsCorrect);
    rounds += semiTB.length;

    const semiTotal =
      UsersService.QUESTIONS_PER_ROUND +
      semiTB.length * UsersService.TIEBREAKER_QUESTIONS;
    if (q > semiTotal) rounds += 1; // final

    const finalTB = UsersService.parseJsonArray(
      row.finalTiebreakerRoundsCorrect,
    );
    rounds += finalTB.length;

    return rounds;
  }

  static roundsPerProgressSQL(): string {
    const semiTB = `CASE WHEN p."tiebreakerRoundsCorrect" IS NOT NULL AND p."tiebreakerRoundsCorrect" NOT IN ('null','') THEN json_array_length(p."tiebreakerRoundsCorrect"::json) ELSE 0 END`;
    const finalTB = `CASE WHEN p."finalTiebreakerRoundsCorrect" IS NOT NULL AND p."finalTiebreakerRoundsCorrect" NOT IN ('null','') THEN json_array_length(p."finalTiebreakerRoundsCorrect"::json) ELSE 0 END`;
    return `(CASE WHEN p."questionsAnsweredCount" > 0 THEN 1 ELSE 0 END + ${semiTB} + CASE WHEN p."questionsAnsweredCount" > 10 + (${semiTB}) * 10 THEN 1 ELSE 0 END + ${finalTB})`;
  }

  /** Победил ли userId в полуфинале данного турнира (сравнение с соперником в паре по playerOrder). */
  private static didWinSemifinal(
    userId: number,
    playerOrder: number[],
    progressMap: Map<number, any> | undefined,
  ): boolean {
    if (!playerOrder || playerOrder.length < 2) return false;
    const slot = playerOrder.indexOf(userId);
    if (slot < 0) return false;
    const oppSlot = getOpponentSlot(slot, playerOrder.length);
    if (oppSlot == null) return false;
    const oppId = playerOrder[oppSlot];
    if (oppId == null || oppId <= 0) return false;

    const myProg = progressMap?.get(userId);
    const oppProg = progressMap?.get(oppId);
    if (!myProg) return false;

    const myQ = Number(myProg.questionsAnsweredCount) || 0;
    const oppQ = Number(oppProg?.questionsAnsweredCount) || 0;
    if (myQ < 10 || oppQ < 10) return false;

    const mySemi = Number(myProg.semiFinalCorrectCount) || 0;
    const oppSemi = Number(oppProg?.semiFinalCorrectCount) || 0;

    if (mySemi > oppSemi) return true;
    if (mySemi < oppSemi) return false;

    const myTB = UsersService.parseJsonArray(myProg.tiebreakerRoundsCorrect);
    const oppTB = UsersService.parseJsonArray(oppProg?.tiebreakerRoundsCorrect);

    for (let r = 0; r < Math.max(myTB.length, oppTB.length); r++) {
      const myR = myTB[r] ?? 0;
      const oppR = oppTB[r] ?? 0;
      if (myR > oppR) return true;
      if (myR < oppR) return false;
    }

    const semiTotal = 10 + myTB.length * 10;
    if (myQ > semiTotal) return true;

    return false;
  }

  /** Строит Map<tournamentId, Map<userId, progress>> из массива raw-строк. */
  private static buildProgressMap(rows: any[]): Map<number, Map<number, any>> {
    const m = new Map<number, Map<number, any>>();
    for (const p of rows) {
      const tid = Number(p.tournamentId);
      if (!m.has(tid)) m.set(tid, new Map());
      m.get(tid)!.set(Number(p.userId), p);
    }
    return m;
  }

  /** Подсчёт всех побед (полуфинал + финал) для одного пользователя. */
  static async countAllWins(
    manager: any,
    userId: number,
  ): Promise<{ wins: number; winsTraining: number; winsMoney: number }> {
    const finalWinsRows = await manager.query(
      `SELECT r."tournamentId", t."gameType"
       FROM tournament_result r
       INNER JOIN tournament t ON t.id = r."tournamentId"
       WHERE r."userId" = $1 AND r.passed = 1`,
      [userId],
    );
    const finalWinTids = new Set(
      finalWinsRows.map((r: any) => Number(r.tournamentId)),
    );

    const userTournRows = await manager.query(
      `SELECT t.id as "tournamentId", t."playerOrder", t."gameType"
       FROM tournament_progress p
       INNER JOIN tournament t ON t.id = p."tournamentId"
       WHERE p."userId" = $1 AND p."questionsAnsweredCount" >= 10`,
      [userId],
    );

    const tids = userTournRows.map((r: any) => Number(r.tournamentId));

    if (tids.length === 0) {
      let w = 0,
        wT = 0,
        wM = 0;
      for (const r of finalWinsRows) {
        w++;
        if (r.gameType === 'money') wM++;
        else wT++;
      }
      return { wins: w, winsTraining: wT, winsMoney: wM };
    }

    const allProgress = await manager.query(
      `SELECT "tournamentId", "userId", "questionsAnsweredCount", "semiFinalCorrectCount", "tiebreakerRoundsCorrect"
       FROM tournament_progress
       WHERE "tournamentId" IN (${tids.map((_: any, i: number) => `$${i + 1}`).join(',')})`,
      tids,
    );

    const progressByTid = UsersService.buildProgressMap(allProgress);

    let wins = 0,
      winsTraining = 0,
      winsMoney = 0;
    const countedTids = new Set<number>();

    for (const row of userTournRows) {
      const tid = Number(row.tournamentId);
      const gt = row.gameType;
      const po = parsePlayerOrder(row.playerOrder);
      const progMap = progressByTid.get(tid);
      countedTids.add(tid);

      if (UsersService.didWinSemifinal(userId, po, progMap)) {
        wins++;
        if (gt === 'money') winsMoney++;
        else winsTraining++;
      }
      if (finalWinTids.has(tid)) {
        wins++;
        if (gt === 'money') winsMoney++;
        else winsTraining++;
      }
    }

    for (const r of finalWinsRows) {
      const tid = Number(r.tournamentId);
      if (!countedTids.has(tid)) {
        wins++;
        if (r.gameType === 'money') winsMoney++;
        else winsTraining++;
      }
    }

    return { wins, winsTraining, winsMoney };
  }

  /** Рейтинг побед (все пользователи): полуфинал + финал, все типы игр. */
  private static async computeWinsRankings(manager: any): Promise<
    {
      rank: number;
      userId: number;
      displayName: string;
      value: number;
      valueFormatted: string;
    }[]
  > {
    const allFinalWins = await manager.query(
      `SELECT r."userId", r."tournamentId" FROM tournament_result r WHERE r.passed = 1`,
    );

    const allUserTourn = await manager.query(
      `SELECT p."userId", t.id as "tournamentId", t."playerOrder"
       FROM tournament_progress p
       INNER JOIN tournament t ON t.id = p."tournamentId"
       WHERE p."questionsAnsweredCount" >= 10`,
    );

    const allProgress = await manager.query(
      `SELECT "tournamentId", "userId", "questionsAnsweredCount", "semiFinalCorrectCount", "tiebreakerRoundsCorrect"
       FROM tournament_progress`,
    );

    const progressByTid = UsersService.buildProgressMap(allProgress);

    const finalWinsByUser = new Map<number, Set<number>>();
    for (const r of allFinalWins) {
      const uid = Number(r.userId);
      if (!finalWinsByUser.has(uid)) finalWinsByUser.set(uid, new Set());
      finalWinsByUser.get(uid)!.add(Number(r.tournamentId));
    }

    const winsByUser = new Map<number, number>();
    const countedByUser = new Map<number, Set<number>>();

    for (const row of allUserTourn) {
      const uid = Number(row.userId);
      const tid = Number(row.tournamentId);
      const po = parsePlayerOrder(row.playerOrder);
      const progMap = progressByTid.get(tid);

      let w = 0;
      const semiWin = UsersService.didWinSemifinal(uid, po, progMap);
      if (semiWin) w++;
      const finalWin = finalWinsByUser.get(uid)?.has(tid) ?? false;
      if (finalWin) w++;

      if (w > 0) winsByUser.set(uid, (winsByUser.get(uid) ?? 0) + w);
      if (!countedByUser.has(uid)) countedByUser.set(uid, new Set());
      countedByUser.get(uid)!.add(tid);
    }

    for (const [uid, tids] of finalWinsByUser) {
      const counted = countedByUser.get(uid);
      for (const tid of tids) {
        if (!counted?.has(tid)) {
          winsByUser.set(uid, (winsByUser.get(uid) ?? 0) + 1);
        }
      }
    }

    const allUsers = await manager.query(
      `SELECT id, COALESCE(nickname, username) as "displayName" FROM "user"`,
    );
    const userNames = new Map<number, string>(
      allUsers.map((u: any) => [
        Number(u.id),
        String(u.displayName || `Игрок ${u.id}`).trim() || `Игрок ${u.id}`,
      ]),
    );

    const entries = [...winsByUser.entries()]
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1] || b[0] - a[0]);

    return entries.map(([uid, val], i) => ({
      rank: i + 1,
      userId: uid,
      displayName: userNames.get(uid) ?? `Игрок ${uid}`,
      value: val,
      valueFormatted: String(val.toLocaleString('ru-RU')),
    }));
  }
}
