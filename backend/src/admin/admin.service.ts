import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { WithdrawalRequest } from '../users/withdrawal-request.entity';
import { Transaction } from '../users/transaction.entity';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';

/** SQLite хранит даты в UTC без суффикса; добавляем 'Z' чтобы фронтенд парсил их как UTC. */
function toISOUtc(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = String(v).trim();
  if (s.includes('Z') || s.includes('+')) return s;
  return s.replace(' ', 'T') + 'Z';
}

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(WithdrawalRequest)
    private readonly withdrawalRepository: Repository<WithdrawalRequest>,
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly dataSource: DataSource,
  ) {}

  /** Список заявок на вывод. Явный SQL с джойном на админа, чтобы гарантированно отдавать логин и почту того, кто принял решение. */
  async getWithdrawalRequests(status?: 'pending' | 'approved' | 'rejected'): Promise<(WithdrawalRequest & { processedByAdminUsername?: string | null; processedByAdminEmail?: string | null })[]> {
    const statusCond = status ? ' WHERE w.status = ?' : '';
    const params = status ? [status] : [];
    const tryQuery = async (adminIdCol: string) => {
      const sql = `
        SELECT w.id, w.userId, w.amount, w.details, w.status, w.createdAt, w.processedAt, w.${adminIdCol} AS processedByAdminId,
          u.username AS user_username, u.email AS user_email,
          a.username AS processedByAdminUsername, a.email AS processedByAdminEmail
        FROM withdrawal_request w
        LEFT JOIN "user" u ON u.id = w.userId
        LEFT JOIN "user" a ON a.id = w.${adminIdCol}
        ${statusCond}
        ORDER BY w.createdAt DESC
      `;
      return this.dataSource.query(sql, params) as Promise<{
        id: number; userId: number; amount: number; details: string | null; status: string; createdAt: string; processedAt: string | null;
        processedByAdminId: number | null;
        user_username: string; user_email: string;
        processedByAdminUsername: string | null; processedByAdminEmail: string | null;
      }[]>;
    };
    try {
      let rows: Awaited<ReturnType<typeof tryQuery>>;
      try {
        rows = await tryQuery('processedByAdminId');
      } catch (e1: any) {
        if (e1?.message?.includes('no such column') || e1?.message?.includes('processedByAdminId')) {
          rows = await tryQuery('processed_by_admin_id');
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
        user: { id: r.userId, username: r.user_username || '', email: r.user_email || '' },
      })) as unknown as (WithdrawalRequest & { processedByAdminUsername?: string | null; processedByAdminEmail?: string | null })[];
    } catch (e) {
      console.error('[AdminService.getWithdrawalRequests]', e);
      return [];
    }
  }

  /** Одобрить заявку: сумма уже снята при подаче — только записать транзакцию и отметить заявку. */
  async approveWithdrawal(requestId: number, adminId: number, comment?: string): Promise<WithdrawalRequest> {
    const req = await this.withdrawalRepository.findOne({
      where: { id: requestId },
      relations: ['user'],
    });
    if (!req) throw new NotFoundException('Заявка не найдена');
    if (req.status !== 'pending') throw new BadRequestException('Заявка уже обработана');
    const amount = Number(req.amount);
    await this.usersService.addTransaction(req.userId, -amount, `Заявка #${requestId}`, 'withdraw');
    req.status = 'approved';
    req.adminComment = comment || null;
    req.processedByAdminId = adminId;
    req.processedAt = new Date();
    await this.withdrawalRepository.save(req);
    return req;
  }

  /** Отклонить заявку: вернуть сумму на баланс (без записи транзакции — деньги формально оставались у игрока, только были заблокированы). */
  async rejectWithdrawal(requestId: number, adminId: number, comment?: string): Promise<WithdrawalRequest> {
    const req = await this.withdrawalRepository.findOne({ where: { id: requestId } });
    if (!req) throw new NotFoundException('Заявка не найдена');
    if (req.status !== 'pending') throw new BadRequestException('Заявка уже обработана');
    const amount = Number(req.amount);
    await this.usersService.restoreBalanceRublesAfterRejectedWithdrawal(req.userId, amount);
    req.status = 'rejected';
    req.adminComment = comment || null;
    req.processedByAdminId = adminId;
    req.processedAt = new Date();
    await this.withdrawalRepository.save(req);
    return req;
  }

  /** Список пользователей (кратко) — через то же подключение TypeORM, что и всё приложение */
  async getUsers(search?: string, limit = 500): Promise<{ id: number; username: string; email: string; balance: number; balanceRubles: number; isAdmin: boolean }[]> {
    const safeLimit = Math.min(Math.max(1, Number(limit) || 500), 1000);
    const q = search?.trim();
    let raw: any[];
    try {
      if (q) {
        const isNumeric = /^\d+$/.test(q);
        raw = isNumeric
          ? await this.dataSource.query(
              `SELECT id, username, email, balance, balanceRubles, isAdmin FROM "user"
               WHERE id = ? OR username LIKE ? OR email LIKE ?
               ORDER BY (CASE WHEN id = ? THEN 0 ELSE 1 END), id ASC LIMIT ?`,
              [Number(q), `%${q}%`, `%${q}%`, Number(q), safeLimit],
            )
          : await this.dataSource.query(
              'SELECT id, username, email, balance, balanceRubles, isAdmin FROM "user" WHERE username LIKE ? OR email LIKE ? ORDER BY id ASC LIMIT ?',
              [`%${q}%`, `%${q}%`, safeLimit],
            );
      } else {
        raw = await this.dataSource.query(
          'SELECT id, username, email, balance, balanceRubles, isAdmin FROM "user" ORDER BY id ASC LIMIT ?',
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
  async setUserAdmin(targetUserId: number, adminId: number, isAdmin: boolean): Promise<{ isAdmin: boolean }> {
    const admin = await this.userRepository.findOne({ where: { id: adminId }, select: ['id', 'isAdmin'] });
    if (!admin?.isAdmin) throw new ForbiddenException('Требуются права администратора');
    const target = await this.userRepository.findOne({ where: { id: targetUserId } });
    if (!target) throw new NotFoundException('Пользователь не найден');
    target.isAdmin = !!isAdmin;
    await this.userRepository.save(target);
    return { isAdmin: target.isAdmin };
  }

  /** Начислить баланс пользователю вручную (в рублях) */
  async creditBalance(adminId: number, targetUserId: number, amount: number, comment?: string): Promise<{ success: true; newBalanceRubles: number }> {
    const admin = await this.userRepository.findOne({ where: { id: adminId }, select: ['id', 'isAdmin', 'username'] });
    if (!admin?.isAdmin) throw new ForbiddenException('Требуются права администратора');
    const target = await this.userRepository.findOne({ where: { id: targetUserId } });
    if (!target) throw new NotFoundException('Пользователь не найден');
    if (!amount || amount <= 0) throw new BadRequestException('Сумма должна быть больше 0');
    target.balanceRubles = Number(target.balanceRubles ?? 0) + amount;
    await this.userRepository.save(target);
    await this.usersService.addTransaction(targetUserId, amount, 'Пополнение баланса', 'topup', adminId);
    return { success: true, newBalanceRubles: target.balanceRubles };
  }

  /** История ручных начислений */
  async getCreditHistory(): Promise<{ id: number; userId: number; username: string; userEmail: string; amount: number; adminUsername: string; adminEmail: string; createdAt: string }[]> {
    try {
      const rows = await this.dataSource.query(
        `SELECT t.id, t.userId, u.username, u.email AS userEmail, t.amount, t.description, t.createdAt,
           t.tournamentId AS adminId, a.username AS adminUsername, a.email AS adminEmail
         FROM "transaction" t
         LEFT JOIN "user" u ON u.id = t.userId
         LEFT JOIN "user" a ON a.id = t.tournamentId
         WHERE t.category = 'admin_credit' OR (t.category = 'topup' AND t.tournamentId IS NOT NULL)
         ORDER BY t.createdAt DESC
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
        const placeholders = ids.map(() => '?').join(',');
        const admins = await this.dataSource.query(
          `SELECT id, username, email FROM "user" WHERE id IN (${placeholders})`, ids,
        );
        for (const a of admins || []) adminMap[Number(a.id)] = { username: String(a.username ?? ''), email: String(a.email ?? '') };
      }
      return (rows || []).map((r: any) => {
        let adminName = String(r.adminUsername ?? '');
        let adminMail = String(r.adminEmail ?? '');
        if (!adminName && r.description) {
          const m = String(r.description).match(/от админа (.+?) \(ID (\d+)\)/);
          if (m) {
            const aid = Number(m[2]);
            const cached = adminMap[aid];
            adminName = cached?.username || m[1];
            adminMail = cached?.email || '';
          }
        }
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
      });
    } catch (e) {
      console.error('[AdminService.getCreditHistory]', e);
      return [];
    }
  }

  /** Статистика для админки: регистрации, выводы, пополнения, доход игры. groupBy: day|week|month|all */
  async getStats(groupBy: 'day' | 'week' | 'month' | 'all' = 'day'): Promise<{
    data: { period: string; registrations: number; withdrawals: number; topups: number; gameIncome: number }[];
  }> {
    const dateExpr = groupBy === 'day'
      ? `date(u.createdAt)`
      : groupBy === 'week'
        ? `strftime('%Y-%W', u.createdAt)`
        : groupBy === 'month'
          ? `strftime('%Y-%m', u.createdAt)`
          : `'all'`;
    const dateExprW = groupBy === 'day'
      ? `date(w.processedAt)`
      : groupBy === 'week'
        ? `strftime('%Y-%W', w.processedAt)`
        : groupBy === 'month'
          ? `strftime('%Y-%m', w.processedAt)`
          : `'all'`;
    const dateExprT = groupBy === 'day'
      ? `date(t.createdAt)`
      : groupBy === 'week'
        ? `strftime('%Y-%W', t.createdAt)`
        : groupBy === 'month'
          ? `strftime('%Y-%m', t.createdAt)`
          : `'all'`;

    try {
      const hasUserCreatedAt = await this.dataSource.query(
        `SELECT 1 FROM pragma_table_info('user') WHERE name='createdAt'`,
      ).then((r: any[]) => r.length > 0);

      let regRows: { period: string; cnt: number }[] = [];
      if (hasUserCreatedAt) {
        regRows = await this.dataSource.query(
          `SELECT ${dateExpr} AS period, COUNT(*) AS cnt FROM "user" u WHERE u.createdAt IS NOT NULL GROUP BY ${dateExpr} ORDER BY period`,
        );
      }

      const wRows = await this.dataSource.query(
        `SELECT ${dateExprW} AS period, COALESCE(SUM(w.amount), 0) AS amt FROM withdrawal_request w
         WHERE w.status = 'approved' AND w.processedAt IS NOT NULL GROUP BY ${dateExprW} ORDER BY period`,
      );

      const topupRows = await this.dataSource.query(
        `SELECT ${dateExprT} AS period, COALESCE(SUM(t.amount), 0) AS amt FROM "transaction" t
         WHERE (t.category = 'topup' OR (t.category = 'other' AND (t.description LIKE '%пополнение%' OR t.description LIKE '%Пополнение%')))
         GROUP BY ${dateExprT} ORDER BY period`,
      );

      const gamePeriodExpr = groupBy === 'day' ? 'date(tr.createdAt)' : groupBy === 'week' ? "strftime('%Y-%W', tr.createdAt)" : groupBy === 'month' ? "strftime('%Y-%m', tr.createdAt)" : "'all'";
      const gameIncomeRows = await this.dataSource.query(
        `SELECT period, SUM(income) AS income FROM (
          SELECT ${gamePeriodExpr} AS period,
            COALESCE(4 * (SELECT leagueAmount FROM tournament WHERE id = tr.tournamentId), 0) -
            COALESCE(tr.amount, 0) -
            COALESCE((SELECT SUM(amount) FROM "transaction" WHERE category = 'referral' AND tournamentId = tr.tournamentId), 0) AS income
          FROM "transaction" tr
          WHERE tr.category = 'win' AND tr.tournamentId IS NOT NULL
        ) GROUP BY period ORDER BY period`,
      );

      const periods = new Set<string>();
      for (const r of regRows || []) periods.add(String(r.period));
      for (const r of wRows || []) periods.add(String(r.period));
      for (const r of topupRows || []) periods.add(String(r.period));
      for (const r of gameIncomeRows || []) periods.add(String(r.period));

      const regMap = new Map((regRows || []).map((r: any) => [String(r.period), Number(r.cnt)]));
      const wMap = new Map((wRows || []).map((r: any) => [String(r.period), Number(r.amt)]));
      const topupMap = new Map((topupRows || []).map((r: any) => [String(r.period), Number(r.amt)]));
      const gameMap = new Map((gameIncomeRows || []).map((r: any) => [String(r.period), Number(r.income)]));

      const sorted = [...periods].sort();
      const data: { period: string; registrations: number; withdrawals: number; topups: number; gameIncome: number }[] = sorted.map((p) => ({
        period: p,
        registrations: Number(regMap.get(p) ?? 0),
        withdrawals: Number(wMap.get(p) ?? 0),
        topups: Number(topupMap.get(p) ?? 0),
        gameIncome: Number(gameMap.get(p) ?? 0),
      }));

      return { data };
    } catch (e) {
      console.error('[AdminService.getStats]', e);
      return { data: [] };
    }
  }

  /** Выдать JWT от имени пользователя (вход «под пользователем») */
  async getImpersonationToken(adminId: number, targetUserId: number): Promise<{ access_token: string }> {
    const admin = await this.userRepository.findOne({ where: { id: adminId }, select: ['id', 'isAdmin'] });
    if (!admin?.isAdmin) throw new ForbiddenException('Требуются права администратора');
    const target = await this.userRepository.findOne({ where: { id: targetUserId }, select: ['id', 'username'] });
    if (!target) throw new NotFoundException('Пользователь не найден');
    const token = this.jwtService.sign({ username: target.username, sub: target.id });
    return { access_token: token };
  }

  /** Все транзакции (пополнения, выводы, выигрыши) для админки */
  async getTransactions(category?: string): Promise<{
    id: number; userId: number; username: string; email: string;
    amount: number; description: string; category: string; createdAt: string;
  }[]> {
    const allowed = ['topup', 'withdraw', 'win', 'other'];
    const filterCat = category && allowed.includes(category) ? category : null;
    try {
      const catCondition = filterCat
        ? `AND t.category = ?`
        : `AND t.category IN ('topup', 'withdraw', 'win', 'other')`;
      const params = filterCat ? [filterCat] : [];
      const rows = await this.dataSource.query(
        `SELECT t.id, t.userId, u.username, u.email, t.amount, t.description, t.category, t.createdAt
         FROM "transaction" t
         LEFT JOIN "user" u ON u.id = t.userId
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
}
