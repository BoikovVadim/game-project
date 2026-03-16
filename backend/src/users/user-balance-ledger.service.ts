import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { User } from './user.entity';
import { Transaction } from './transaction.entity';
import { WithdrawalRequest } from './withdrawal-request.entity';
import {
  applyLedgerTransactionToBalanceState,
  type LedgerBalanceRow,
  type LedgerBalanceState,
} from './transaction-balance-history';

export type ComputedBalanceMaps = {
  rubles: Map<number, number>;
  balanceL: Map<number, number>;
  pendingWithdrawals: Map<number, number>;
  heldEscrow: Map<number, number>;
};

export type ComputedUserBalanceState = {
  rubles: number;
  balanceL: number;
  pendingWithdrawals: number;
  heldEscrow: number;
};

@Injectable()
export class UserBalanceLedgerService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Transaction)
    private readonly _transactionRepository: Repository<Transaction>,
    @InjectRepository(WithdrawalRequest)
    private readonly _withdrawalRepository: Repository<WithdrawalRequest>,
    private readonly dataSource: DataSource,
  ) {}

  private static applyLedgerRow(
    current: LedgerBalanceState,
    row: LedgerBalanceRow,
  ): LedgerBalanceState {
    return applyLedgerTransactionToBalanceState(current, row);
  }

  async getComputedBalanceStateForUser(
    userId: number,
  ): Promise<ComputedUserBalanceState> {
    const maps = await this.getComputedBalanceMapsForUsers([userId]);
    return {
      rubles: maps.rubles.get(userId) ?? 0,
      balanceL: maps.balanceL.get(userId) ?? 0,
      pendingWithdrawals: maps.pendingWithdrawals.get(userId) ?? 0,
      heldEscrow: maps.heldEscrow.get(userId) ?? 0,
    };
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

    const txRows = await this.dataSource.query<
      {
        userId: number;
        category: string;
        amount: number | string;
        description: string | null;
        tournamentId: number | null;
      }[]
    >(
      `SELECT "userId", category, amount, description, "tournamentId"
       FROM "transaction"
       WHERE "userId" = ANY($1::int[])
         AND category IN ('topup','admin_credit','withdraw','refund','convert','other','win','loss','referral')
       ORDER BY id ASC`,
      [ids],
    );

    for (const row of txRows) {
      const userId = Number(row.userId);
      if (!rubles.has(userId) || !balanceL.has(userId)) continue;
      const next = UserBalanceLedgerService.applyLedgerRow(
        {
          rubles: rubles.get(userId) ?? 0,
          balanceL: balanceL.get(userId) ?? 0,
        },
        row,
      );
      rubles.set(userId, next.rubles);
      balanceL.set(userId, next.balanceL);
    }

    const pendingRows = await this.dataSource.query<
      { userId: number; total: number | string }[]
    >(
      `SELECT "userId", COALESCE(SUM(amount), 0) AS total
       FROM withdrawal_request
       WHERE "userId" = ANY($1::int[]) AND status = 'pending'
       GROUP BY "userId"`,
      [ids],
    );
    for (const row of pendingRows) {
      pendingWithdrawals.set(Number(row.userId), Number(row.total));
    }

    const escrowRows = await this.dataSource.query<
      { userId: number; total: number | string }[]
    >(
      `SELECT "userId", COALESCE(SUM(amount), 0) AS total
       FROM tournament_escrow
       WHERE "userId" = ANY($1::int[]) AND status = 'held'
       GROUP BY "userId"`,
      [ids],
    );
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
}
