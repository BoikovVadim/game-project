import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { type PaymentProvider } from '../payments/payment.entity';
import { User } from './user.entity';
import { Transaction } from './transaction.entity';
import {
  buildAdminTopupDescription,
  buildPaymentTopupDescription,
  parseAdminTopupDescription,
  parsePaymentTopupDescription,
} from './ruble-ledger-descriptions';
import { UserBalanceLedgerService } from './user-balance-ledger.service';

@Injectable()
export class UserRubleTopupService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    private readonly dataSource: DataSource,
    private readonly userBalanceLedgerService: UserBalanceLedgerService,
  ) {}

  private async getLockedUser(
    manager: EntityManager,
    userId: number,
  ): Promise<User> {
    const user = await manager.findOne(User, {
      where: { id: userId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!user) throw new NotFoundException('Пользователь не найден');
    return user;
  }

  async addTransactionWithManager(
    manager: EntityManager,
    userId: number,
    amount: number,
    description: string,
  ) {
    const transaction = manager.create(Transaction, {
      userId,
      amount,
      description,
      category: 'topup',
    });
    return manager.save(transaction);
  }

  async creditRublesWithManager(
    manager: EntityManager,
    userId: number,
    amount: number,
    description: string,
  ): Promise<User> {
    if (amount <= 0) {
      throw new BadRequestException('Сумма должна быть положительной');
    }
    const user = await this.getLockedUser(manager, userId);
    user.balanceRubles = Number(user.balanceRubles ?? 0) + amount;
    await manager.save(user);
    await this.addTransactionWithManager(manager, userId, amount, description);
    return user;
  }

  async addToBalance(
    userId: number,
    amount: number,
    description: string = 'Пополнение баланса',
  ): Promise<User> {
    if (amount <= 0) {
      throw new BadRequestException('Сумма должна быть положительной');
    }
    return this.dataSource.transaction((manager) =>
      this.creditRublesWithManager(manager, userId, amount, description),
    );
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
        buildAdminTopupDescription(adminId, comment),
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
    const legacyRows = await this.dataSource.query<
      Array<{
        id: number;
        userId: number;
        description: string | null;
        tournamentId: number | null;
      }>
    >(
      `SELECT id, "userId", description, "tournamentId"
       FROM "transaction"
       WHERE category = 'admin_credit'
       ORDER BY id ASC`,
    );

    if (legacyRows.length === 0) {
      return { updatedCount: 0, affectedUserIds: [] };
    }

    const affectedUserIds = new Set<number>();
    await this.dataSource.transaction(async (manager) => {
      for (const row of legacyRows) {
        const adminId =
          row.tournamentId != null ? Number(row.tournamentId) : null;
        const parsed = parseAdminTopupDescription(row.description);
        const legacyComment =
          (row.description?.trim() || '') === 'Пополнение баланса'
            ? null
            : (row.description ?? null);
        const normalizedDescription =
          adminId && adminId > 0
            ? buildAdminTopupDescription(
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

    await this.userBalanceLedgerService.reconcileAllStoredBalances(
      Array.from(affectedUserIds),
    );

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
    const payments = await this.dataSource.query<
      Array<{
        id: number;
        userId: number;
        amount: number;
        provider: PaymentProvider;
        externalId: string | null;
        status: string;
        createdAt: string | Date;
      }>
    >(
      `SELECT id, "userId", amount, provider, "externalId", status, "createdAt"
       FROM payment
       WHERE status = 'succeeded'
       ORDER BY id ASC`,
    );

    if (payments.length === 0) {
      return { insertedCount: 0, normalizedCount: 0, affectedUserIds: [] };
    }

    const rows = await this.dataSource.query<
      Array<{
        id: number;
        userId: number;
        amount: number;
        category: string;
        description: string | null;
        createdAt: string | Date;
      }>
    >(
      `SELECT id, "userId", amount, category, description, "createdAt"
       FROM "transaction"
       WHERE category = 'topup'
       ORDER BY id ASC`,
    );

    const affectedUserIds = new Set<number>();
    let insertedCount = 0;
    let normalizedCount = 0;
    const matchedTransactionIds = new Set<number>();

    await this.dataSource.transaction(async (manager) => {
      for (const payment of payments) {
        const structuredDescription = buildPaymentTopupDescription(
          payment.provider,
          Number(payment.id),
          payment.externalId,
        );

        const exactMatch = rows.find((row) => {
          if (matchedTransactionIds.has(row.id)) return false;
          const parsed = parsePaymentTopupDescription(row.description);
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
          if (Math.abs(Number(row.amount) - Number(payment.amount)) >= 0.01) {
            return false;
          }
          const desc = String(row.description ?? '').trim();
          if (!desc) return false;
          if (parseAdminTopupDescription(desc).adminId) return false;
          if (!desc.toLowerCase().includes('пополнение')) return false;
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
        );
        insertedCount += 1;
        affectedUserIds.add(Number(payment.userId));
      }
    });

    await this.userBalanceLedgerService.reconcileAllStoredBalances(
      Array.from(affectedUserIds),
    );

    return {
      insertedCount,
      normalizedCount,
      affectedUserIds: Array.from(affectedUserIds),
    };
  }
}
