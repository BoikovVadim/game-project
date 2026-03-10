import { BadRequestException, Inject, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { DataSource, In, MoreThanOrEqual, Repository } from 'typeorm';
import { generateReferralCode } from '../common/referral';
import { User } from './user.entity';
import { Transaction } from './transaction.entity';
import { WithdrawalRequest } from './withdrawal-request.entity';
import * as fs from 'fs';
import * as path from 'path';

/** Лиги по возрастанию (как в TournamentsService). */
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

const LEAGUE_MIN_BALANCE_MULTIPLIER = 10;
const LEAGUE_WINS_TO_UNLOCK = 10;

const LEAGUE_NAMES: Record<number, string> = {
  5: 'Янтарная лига', 10: 'Коралловая лига', 20: 'Нефритовая лига', 50: 'Агатовая лига',
  100: 'Аметистовая лига', 200: 'Топазовая лига', 500: 'Гранатовая лига', 1000: 'Изумрудовая лига',
  2000: 'Рубиновая лига', 5000: 'Сапфировая лига', 10000: 'Опаловая лига', 20000: 'Жемчужная лига',
  50000: 'Александритовая лига', 100000: 'Бриллиантовая лига', 200000: 'Лазуритовая лига',
  500000: 'Лига чёрного опала', 1000000: 'Алмазная лига',
};

function getMinBalanceForLeague(leagueIndex: number, amount: number): number {
  return leagueIndex === 0 ? amount : amount * LEAGUE_MIN_BALANCE_MULTIPLIER;
}

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
    this.normalizeRefundDescriptions().catch((err) =>
      console.error('[UsersService] normalizeRefundDescriptions:', err?.message || err),
    );
  }

  /** При старте приложения переписывает старые описания возвратов за турниры в формат «Возврат за турнир, {лига}, ID {id}». */
  private async normalizeRefundDescriptions(): Promise<void> {
    const rows = (await this.dataSource.query(
      `SELECT id, description, "tournamentId" FROM "transaction"
       WHERE category = 'refund' AND description IS NOT NULL AND description != ''`,
    )) as { id: number; description: string; tournamentId: number | null }[];
    const getLeagueName = (amount: number | null): string =>
      amount != null ? (LEAGUE_NAMES[amount] ?? `Лига ${amount} L`) : 'Лига';
    const isOldFormat = (d: string): boolean => {
      const lower = d.toLowerCase();
      return lower.includes('возврат взноса') && (lower.includes('турнир') || lower.includes('№'));
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
      await this.dataSource.query('UPDATE "transaction" SET description = $1 WHERE id = $2', [
        newDescription,
        row.id,
      ]);
    }
  }

  findAll() {
    return this.userRepository.find();
  }

  create(userData: { username: string; email: string; password: string }) {
    const user = this.userRepository.create(userData);
    return this.userRepository.save(user);
  }

  findById(id: number) {
    return this.userRepository.findOne({ where: { id } });
  }

  findByEmail(email: string) {
    return this.userRepository.findOne({ where: { email } });
  }

  /**
   * Итоговый рублёвый баланс: учитываются только транзакции, связанные с рублями (₽), не с L.
   * Учитываются: topup (пополнение), withdraw (вывод), convert (₽↔L), refund только по рублям.
   * Не учитываются: возврат по отклонённой заявке на вывод; любые refund, связанные с турнирами/L (взносы, возврат за турнир).
   */
  async getBalanceRublesFromTransactions(userId: number): Promise<number> {
    const rows = await this.dataSource.query(
      `SELECT category, amount, description, "tournamentId" FROM "transaction"
       WHERE "userId" = $1 AND category IN ('topup','withdraw','refund','convert')`,
      [userId],
    ) as { category: string; amount: number; description: string | null; tournamentId: number | null }[];
    const list = Array.isArray(rows) ? rows : [];
    let total = 0;
    for (const r of list) {
      if (UsersService.isRejectedWithdrawalRefund(r.description, r.category)) continue;
      if (UsersService.isNonRublesRefund(r.description, r.category, r.tournamentId)) continue;
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
    const rows = await this.dataSource.query(
      `SELECT category, amount, description, "tournamentId" FROM "transaction"
       WHERE "userId" = $1 AND category IN ('win','loss','referral','other','convert','refund')`,
      [userId],
    ) as { category: string; amount: number; description: string | null; tournamentId: number | null }[];
    const list = Array.isArray(rows) ? rows : [];
    let total = 0;
    for (const r of list) {
      if (UsersService.isRejectedWithdrawalRefund(r.description, r.category)) continue;
      if (r.category === 'refund' && !UsersService.isNonRublesRefund(r.description, r.category, r.tournamentId)) continue;
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
    const d = new Date(parseInt(m[1]!, 10), parseInt(m[2]!, 10) - 1, parseInt(m[3]!, 10));
    return isNaN(d.getTime()) ? null : d;
  }

  async getProfile(userId: number) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const balanceRublesFromTx = await this.forceReconcileBalanceRubles(userId);
    const balanceLFromTx = await this.forceReconcileBalanceL(userId);
    const escrowRows = await this.dataSource.query(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM tournament_escrow WHERE "userId" = $1 AND status = $2',
      [userId, 'held'],
    );
    const reservedBalance = escrowRows?.[0]?.total != null ? Number(escrowRows[0].total) : 0;
    const userAfter = await this.userRepository.findOne({ where: { id: userId } });
    if (!userAfter) throw new NotFoundException('User not found');
    const isAdmin = userId === 1 || !!userAfter.isAdmin;
    return {
      id: userAfter.id,
      username: userAfter.username,
      nickname: userAfter.nickname ?? null,
      email: userAfter.email,
      balance: balanceLFromTx,
      balanceRubles: balanceRublesFromTx,
      reservedBalance,
      referralCode: userAfter.referralCode ?? null,
      referrerId: userAfter.referrerId ?? null,
      isAdmin: !!isAdmin,
      gender: userAfter.gender ?? null,
      birthDate: userAfter.birthDate ?? null,
      avatarUrl: userAfter.avatarUrl ?? null,
      readNewsIds: Array.isArray(userAfter.readNewsIds) ? userAfter.readNewsIds : [],
    };
  }

  async markNewsAsRead(userId: number, newsId: number): Promise<{ readNewsIds: number[] }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const current: number[] = Array.isArray(user.readNewsIds) ? user.readNewsIds : [];
    if (!current.includes(newsId)) {
      current.push(newsId);
      user.readNewsIds = current;
      await this.userRepository.save(user);
    }
    return { readNewsIds: current };
  }

  async updateAvatar(userId: number, avatarData: string | null): Promise<{ avatarUrl: string | null }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (avatarData && avatarData.length > 14_000_000) {
      throw new BadRequestException('Файл слишком большой (макс. 10 МБ)');
    }
    user.avatarUrl = avatarData || null;
    await this.userRepository.save(user);
    return { avatarUrl: user.avatarUrl };
  }

  async updateNickname(userId: number, nickname: string | null): Promise<{ nickname: string | null }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const trimmed = nickname != null ? nickname.trim() : '';
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

  /** Возвращает реферальный код пользователя; при отсутствии генерирует и сохраняет */
  async getReferralCode(userId: number): Promise<string> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.referralCode) return user.referralCode;
    let code = generateReferralCode();
    while (await this.userRepository.findOne({ where: { referralCode: code } })) {
      code = generateReferralCode();
    }
    user.referralCode = code;
    await this.userRepository.save(user);
    return code;
  }

  /** Древо рефералов: 10 линий. Каждый пользователь возвращается с referrerId для связи родитель–потомок. */
  async getReferralTree(userId: number): Promise<{ rootUserId: number; levels: { id: number; displayName: string; referrerId: number | null; avatarUrl: string | null }[][] }> {
    const MAX_LEVELS = 10;
    const levels: { id: number; displayName: string; referrerId: number | null; avatarUrl: string | null }[][] = [];
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
          .select(['u.id', 'u.username', 'u.nickname', 'u.referrerId', 'u.avatarUrl'])
          .where('u.referrerId IN (:...ids)', { ids: parentIds })
          .getMany();
        const nextLevel = users.map((u) => {
          let displayName = (u.nickname && String(u.nickname).trim()) ? String(u.nickname).trim() : String(u.username);
          if (displayName.startsWith('ref_model_')) displayName = displayName.slice(0, 10);
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
  async seedReferralModel(currentUserId: number): Promise<{ created: number; message: string }> {
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
      const numChildren = maxThis === 0 ? 0 : Math.max(1, Math.floor(Math.random() * (maxThis + 1)));
      for (let i = 0; i < numChildren && created < TARGET; i++) {
        const id = await addUser(parentId);
        queue.push({ parentId: id, depth: depth + 1 });
      }
    }

    return { created, message: `Создана модель: ${created} человек в случайной структуре до ${MAX_DEPTH} линий.` };
  }

  /** Транзакции «Возврат по отклонённой заявке» не показываем и не учитываем в балансе (деньги формально оставались у игрока). */
  private static isRejectedWithdrawalRefund(description: string | null, category: string): boolean {
    if (category !== 'refund' || !description) return false;
    const d = description.toLowerCase().replace(/ё/g, 'е');
    return (d.includes('отклонен') && (d.includes('заявк') || d.includes('вывод')))
      || d.includes('возврат по отклонен')
      || (d.includes('возврат') && d.includes('заявк') && (d.includes('вывод') || d.includes('отклонен')));
  }

  /** Refund, связанные с L/турнирами: не учитывать в балансе в рублях (только рублёвые движения). */
  private static isNonRublesRefund(description: string | null, category: string, tournamentId?: number | null): boolean {
    if (category !== 'refund') return false;
    if (tournamentId != null) return true;
    if (!description) return false;
    const d = description.toLowerCase().replace(/ё/g, 'е');
    return d.includes('турнир') || d.includes('возврат за турнир') || d.includes('возврат взноса') || d.includes('лига');
  }

  async getTransactions(userId: number) {
    const list = await this.transactionRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    return list.filter(
      (t) => !UsersService.isRejectedWithdrawalRefund(t.description, t.category),
    );
  }

  /**
   * Распределяет реферальные начисления при победе реферала в турнире.
   * Формула: 4 × стоимость участия × % линии. Линия 1 — 2,36 %, линии 2–10 — 0,11 %.
   * Округление вниз до 2 знаков после запятой.
   * Начисление только тем, кто есть в цепочке — если вышестоящих меньше 10, платим только им.
   */
  async distributeReferralRewards(winnerId: number, leagueAmount: number, tournamentId: number): Promise<void> {
    const baseAmount = 4 * leagueAmount;
    const LINE1_PCT = 0.0236;
    const LINE2_10_PCT = 0.0011;

    let currentUserId: number | null = winnerId;
    for (let line = 1; line <= 10; line++) {
      const u = currentUserId ? await this.userRepository.findOne({ where: { id: currentUserId }, select: ['id', 'referrerId'] }) : null;
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

  async addTransaction(userId: number, amount: number, description: string, category: string = 'other', tournamentId?: number) {
    const transaction = this.transactionRepository.create({
      userId,
      amount,
      description,
      category,
      ...(tournamentId != null && { tournamentId }),
    });
    return this.transactionRepository.save(transaction);
  }

  /** Добавляет сумму на баланс L (для игр) и создаёт транзакцию. Атомарно через DB-транзакцию. */
  async addToBalanceL(userId: number, amount: number, description: string, category: 'win' | 'other' | 'referral' | 'refund' = 'win', tournamentId?: number): Promise<User> {
    if (amount <= 0) throw new BadRequestException('Сумма должна быть положительной');
    return this.dataSource.transaction(async (manager) => {
      const user = await manager.findOne(User, { where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');
      user.balance = Number(user.balance ?? 0) + amount;
      await manager.save(user);
      const tx = manager.create(Transaction, { userId, amount, description, category, ...(tournamentId != null && { tournamentId }) });
      await manager.save(tx);
      return user;
    });
  }

  /** Добавляет сумму на баланс в рублях (пополнение) и создаёт транзакцию. Атомарно через DB-транзакцию. */
  async addToBalance(userId: number, amount: number, description: string = 'Пополнение баланса'): Promise<User> {
    if (amount <= 0) throw new BadRequestException('Сумма должна быть положительной');
    return this.dataSource.transaction(async (manager) => {
      const user = await manager.findOne(User, { where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');
      user.balanceRubles = Number(user.balanceRubles ?? 0) + amount;
      await manager.save(user);
      const tx = manager.create(Transaction, { userId, amount, description, category: 'topup' });
      await manager.save(tx);
      return user;
    });
  }

  /** Конвертирует рубли в L или L в рубли. Атомарно через DB-транзакцию. */
  async convertCurrency(userId: number, amount: number, direction: 'rubles_to_l' | 'l_to_rubles'): Promise<{ balance: number; balanceRubles: number }> {
    const amt = Number(amount);
    if (!amt || amt <= 0) throw new BadRequestException('Сумма должна быть положительной');
    return this.dataSource.transaction(async (manager) => {
      const user = await manager.findOne(User, { where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');
      const balanceL = Number(user.balance ?? 0);
      const balanceRubles = Number(user.balanceRubles ?? 0);
      let newBalanceL: number;
      let newBalanceRubles: number;
      let txAmount: number;
      let txDesc: string;
      if (direction === 'rubles_to_l') {
        if (balanceRubles < amt) throw new BadRequestException('Недостаточно рублей для конвертации');
        newBalanceL = balanceL + amt;
        newBalanceRubles = balanceRubles - amt;
        txAmount = amt;
        txDesc = `${amt} ₽ → ${amt} L`;
      } else {
        if (balanceL < amt) throw new BadRequestException('Недостаточно L для конвертации');
        newBalanceL = balanceL - amt;
        newBalanceRubles = balanceRubles + amt;
        txAmount = -amt;
        txDesc = `${amt} L → ${amt} ₽`;
      }
      user.balance = newBalanceL;
      user.balanceRubles = newBalanceRubles;
      await manager.save(user);
      const tx = manager.create(Transaction, { userId, amount: txAmount, description: txDesc, category: 'convert' });
      await manager.save(tx);
      return { balance: newBalanceL, balanceRubles: newBalanceRubles };
    });
  }

  /** Списывает сумму с баланса L и создаёт транзакцию. Атомарно через DB-транзакцию. */
  async deductBalance(userId: number, amount: number, description: string, category: 'loss' | 'withdraw' = 'loss', tournamentId?: number): Promise<User> {
    return this.dataSource.transaction(async (manager) => {
      const user = await manager.findOne(User, { where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');
      if (user.balance < amount) throw new BadRequestException('Недостаточно средств на балансе');
      user.balance -= amount;
      await manager.save(user);
      const tx = manager.create(Transaction, { userId, amount: -amount, description, category, ...(tournamentId != null && { tournamentId }) });
      await manager.save(tx);
      return user;
    });
  }

  /** Списывает рубли с баланса в рублях (вывод средств) и создаёт транзакцию. Атомарно через DB-транзакцию. */
  async deductBalanceRubles(userId: number, amount: number, description: string): Promise<User> {
    if (amount <= 0) throw new BadRequestException('Сумма должна быть положительной');
    return this.dataSource.transaction(async (manager) => {
      const user = await manager.findOne(User, { where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');
      const rubles = Number(user.balanceRubles ?? 0);
      if (rubles < amount) throw new BadRequestException('Недостаточно средств на балансе в рублях');
      user.balanceRubles = rubles - amount;
      await manager.save(user);
      const tx = manager.create(Transaction, { userId, amount: -amount, description, category: 'withdraw' });
      await manager.save(tx);
      return user;
    });
  }

  /** Снять рубли с баланса без записи транзакции (резерв при подаче заявки на вывод). */
  async deductBalanceRublesHold(userId: number, amount: number): Promise<void> {
    if (amount <= 0) throw new BadRequestException('Сумма должна быть положительной');
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const rubles = Number(user.balanceRubles ?? 0);
    if (rubles < amount) throw new BadRequestException('Недостаточно средств на балансе в рублях');
    user.balanceRubles = rubles - amount;
    await this.userRepository.save(user);
  }

  /** Вернуть рубли на баланс и записать транзакцию (для реальных возвратов, не при отклонении заявки на вывод). */
  async refundBalanceRubles(userId: number, amount: number, description: string): Promise<User> {
    if (amount <= 0) throw new BadRequestException('Сумма должна быть положительной');
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    user.balanceRubles = Number(user.balanceRubles ?? 0) + amount;
    await this.userRepository.save(user);
    await this.addTransaction(userId, amount, description, 'refund');
    return user;
  }

  /** Вернуть рубли на баланс после отклонения заявки на вывод — без записи транзакции (деньги формально оставались у игрока, только были заблокированы). */
  async restoreBalanceRublesAfterRejectedWithdrawal(userId: number, amount: number): Promise<User> {
    if (amount <= 0) throw new BadRequestException('Сумма должна быть положительной');
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    user.balanceRubles = Number(user.balanceRubles ?? 0) + amount;
    await this.userRepository.save(user);
    return user;
  }

  /** Создать заявку на вывод средств (рубли). Сумма сразу снимается с баланса (без записи транзакции); при отклонении — возвращается. */
  async createWithdrawalRequest(userId: number, amount: number, details?: string): Promise<WithdrawalRequest> {
    const amountNum = Number(amount);
    if (!amountNum || amountNum < 100) throw new BadRequestException('Минимальная сумма вывода — 100 ₽');
    const detailsStr = (details?.trim() || '').slice(0, 500);
    if (!detailsStr) throw new BadRequestException('Укажите реквизиты для перевода (карта, счёт и т.д.)');
    await this.reconcileBalanceRubles(userId);
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const rubles = Number(user.balanceRubles ?? 0);
    if (rubles < amountNum) throw new BadRequestException('Недостаточно средств на балансе в рублях');

    user.balanceRubles = rubles - amountNum;
    await this.userRepository.save(user);

    try {
      const rows = await this.dataSource.query(
        'INSERT INTO withdrawal_request ("userId", amount, details, status) VALUES ($1, $2, $3, $4) RETURNING id, "userId", amount, details, status, "createdAt"',
        [userId, amountNum, detailsStr, 'pending'],
      ) as { id: number; userId: number; amount: number; details: string | null; status: string; createdAt: string }[];
      const row = rows?.[0];
      if (!row) throw new Error('Withdrawal request not found after insert');
      console.log('[Withdrawal] Created request id=%s userId=%s amount=%s', row.id, userId, amountNum);
      return {
        id: row.id,
        userId: row.userId,
        amount: row.amount,
        details: row.details,
        status: row.status,
        createdAt: row.createdAt,
      } as unknown as WithdrawalRequest;
    } catch (e) {
      console.error('[Withdrawal] INSERT failed, trying TypeORM save', e);
      const req = this.withdrawalRepository.create({ userId, amount: amountNum, details: detailsStr, status: 'pending' });
      const saved = await this.withdrawalRepository.save(req);
      console.log('[Withdrawal] Created via TypeORM id=%s', saved.id);
      return saved;
    }
  }

  /** Список заявок на вывод текущего пользователя (для личного кабинета). */
  async getMyWithdrawalRequests(userId: number): Promise<WithdrawalRequest[]> {
    return this.withdrawalRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async updateBalance(userId: number, newBalance: number) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    const oldBalance = user.balance;
    const difference = newBalance - oldBalance;
    user.balance = newBalance;
    await this.userRepository.save(user);
    // Добавить транзакцию
    await this.addTransaction(userId, difference, `Баланс изменён на ${newBalance} L`, 'other');
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
        await this.addTransaction(userId, difference, `Баланс ручного импорта: +${difference} L`, 'other');
        results.push({ id: userId, username, oldBalance, newBalance, difference });
      }
    }
    return results;
  }

  async getStats(userId: number): Promise<{
    gamesPlayed: number;
    gamesPlayedTraining: number;
    gamesPlayedMoney: number;
    completedMatches: number;
    completedMatchesTraining: number;
    completedMatchesMoney: number;
    wins: number;
    winsTraining: number;
    winsMoney: number;
    winRatePercent: number | null;
    correctAnswers: number;
    totalQuestions: number;
    correctAnswersTraining: number;
    totalQuestionsTraining: number;
    correctAnswersMoney: number;
    totalQuestionsMoney: number;
    totalWinnings: number;
    totalWithdrawn: number;
    maxLeague: number | null;
    maxLeagueName: string | null;
  }> {
    const empty = {
      gamesPlayed: 0,
      gamesPlayedTraining: 0,
      gamesPlayedMoney: 0,
      completedMatches: 0,
      completedMatchesTraining: 0,
      completedMatchesMoney: 0,
      wins: 0,
      winsTraining: 0,
      winsMoney: 0,
      winRatePercent: null as number | null,
      correctAnswers: 0,
      totalQuestions: 0,
      correctAnswersTraining: 0,
      totalQuestionsTraining: 0,
      correctAnswersMoney: 0,
      totalQuestionsMoney: 0,
      totalWinnings: 0,
      totalWithdrawn: 0,
      maxLeague: null as number | null,
      maxLeagueName: null as string | null,
    };
    try {
    const cacheKey = `user:stats:${userId}`;
    const cached = await this.cache.get<typeof empty>(cacheKey);
    if (cached) return cached;

    const manager = this.userRepository.manager;

    const gamesPlayedRow = await manager.query(
      'SELECT COUNT(DISTINCT tp."tournamentId") as cnt FROM tournament_players_user tp INNER JOIN tournament t ON t.id = tp."tournamentId" WHERE tp."userId" = $1',
      [userId],
    );
    const gamesPlayed = Number(gamesPlayedRow?.[0]?.cnt) || 0;

    const trainingRow = await manager.query(
      `SELECT COUNT(DISTINCT tp."tournamentId") as cnt FROM tournament_players_user tp INNER JOIN tournament t ON t.id = tp."tournamentId" WHERE tp."userId" = $1 AND (t."gameType" = 'training' OR t."gameType" IS NULL)`,
      [userId],
    );
    const gamesPlayedTraining = Number(trainingRow?.[0]?.cnt) || 0;

    const moneyRow = await manager.query(
      `SELECT COUNT(DISTINCT tp."tournamentId") as cnt FROM tournament_players_user tp INNER JOIN tournament t ON t.id = tp."tournamentId" WHERE tp."userId" = $1 AND t."gameType" = 'money'`,
      [userId],
    );
    const gamesPlayedMoney = Number(moneyRow?.[0]?.cnt) || 0;

    // Победы за деньги: passed=1 в tournament_result.
    const winsMoneyRow = await manager.query(
      `SELECT COUNT(*) as cnt FROM tournament_result r
       INNER JOIN tournament t ON t.id = r."tournamentId"
       WHERE r."userId" = $1 AND r.passed = 1 AND t."gameType" = 'money'`,
      [userId],
    );
    const winsMoney = Number(winsMoneyRow?.[0]?.cnt) || 0;

    // Победы в тренировках: passed=1 в tournament_result (победа в финале).
    const winsTrainingRow = await manager.query(
      `SELECT COUNT(*) as cnt FROM tournament_result r
       INNER JOIN tournament t ON t.id = r."tournamentId"
       WHERE r."userId" = $1 AND r.passed = 1 AND (t."gameType" = 'training' OR t."gameType" IS NULL)`,
      [userId],
    );
    const winsTraining = Number(winsTrainingRow?.[0]?.cnt) || 0;

    const wins = winsMoney + winsTraining;

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
      `SELECT t.id as tid FROM tournament t
       INNER JOIN tournament_players_user tpu ON tpu."tournamentId" = t.id
       WHERE t."gameType" = 'money' AND tpu."userId" = $1
       AND t.id IN (SELECT "tournamentId" FROM tournament_players_user GROUP BY "tournamentId" HAVING COUNT(*) >= 2)`,
      [userId],
    );
    const moneyTourIds = ((moneyToursRow as { tid: number }[]) || []).map((r) => r.tid);
    let totalMoneyWithResult = 0;
    for (const tid of moneyTourIds) {
      const playersRow = (await manager.query(
        `SELECT "userId" FROM tournament_players_user WHERE "tournamentId" = $1 ORDER BY "userId"`,
        [tid],
      )) as { userId: number }[];
      if (playersRow.length < 2) continue;
      const playerIds = playersRow.map((r) => r.userId);
      const userSlot = playerIds.indexOf(userId);
      if (userSlot < 0) continue;
      const opponentSlot = userSlot % 2 === 0 ? userSlot + 1 : userSlot - 1;
      if (opponentSlot < 0 || opponentSlot >= playerIds.length) continue;
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
    const totalQuestionsTraining = Number(questionsTrainingRow?.[0]?.cnt) || 0;

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
      completedMatches > 0 ? parseFloat(((wins / completedMatches) * 100).toFixed(2)) : null;

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
      const user = await this.userRepository.findOne({ where: { id: userId } });
      const balance = user ? Number(user.balance ?? 0) || 0 : 0;
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
        if (prevAmount != null && wins(prevAmount) < LEAGUE_WINS_TO_UNLOCK) continue;
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
    metric: 'gamesPlayed' | 'wins' | 'totalWinnings' | 'correctAnswers' | 'correctAnswerRate' | 'referrals' | 'totalWithdrawn',
    userId: number,
  ): Promise<{
    rankings: { rank: number; userId: number; displayName: string; value: number; valueFormatted: string }[];
    myRank: number | null;
    myValue: number | null;
    totalParticipants: number;
  }> {
    const manager = this.userRepository.manager;
    let query: string;
    let valueCol: string;
    const desc = true; // больше = лучше для всех метрик

    switch (metric) {
      case 'gamesPlayed':
        query = `SELECT u.id as "userId", COALESCE(u.nickname, u.username) as "displayName",
          (SELECT COUNT(DISTINCT tp."tournamentId") FROM tournament_players_user tp
           INNER JOIN tournament t ON t.id = tp."tournamentId" WHERE tp."userId" = u.id) as val
          FROM "user" u
          WHERE (SELECT COUNT(DISTINCT tp."tournamentId") FROM tournament_players_user tp WHERE tp."userId" = u.id) > 0
          ORDER BY val DESC, u.id DESC`;
        valueCol = 'val';
        break;
      case 'wins':
        query = `SELECT u.id as "userId", COALESCE(u.nickname, u.username) as "displayName",
          (SELECT COUNT(*) FROM tournament_result r INNER JOIN tournament t ON t.id = r."tournamentId"
           WHERE r."userId" = u.id AND r.passed = 1 AND t."gameType" = 'money') as val
          FROM "user" u
          WHERE (SELECT COUNT(*) FROM tournament_result r INNER JOIN tournament t ON t.id = r."tournamentId"
                 WHERE r."userId" = u.id AND r.passed = 1 AND t."gameType" = 'money') > 0
          ORDER BY val DESC, u.id DESC`;
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
      let rankings: { rank: number; userId: number; displayName: string; value: number; valueFormatted: string }[];
      const cached = await this.cache.get<typeof rankings>(cacheKey);
      if (cached) {
        rankings = cached;
      } else {
        const rows = (await manager.query(query)) as { userId: number; displayName: string; val: number }[];
        rankings = rows.map((r, i) => ({
          rank: i + 1,
          userId: r.userId,
          displayName: String(r.displayName || `Игрок ${r.userId}`).trim() || `Игрок ${r.userId}`,
          value: Number(r.val) || 0,
          valueFormatted: metric === 'totalWinnings' ? `${Number(r.val).toLocaleString('ru-RU')} L`
            : metric === 'totalWithdrawn' ? `${Number(r.val).toLocaleString('ru-RU')} ₽`
            : metric === 'correctAnswerRate' ? `${Number(r.val).toLocaleString('ru-RU')}%`
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
            `SELECT COUNT(*) as cnt FROM "user" WHERE "referrerId" = $1`, [userId],
          );
          myValue = Number(refRow?.[0]?.cnt ?? 0);
        } else if (metric === 'totalWithdrawn') {
          const wdRow = await manager.query(
            `SELECT COALESCE(SUM(amount), 0) as total FROM withdrawal_request WHERE "userId" = $1 AND status = 'approved'`, [userId],
          );
          myValue = Number(wdRow?.[0]?.total ?? 0);
        } else {
          const myStats = await this.getStats(userId);
          myValue = metric === 'gamesPlayed' ? myStats.gamesPlayed
            : metric === 'wins' ? myStats.wins
            : metric === 'totalWinnings' ? myStats.totalWinnings
            : metric === 'correctAnswerRate' ? (myStats.totalQuestions > 0 ? parseFloat(((myStats.correctAnswers / myStats.totalQuestions) * 100).toFixed(2)) : 0)
            : myStats.correctAnswers;
        }
        const betterCount = rankings.filter((r) => r.value > (myValue ?? 0)).length;
        myRank = betterCount + 1;
      }
      const totalUsers = await manager.query('SELECT COUNT(*) as cnt FROM "user"');
      const totalParticipants = Math.max(Number(totalUsers?.[0]?.cnt ?? 0), rankings.length);
      return { rankings, myRank, myValue, totalParticipants };
    } catch (err) {
      console.error('[getRankings]', err);
      return { rankings: [], myRank: null, myValue: null, totalParticipants: 0 };
    }
  }

  /** Глобальная статичная статистика: всего пользователей, онлайн, общий заработок игроков, сыграно игр/турниров. */
  async getGlobalStats(): Promise<{
    totalUsers: number;
    onlineCount: number;
    totalEarnings: number;
    totalGamesPlayed: number;
    totalTournaments: number;
    totalWithdrawn: number;
  }> {
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
      const rows = await manager.query(
        `SELECT COUNT(*) as cnt FROM tournament_progress WHERE "questionsAnsweredCount" > 0`,
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
    return { totalUsers, onlineCount, totalEarnings, totalGamesPlayed, totalTournaments, totalWithdrawn };
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
  ): Promise<{ data: { date: string; value: number }[]; availableMetrics: string[] }> {
    const manager = this.userRepository.manager;
    const availableMetrics = ['gamesPlayed', 'wins', 'totalWinnings', 'correctAnswers'];

    const from = UsersService.parseDate(fromDate) ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = UsersService.parseDate(toDate) ?? new Date();
    if (from > to) return { data: [], availableMetrics };

    const fromStr = UsersService.toLocalDateStr(from);
    const toStr = UsersService.toLocalDateStr(to);

    const days: string[] = [];
    for (let d = new Date(from.getTime()); d <= to; d.setDate(d.getDate() + 1)) {
      days.push(UsersService.toLocalDateStr(d));
    }

    const gameTypeTraining = gameType === 'training' ? ` AND (t."gameType" = 'training' OR t."gameType" IS NULL)` : '';
    const gameTypeMoney = gameType === 'money' ? ` AND t."gameType" = 'money'` : '';
    const gameTypeFilter = gameType === 'all' ? '' : gameType === 'training' ? gameTypeTraining : gameTypeMoney;

    let rows: { d: string; val: number }[] = [];
    try {
      switch (metric) {
        case 'gamesPlayed':
          rows = (await manager.query(
            `SELECT t."createdAt"::date::text as d, COUNT(DISTINCT t.id) as val
             FROM tournament t
             INNER JOIN tournament_players_user tp ON tp."tournamentId" = t.id
             WHERE tp."userId" = $1 AND t."createdAt"::date >= $2::date AND t."createdAt"::date <= $3::date
             ${gameTypeFilter}
             GROUP BY t."createdAt"::date::text`,
            [userId, fromStr, toStr],
          )) as { d: string; val: number }[];
          break;
        case 'wins': {
          const byDate = new Map<string, number>();
          for (const day of days) byDate.set(day, 0);

          if (gameType === 'money' || gameType === 'all') {
            const moneyRows = (await manager.query(
              `SELECT t."createdAt"::date::text as d, COUNT(*) as val
               FROM tournament_result r
               INNER JOIN tournament t ON t.id = r."tournamentId"
               WHERE r."userId" = $1 AND r.passed = 1 AND t."gameType" = 'money' AND t."createdAt"::date >= $2::date AND t."createdAt"::date <= $3::date
               GROUP BY t."createdAt"::date::text`,
              [userId, fromStr, toStr],
            )) as { d: string; val: number }[];
            for (const r of moneyRows) {
              const d = r.d && String(r.d).slice(0, 10);
              if (d) byDate.set(d, (byDate.get(d) ?? 0) + (Number(r.val) || 0));
            }
          }

          if (gameType === 'training' || gameType === 'all') {
            const trainingToursRow = (await manager.query(
              `SELECT t.id as tid, t."createdAt"::date::text as d
               FROM tournament t
               INNER JOIN tournament_players_user tpu ON tpu."tournamentId" = t.id
               WHERE (t."gameType" = 'training' OR t."gameType" IS NULL) AND tpu."userId" = $1
               AND t.id IN (SELECT "tournamentId" FROM tournament_players_user GROUP BY "tournamentId" HAVING COUNT(*) = 2)
               AND t."createdAt"::date >= $2::date AND t."createdAt"::date <= $3::date`,
              [userId, fromStr, toStr],
            )) as { tid: number; d: string }[];
            const QUESTIONS_PER_ROUND = 10;
            for (const row of trainingToursRow) {
              const tid = row.tid;
              const dateStr = row.d && String(row.d).slice(0, 10);
              if (!dateStr || !days.includes(dateStr)) continue;
              const progressRows = (await manager.query(
                `SELECT p."userId", p."semiFinalCorrectCount" as semi, p."questionsAnsweredCount" as q, p."tiebreakerRoundsCorrect" as tb
                 FROM tournament_progress p WHERE p."tournamentId" = $1`,
                [tid],
              )) as { userId: number; semi: number | null; q: number; tb: string | null }[];
              const byUser = new Map<number, { semi: number; q: number; tb: number[] }>();
              for (const r of progressRows) {
                let tb: number[] = [];
                try {
                  tb = typeof r.tb === 'string' ? (JSON.parse(r.tb || '[]') as number[]) : (r.tb as number[] | null) ?? [];
                } catch {
                  tb = [];
                }
                byUser.set(r.userId, { semi: r.semi ?? 0, q: r.q, tb });
              }
              if (byUser.size !== 2) continue;
              const [[uidA, progA], [uidB, progB]] = Array.from(byUser.entries());
              if (progA.q < QUESTIONS_PER_ROUND || progB.q < QUESTIONS_PER_ROUND) continue;
              const myProg = uidA === userId ? progA : progB;
              const oppProg = uidA === userId ? progB : progA;
              let won = false;
              if (myProg.semi > oppProg.semi) won = true;
              else if (myProg.semi === oppProg.semi) {
                for (let r = 0; r < 50; r++) {
                  const myR = myProg.tb[r] ?? 0;
                  const oppR = oppProg.tb[r] ?? 0;
                  if (myR > oppR) {
                    won = true;
                    break;
                  }
                  if (myR < oppR) break;
                }
              }
              if (won) byDate.set(dateStr, (byDate.get(dateStr) ?? 0) + 1);
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
      return { data: days.map((date) => ({ date, value: 0 })), availableMetrics };
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
  ): Promise<{ data: { date: string; value: number }[]; availableMetrics: string[] }> {
    const manager = this.userRepository.manager;
    const availableMetrics = ['referralCount', 'referralEarnings'];

    const from = UsersService.parseDate(fromDate) ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = UsersService.parseDate(toDate) ?? new Date();
    if (from > to) return { data: [], availableMetrics };

    const fromStr = UsersService.toLocalDateStr(from);
    const toStr = UsersService.toLocalDateStr(to);

    const days: string[] = [];
    for (let d = new Date(from.getTime()); d <= to; d.setDate(d.getDate() + 1)) {
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
      return { data: days.map((date) => ({ date, value: 0 })), availableMetrics };
    }

    const byDate = new Map<string, number>();
    for (const r of rows) {
      const d = r.d && String(r.d).slice(0, 10);
      if (d) byDate.set(d, Number(r.val) || 0);
    }
    const data = days.map((date) => ({ date, value: byDate.get(date) ?? 0 }));
    return { data, availableMetrics };
  }
}