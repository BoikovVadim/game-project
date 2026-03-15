import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { DataSource, Repository } from 'typeorm';
import { existsSync, promises as fs } from 'fs';
import * as path from 'path';
import { User } from '../users/user.entity';
import { WithdrawalRequest } from '../users/withdrawal-request.entity';
import { Transaction } from '../users/transaction.entity';
import { UsersService } from '../users/users.service';
import { parsePaymentTopupDescription } from '../users/ruble-ledger-descriptions';
import { TournamentsService } from '../tournaments/tournaments.service';
import { JwtService } from '@nestjs/jwt';
import { type ImpersonationAuditScope } from '../auth/auth-session.types';

/** Нормализация дат в ISO-строку для фронтенда. */
function toISOUtc(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  const s = String(v).trim();
  if (s.includes('Z') || s.includes('+')) return s;
  return s.replace(' ', 'T') + 'Z';
}

function parseRubles(value: string | null | undefined): number {
  const normalized = String(value ?? '')
    .replace(/[₽\s]/g, '')
    .replace(',', '.')
    .trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function sanitizeProjectCostDescription(value: string): string {
  return value
    .replace(/\s*\([^()]*\)\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function parseDurationToMinutes(value: string | null | undefined): number {
  const text = String(value ?? '').trim();
  if (!text) return 0;
  const hours = text.match(/(\d+)\s*ч/);
  const minutes = text.match(/(\d+)\s*мин/);
  return Number(hours?.[1] ?? 0) * 60 + Number(minutes?.[1] ?? 0);
}

function formatDurationLabel(totalMinutes: number): string {
  const safeMinutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  if (hours > 0 && minutes > 0) return `${hours} ч ${minutes} мин`;
  if (hours > 0) return `${hours} ч`;
  return `${minutes} мин`;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatUtcDay(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(
    date.getUTCDate(),
  )}`;
}

function formatUtcMonth(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}`;
}

function getUtcIsoWeek(date: Date): string {
  const normalized = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = normalized.getUTCDay() || 7;
  normalized.setUTCDate(normalized.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(normalized.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((normalized.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${normalized.getUTCFullYear()}-${pad2(week)}`;
}

function parseDayPeriod(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function parseMonthPeriod(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = new Date(Date.UTC(year, month - 1, 1));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1) {
    return null;
  }
  return date;
}

function parseWeekPeriod(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const isoYear = Number(match[1]);
  const isoWeek = Number(match[2]);
  if (isoWeek < 1 || isoWeek > 53) return null;
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1 + (isoWeek - 1) * 7);
  return monday;
}

function buildContinuousPeriods(
  periods: string[],
  groupBy: 'day' | 'week' | 'month' | 'all',
): string[] {
  if (groupBy === 'all') return periods.length > 0 ? ['all'] : ['all'];

  const now = new Date();
  const uniquePeriods = [...new Set(periods)].sort();

  if (groupBy === 'day') {
    const start = parseDayPeriod(uniquePeriods[0] ?? '') ?? new Date();
    const end = parseDayPeriod(uniquePeriods[uniquePeriods.length - 1] ?? '') ?? new Date();
    const current = parseDayPeriod(formatUtcDay(now)) ?? now;
    const cursor = new Date(start > current ? current : start);
    const limit = end > current ? end : current;
    const filled: string[] = [];
    while (cursor <= limit) {
      filled.push(formatUtcDay(cursor));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return filled;
  }

  if (groupBy === 'week') {
    const start = parseWeekPeriod(uniquePeriods[0] ?? '') ?? new Date();
    const end = parseWeekPeriod(uniquePeriods[uniquePeriods.length - 1] ?? '') ?? new Date();
    const current = parseWeekPeriod(getUtcIsoWeek(now)) ?? now;
    const cursor = new Date(start > current ? current : start);
    const limit = end > current ? end : current;
    const filled: string[] = [];
    while (cursor <= limit) {
      filled.push(getUtcIsoWeek(cursor));
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
    return filled;
  }

  const start = parseMonthPeriod(uniquePeriods[0] ?? '') ?? new Date();
  const end = parseMonthPeriod(uniquePeriods[uniquePeriods.length - 1] ?? '') ?? new Date();
  const current = parseMonthPeriod(formatUtcMonth(now)) ?? now;
  const cursor = new Date(start > current ? current : start);
  cursor.setUTCDate(1);
  const limit = new Date(end > current ? end : current);
  limit.setUTCDate(1);
  const filled: string[] = [];
  while (cursor <= limit) {
    filled.push(formatUtcMonth(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1, 1);
  }
  return filled;
}

async function readProjectCostTrackingFile(): Promise<{
  content: string;
  filePath: string;
  mtime: Date;
} | null> {
  const candidates = [
    path.resolve(process.cwd(), '.cursor', 'project-cost-tracking.md'),
    path.resolve(process.cwd(), '..', '.cursor', 'project-cost-tracking.md'),
    path.resolve(__dirname, '../../.cursor/project-cost-tracking.md'),
    path.resolve(__dirname, '../../../.cursor/project-cost-tracking.md'),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const content = await fs.readFile(candidate, 'utf8');
    const stat = await fs.stat(candidate);
    return { content, filePath: candidate, mtime: stat.mtime };
  }

  return null;
}

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(WithdrawalRequest)
    private readonly withdrawalRepository: Repository<WithdrawalRequest>,
    private readonly usersService: UsersService,
    private readonly tournamentsService: TournamentsService,
    private readonly jwtService: JwtService,
    private readonly dataSource: DataSource,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  /** Список заявок на вывод. Явный SQL с джойном на админа, чтобы гарантированно отдавать логин и почту того, кто принял решение. */
  async getWithdrawalRequests(
    status?: 'pending' | 'approved' | 'rejected',
  ): Promise<
    (WithdrawalRequest & {
      processedByAdminUsername?: string | null;
      processedByAdminEmail?: string | null;
    })[]
  > {
    const statusCond = status ? ' WHERE w.status = $1' : '';
    const params = status ? [status] : [];
    const tryQuery = async (columns: {
      userIdCol: 'userId' | 'user_id';
      adminIdCol: 'processedByAdminId' | 'processed_by_admin_id';
      createdAtCol: 'createdAt' | 'created_at';
      processedAtCol: 'processedAt' | 'processed_at';
    }) => {
      const sql = `
        SELECT
          w.id,
          w."${columns.userIdCol}" AS "userId",
          w.amount,
          w.details,
          w.status,
          w."${columns.createdAtCol}" AS "createdAt",
          w."${columns.processedAtCol}" AS "processedAt",
          w."${columns.adminIdCol}" AS "processedByAdminId",
          u.username AS user_username, u.email AS user_email,
          a.username AS processedByAdminUsername, a.email AS processedByAdminEmail
        FROM withdrawal_request w
        LEFT JOIN "user" u ON u.id = w."${columns.userIdCol}"
        LEFT JOIN "user" a ON a.id = w."${columns.adminIdCol}"
        ${statusCond}
        ORDER BY w."${columns.createdAtCol}" DESC
      `;
      return this.dataSource.query(sql, params) as Promise<
        {
          id: number;
          userId: number;
          amount: number;
          details: string | null;
          status: string;
          createdAt: string;
          processedAt: string | null;
          processedByAdminId: number | null;
          user_username: string;
          user_email: string;
          processedByAdminUsername: string | null;
          processedByAdminEmail: string | null;
        }[]
      >;
    };
    try {
      let rows: Awaited<ReturnType<typeof tryQuery>>;
      try {
        rows = await tryQuery({
          userIdCol: 'userId',
          adminIdCol: 'processedByAdminId',
          createdAtCol: 'createdAt',
          processedAtCol: 'processedAt',
        });
      } catch (e1: any) {
        if (
          e1?.message?.includes('no such column') ||
          e1?.message?.includes('does not exist') ||
          e1?.message?.includes('processedByAdminId') ||
          e1?.message?.includes('userId') ||
          e1?.message?.includes('createdAt')
        ) {
          rows = await tryQuery({
            userIdCol: 'user_id',
            adminIdCol: 'processed_by_admin_id',
            createdAtCol: 'created_at',
            processedAtCol: 'processed_at',
          });
        } else {
          throw e1;
        }
      }
      return (rows || []).map((r) => ({
        id: r.id,
        userId: r.userId,
        amount: Number(r.amount),
        details: r.details,
        status: r.status,
        createdAt: toISOUtc(r.createdAt),
        processedAt: toISOUtc(r.processedAt),
        processedByAdminId: r.processedByAdminId ?? null,
        processedByAdminUsername: r.processedByAdminUsername ?? null,
        processedByAdminEmail: r.processedByAdminEmail ?? null,
        user: {
          id: r.userId,
          username: r.user_username || '',
          email: r.user_email || '',
        },
      })) as unknown as (WithdrawalRequest & {
        processedByAdminUsername?: string | null;
        processedByAdminEmail?: string | null;
      })[];
    } catch (e) {
      console.error('[AdminService.getWithdrawalRequests]', e);
      return [];
    }
  }

  /** Одобрить заявку: сумма уже снята при подаче — только записать транзакцию и отметить заявку. */
  async approveWithdrawal(
    requestId: number,
    adminId: number,
    comment?: string,
  ): Promise<WithdrawalRequest> {
    return this.dataSource.transaction(async (manager) => {
      const req = await manager
        .createQueryBuilder(WithdrawalRequest, 'wr')
        .setLock('pessimistic_write')
        .where('wr.id = :requestId', { requestId })
        .getOne();
      if (!req) throw new NotFoundException('Заявка не найдена');
      if (req.status !== 'pending')
        throw new BadRequestException('Заявка уже обработана');

      const amount = Number(req.amount);
      await this.usersService.addTransactionWithManager(
        manager,
        req.userId,
        -amount,
        UsersService.buildApprovedWithdrawalDescription(requestId),
        'withdraw',
      );

      req.status = 'approved';
      req.adminComment = comment || null;
      req.processedByAdminId = adminId;
      req.processedAt = new Date();
      return manager.save(req);
    });
  }

  /** Отклонить заявку: вернуть сумму на баланс (без записи транзакции — деньги формально оставались у игрока, только были заблокированы). */
  async rejectWithdrawal(
    requestId: number,
    adminId: number,
    comment?: string,
  ): Promise<WithdrawalRequest> {
    return this.dataSource.transaction(async (manager) => {
      const req = await manager
        .createQueryBuilder(WithdrawalRequest, 'wr')
        .setLock('pessimistic_write')
        .where('wr.id = :requestId', { requestId })
        .getOne();
      if (!req) throw new NotFoundException('Заявка не найдена');
      if (req.status !== 'pending')
        throw new BadRequestException('Заявка уже обработана');

      const user = await manager
        .createQueryBuilder(User, 'user')
        .setLock('pessimistic_write')
        .where('user.id = :userId', { userId: req.userId })
        .getOne();
      if (!user) throw new NotFoundException('User not found');

      const amount = Number(req.amount);
      user.balanceRubles = Number(user.balanceRubles ?? 0) + amount;
      await manager.save(user);

      req.status = 'rejected';
      req.adminComment = comment || null;
      req.processedByAdminId = adminId;
      req.processedAt = new Date();
      return manager.save(req);
    });
  }

  /** Список пользователей (кратко) — через то же подключение TypeORM, что и всё приложение */
  async getUsers(
    search?: string,
    limit = 500,
  ): Promise<
    {
      id: number;
      username: string;
      email: string;
      balance: number;
      balanceRubles: number;
      isAdmin: boolean;
    }[]
  > {
    const safeLimit = Math.min(Math.max(1, Number(limit) || 500), 1000);
    const q = search?.trim();
    let raw: any[];
    try {
      if (q) {
        const isNumeric = /^\d+$/.test(q);
        raw = isNumeric
          ? await this.dataSource.query(
              `SELECT id, username, email, balance, "balanceRubles", "isAdmin" FROM "user"
               WHERE id = $1 OR username LIKE $2 OR email LIKE $3
               ORDER BY (CASE WHEN id = $4 THEN 0 ELSE 1 END), id ASC LIMIT $5`,
              [Number(q), `%${q}%`, `%${q}%`, Number(q), safeLimit],
            )
          : await this.dataSource.query(
              'SELECT id, username, email, balance, "balanceRubles", "isAdmin" FROM "user" WHERE username LIKE $1 OR email LIKE $2 ORDER BY id ASC LIMIT $3',
              [`%${q}%`, `%${q}%`, safeLimit],
            );
      } else {
        raw = await this.dataSource.query(
          'SELECT id, username, email, balance, "balanceRubles", "isAdmin" FROM "user" ORDER BY id ASC LIMIT $1',
          [safeLimit],
        );
      }
    } catch (e) {
      console.error('[AdminService.getUsers] query error', e);
      return [];
    }
    return (raw || []).map((u: any) => ({
      id: Number(u.id),
      username: String(u.username ?? ''),
      email: String(u.email ?? ''),
      balance: Number(u.balance ?? 0),
      balanceRubles: Number(u.balanceRubles ?? 0),
      isAdmin: u.isAdmin === 1 || u.isAdmin === true || u.isAdmin === '1',
    }));
  }

  /** Назначить или снять флаг администратора с пользователя */
  async setUserAdmin(
    targetUserId: number,
    adminId: number,
    isAdmin: boolean,
  ): Promise<{ isAdmin: boolean }> {
    if (targetUserId === 1)
      throw new ForbiddenException(
        'Нельзя изменять права главного администратора',
      );
    const admin = await this.userRepository.findOne({
      where: { id: adminId },
      select: ['id', 'isAdmin'],
    });
    if (!admin?.isAdmin)
      throw new ForbiddenException('Требуются права администратора');
    const target = await this.userRepository.findOne({
      where: { id: targetUserId },
    });
    if (!target) throw new NotFoundException('Пользователь не найден');
    target.isAdmin = !!isAdmin;
    await this.userRepository.save(target);
    return { isAdmin: target.isAdmin };
  }

  /** Начислить баланс пользователю вручную (в рублях) */
  async creditBalance(
    adminId: number,
    targetUserId: number,
    amount: number,
    comment?: string,
  ): Promise<{ success: true; newBalanceRubles: number }> {
    const admin = await this.userRepository.findOne({
      where: { id: adminId },
      select: ['id', 'isAdmin', 'username'],
    });
    if (!admin?.isAdmin)
      throw new ForbiddenException('Требуются права администратора');
    if (!amount || amount <= 0)
      throw new BadRequestException('Сумма должна быть больше 0');
    return this.usersService.addManualAdminTopup(
      adminId,
      targetUserId,
      amount,
      comment,
    );
  }

  /** История ручных начислений */
  async getCreditHistory(): Promise<
    {
      id: number;
      userId: number;
      username: string;
      userEmail: string;
      amount: number;
      adminUsername: string;
      adminEmail: string;
      createdAt: string;
    }[]
  > {
    try {
      const rows = await this.dataSource.query(
        `SELECT
           t.id,
           t."userId" AS "userId",
           u.username,
           u.email AS "userEmail",
           t.amount,
           t.category,
           t.description,
           t."createdAt" AS "createdAt",
           t."tournamentId" AS "adminId",
           a.username AS "adminUsername",
           a.email AS "adminEmail"
         FROM "transaction" t
         LEFT JOIN "user" u ON u.id = t."userId"
         LEFT JOIN "user" a ON a.id = t."tournamentId"
         WHERE t.category = 'admin_credit'
            OR (t.category = 'topup' AND t.description LIKE 'Пополнение баланса администратором (ID %')
         ORDER BY t."createdAt" DESC
         LIMIT 500`,
      );
      const missingAdminIds = new Set<number>();
      for (const r of rows || []) {
        if (!r.adminUsername && r.description) {
          const m = String(r.description).match(/\(ID (\d+)\)/);
          if (m) missingAdminIds.add(Number(m[1]));
        }
      }
      const adminMap: Record<number, { username: string; email: string }> = {};
      if (missingAdminIds.size > 0) {
        const ids = Array.from(missingAdminIds);
        const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
        const admins = await this.dataSource.query(
          `SELECT id, username, email FROM "user" WHERE id IN (${placeholders})`,
          ids,
        );
        for (const a of admins || [])
          adminMap[Number(a.id)] = {
            username: String(a.username ?? ''),
            email: String(a.email ?? ''),
          };
      }
      return (rows || [])
        .map((r: any) => {
          const description = String(r.description ?? '').trim();
          const category = String(r.category ?? '');
          const parsedTopup = UsersService.parseAdminTopupDescription(
            description,
          );
          const parsedPaymentTopup = parsePaymentTopupDescription(description);
          const isLegacyManualTopup =
            (category === 'topup' || category === 'other') &&
            (description === 'Пополнение баланса' ||
              description === 'Пополнение баланса (скрипт)');
          const isManualAdminCredit =
            category === 'admin_credit' ||
            parsedTopup.adminId != null ||
            (isLegacyManualTopup && parsedPaymentTopup.paymentId == null);
          if (!isManualAdminCredit) return null;

          const parsedAdminId = parsedTopup.adminId;
          const fallbackAdminId = Number(r.adminId ?? 0) || null;
          const adminId = parsedAdminId ?? fallbackAdminId;
          const cached = adminId ? adminMap[adminId] : undefined;
          const adminName = String(r.adminUsername ?? cached?.username ?? '');
          const adminMail = String(r.adminEmail ?? cached?.email ?? '');
          return {
            id: Number(r.id),
            userId: Number(r.userId),
            username: String(r.username ?? ''),
            userEmail: String(r.userEmail ?? ''),
            amount: Number(r.amount),
            adminUsername: adminName,
            adminEmail: adminMail,
            createdAt: toISOUtc(r.createdAt) ?? '',
          };
        })
        .filter(Boolean) as {
        id: number;
        userId: number;
        username: string;
        userEmail: string;
        amount: number;
        adminUsername: string;
        adminEmail: string;
        createdAt: string;
      }[];
    } catch (e) {
      console.error('[AdminService.getCreditHistory]', e);
      return [];
    }
  }

  /** Статистика для админки: регистрации, выводы, пополнения, доход игры. groupBy: day|week|month|all */
  async getStats(groupBy: 'day' | 'week' | 'month' | 'all' = 'day'): Promise<{
    data: {
      period: string;
      registrations: number;
      withdrawals: number;
      topups: number;
      gameIncome: number;
    }[];
  }> {
    const cacheKey = `admin:stats:${groupBy}`;
    const cached = await this.cache.get<{ data: any[] }>(cacheKey);
    if (cached) return cached;

    const dateExpr =
      groupBy === 'day'
        ? `u."createdAt"::date::text`
        : groupBy === 'week'
          ? `TO_CHAR(u."createdAt", 'IYYY-IW')`
          : groupBy === 'month'
            ? `TO_CHAR(u."createdAt", 'YYYY-MM')`
            : `'all'`;
    const dateExprW =
      groupBy === 'day'
        ? `w."processedAt"::date::text`
        : groupBy === 'week'
          ? `TO_CHAR(w."processedAt", 'IYYY-IW')`
          : groupBy === 'month'
            ? `TO_CHAR(w."processedAt", 'YYYY-MM')`
            : `'all'`;
    const dateExprT =
      groupBy === 'day'
        ? `t."createdAt"::date::text`
        : groupBy === 'week'
          ? `TO_CHAR(t."createdAt", 'IYYY-IW')`
          : groupBy === 'month'
            ? `TO_CHAR(t."createdAt", 'YYYY-MM')`
            : `'all'`;

    try {
      const hasUserCreatedAt = await this.dataSource
        .query(
          `SELECT 1 FROM information_schema.columns WHERE table_name='user' AND column_name='createdAt'`,
        )
        .then((r: any[]) => r.length > 0);

      let regRows: { period: string; cnt: number }[] = [];
      if (hasUserCreatedAt) {
        regRows = await this.dataSource.query(
          `SELECT ${dateExpr} AS period, COUNT(*) AS cnt FROM "user" u WHERE u."createdAt" IS NOT NULL GROUP BY ${dateExpr} ORDER BY period`,
        );
      }

      const wRows = await this.dataSource.query(
        `SELECT ${dateExprW} AS period, COALESCE(SUM(w.amount), 0) AS amt FROM withdrawal_request w
         WHERE w.status = 'approved' AND w."processedAt" IS NOT NULL GROUP BY ${dateExprW} ORDER BY period`,
      );

      const topupRows = await this.dataSource.query(
        `SELECT ${dateExprT} AS period, COALESCE(SUM(t.amount), 0) AS amt FROM "transaction" t
         WHERE (t.category = 'topup' OR (t.category = 'other' AND (t.description LIKE '%пополнение%' OR t.description LIKE '%Пополнение%')))
         GROUP BY ${dateExprT} ORDER BY period`,
      );

      const gamePeriodExpr =
        groupBy === 'day'
          ? 'tr."createdAt"::date::text'
          : groupBy === 'week'
            ? `TO_CHAR(tr."createdAt", 'IYYY-IW')`
            : groupBy === 'month'
              ? `TO_CHAR(tr."createdAt", 'YYYY-MM')`
              : `'all'`;
      const gameIncomeRows = await this.dataSource.query(
        `SELECT period, SUM(income) AS income FROM (
          SELECT ${gamePeriodExpr} AS period,
            COALESCE(4 * (SELECT "leagueAmount" FROM tournament WHERE id = tr."tournamentId"), 0) -
            COALESCE(tr.amount, 0) -
            COALESCE((SELECT SUM(amount) FROM "transaction" WHERE category = 'referral' AND "tournamentId" = tr."tournamentId"), 0) AS income
          FROM "transaction" tr
          WHERE tr.category = 'win' AND tr."tournamentId" IS NOT NULL
        ) sub GROUP BY period ORDER BY period`,
      );

      const periods = new Set<string>();
      for (const r of regRows || []) periods.add(String(r.period));
      for (const r of wRows || []) periods.add(String(r.period));
      for (const r of topupRows || []) periods.add(String(r.period));
      for (const r of gameIncomeRows || []) periods.add(String(r.period));

      const regMap = new Map(
        (regRows || []).map((r: any) => [String(r.period), Number(r.cnt)]),
      );
      const wMap = new Map(
        (wRows || []).map((r: any) => [String(r.period), Number(r.amt)]),
      );
      const topupMap = new Map(
        (topupRows || []).map((r: any) => [String(r.period), Number(r.amt)]),
      );
      const gameMap = new Map(
        (gameIncomeRows || []).map((r: any) => [
          String(r.period),
          Number(r.income),
        ]),
      );

      const sorted = buildContinuousPeriods([...periods], groupBy);
      const data: {
        period: string;
        registrations: number;
        withdrawals: number;
        topups: number;
        gameIncome: number;
      }[] = sorted.map((p) => ({
        period: p,
        registrations: Number(regMap.get(p) ?? 0),
        withdrawals: Number(wMap.get(p) ?? 0),
        topups: Number(topupMap.get(p) ?? 0),
        gameIncome: Number(gameMap.get(p) ?? 0),
      }));

      const result = { data };
      await this.cache.set(cacheKey, result, 30000);
      return result;
    } catch (e) {
      console.error('[AdminService.getStats]', e);
      return { data: [] };
    }
  }

  /** Выдать JWT от имени пользователя (вход «под пользователем») */
  async getImpersonationToken(
    adminId: number,
    targetUserId: number,
  ): Promise<{ access_token: string; impersonation: ImpersonationAuditScope }> {
    const admin = await this.userRepository.findOne({
      where: { id: adminId },
      select: ['id', 'username', 'isAdmin'],
    });
    if (!admin?.isAdmin)
      throw new ForbiddenException('Требуются права администратора');
    const target = await this.userRepository.findOne({
      where: { id: targetUserId },
      select: ['id', 'username'],
    });
    if (!target) throw new NotFoundException('Пользователь не найден');
    const impersonation: ImpersonationAuditScope = {
      active: true,
      actorId: admin.id,
      actorUsername: admin.username,
      targetUserId: target.id,
      targetUsername: target.username,
      startedAt: new Date().toISOString(),
    };
    const token = this.jwtService.sign({
      username: target.username,
      sub: target.id,
      impersonation,
    });
    return { access_token: token, impersonation };
  }

  /** Все транзакции (пополнения, выводы, выигрыши) для админки */
  async getTransactions(category?: string): Promise<
    {
      id: number;
      userId: number;
      username: string;
      email: string;
      amount: number;
      description: string;
      category: string;
      createdAt: string;
    }[]
  > {
    const allowed = ['topup', 'withdraw', 'win', 'other'];
    const filterCat = category && allowed.includes(category) ? category : null;
    try {
      const catCondition = filterCat
        ? `AND t.category = $1`
        : `AND t.category IN ('topup', 'withdraw', 'win', 'other')`;
      const params = filterCat ? [filterCat] : [];
      const rows = await this.dataSource.query(
        `SELECT t.id, t."userId", u.username, u.email, t.amount, t.description, t.category, t."createdAt"
         FROM "transaction" t
         LEFT JOIN "user" u ON u.id = t."userId"
         WHERE 1=1 ${catCondition}
         ORDER BY t.id DESC
         LIMIT 2000`,
        params,
      );
      return (rows || []).map((r: any) => ({
        id: Number(r.id),
        userId: Number(r.userId),
        username: String(r.username ?? ''),
        email: String(r.email ?? ''),
        amount: Number(r.amount),
        description: String(r.description ?? ''),
        category: String(r.category ?? ''),
        createdAt: toISOUtc(r.createdAt) ?? '',
      }));
    } catch (e) {
      console.error('[AdminService.getTransactions]', e);
      return [];
    }
  }

  async getQuestionStats(): Promise<{ topic: string; count: number }[]> {
    try {
      const rows: { topic: string; count: string }[] =
        await this.dataSource.query(
          `SELECT topic, COUNT(*)::text AS count FROM question_pool GROUP BY topic ORDER BY COUNT(*) DESC`,
        );
      return rows.map((r) => ({ topic: r.topic, count: Number(r.count) }));
    } catch (e) {
      console.error('[AdminService.getQuestionStats]', e);
      return [];
    }
  }

  /** Все участия в турнирах по всем игрокам (для вкладки «Турниры» в статистике). */
  async getTournamentsList() {
    return this.tournamentsService.getAllParticipationsForAdmin();
  }

  async getProjectCostDashboard(): Promise<{
    currentTotal: number;
    todayTotal: number;
    updatedAt: string | null;
    totalDurationMinutes: number;
    totalDurationLabel: string;
    history: {
      timestamp: string | null;
      date: string;
      time: string | null;
      amountChange: number;
      afterAmount: number;
      duration: string;
      description: string;
    }[];
  }> {
    try {
      type RawProjectCostEntry = {
        timestamp: string | null;
        date: string;
        time: string | null;
        amountChange: number;
        duration: string;
        description: string;
      };

      const file = await readProjectCostTrackingFile();
      if (!file) {
        return {
          currentTotal: 0,
          todayTotal: 0,
          updatedAt: null,
          totalDurationMinutes: 0,
          totalDurationLabel: '0 мин',
          history: [],
        };
      }

      const lines = file.content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      const currentTotal = roundMoney(Number(lines[0] ?? 0));
      const todayTotal = parseRubles(lines[1]?.match(/:\s*(.+)$/)?.[1] ?? '0');
      const rawHistory: RawProjectCostEntry[] = [];
      for (const line of lines) {
        if (
          !/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?\s+\|/.test(line)
        )
          continue;
        const parts = line.split('|').map((part) => part.trim());
        if (parts.length < 4) continue;

        const [dateTimePart, amountPart, durationPart, ...descriptionParts] =
          parts;
        const dateTimeMatch = dateTimePart.match(
          /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2})(?::\d{2})?)?$/,
        );
        if (!dateTimeMatch) continue;

        const date = dateTimeMatch[1];
        const time = dateTimeMatch[2] ?? null;
        rawHistory.push({
          timestamp: time
            ? new Date(`${date}T${time}:00+03:00`).toISOString()
            : null,
          date,
          time,
          amountChange: roundMoney(parseRubles(amountPart)),
          duration: durationPart,
          description: sanitizeProjectCostDescription(
            descriptionParts.join(' | '),
          ),
        });
      }

      const totalChanges = rawHistory.reduce(
        (sum, entry) => sum + entry.amountChange,
        0,
      );
      const totalDurationMinutes = rawHistory.reduce(
        (sum, entry) => sum + parseDurationToMinutes(entry.duration),
        0,
      );
      let runningTotal = roundMoney(currentTotal - totalChanges);
      const historyAscending = [...rawHistory].reverse().map((entry) => {
        runningTotal = roundMoney(runningTotal + entry.amountChange);
        return {
          ...entry,
          afterAmount: runningTotal,
        };
      });

      return {
        currentTotal,
        todayTotal: roundMoney(todayTotal),
        updatedAt: file.mtime ? file.mtime.toISOString() : null,
        totalDurationMinutes,
        totalDurationLabel: formatDurationLabel(totalDurationMinutes),
        history: historyAscending.reverse(),
      };
    } catch (e) {
      console.error('[AdminService.getProjectCostDashboard]', e);
      return {
        currentTotal: 0,
        todayTotal: 0,
        updatedAt: null,
        totalDurationMinutes: 0,
        totalDurationLabel: '0 мин',
        history: [],
      };
    }
  }
}
