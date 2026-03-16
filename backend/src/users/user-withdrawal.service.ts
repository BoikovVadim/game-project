import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { User } from './user.entity';
import { Transaction } from './transaction.entity';
import { WithdrawalRequest } from './withdrawal-request.entity';
import {
  type UserWithdrawalRequestDto,
  toUserWithdrawalRequestDto,
} from './dto/users-read.dto';
import { buildApprovedWithdrawalDescription } from './ruble-ledger-descriptions';

@Injectable()
export class UserWithdrawalService {
  constructor(
    @InjectRepository(WithdrawalRequest)
    private readonly withdrawalRepository: Repository<WithdrawalRequest>,
    private readonly dataSource: DataSource,
  ) {}

  private async getLockedUser(
    manager: EntityManager,
    userId: number,
  ): Promise<User> {
    const user = await manager
      .createQueryBuilder(User, 'user')
      .setLock('pessimistic_write')
      .where('user.id = :userId', { userId })
      .getOne();
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  private async addApprovedWithdrawalTransactionWithManager(
    manager: EntityManager,
    userId: number,
    requestId: number,
    amount: number,
  ): Promise<Transaction> {
    const transaction = manager.create(Transaction, {
      userId,
      amount: -amount,
      description: buildApprovedWithdrawalDescription(requestId),
      category: 'withdraw',
    });
    return manager.save(transaction);
  }

  private async holdBalanceRublesWithManager(
    manager: EntityManager,
    userId: number,
    amount: number,
  ): Promise<User> {
    if (amount <= 0) {
      throw new BadRequestException('Сумма должна быть положительной');
    }
    const user = await this.getLockedUser(manager, userId);
    const rubles = Number(user.balanceRubles ?? 0);
    if (rubles < amount) {
      throw new BadRequestException('Недостаточно средств на балансе в рублях');
    }
    user.balanceRubles = rubles - amount;
    await manager.save(user);
    return user;
  }

  private async restoreHeldBalanceRublesWithManager(
    manager: EntityManager,
    userId: number,
    amount: number,
  ): Promise<User> {
    if (amount <= 0) {
      throw new BadRequestException('Сумма должна быть положительной');
    }
    const user = await this.getLockedUser(manager, userId);
    user.balanceRubles = Number(user.balanceRubles ?? 0) + amount;
    await manager.save(user);
    return user;
  }

  async createWithdrawalRequest(
    userId: number,
    amount: number,
    details?: string,
  ): Promise<WithdrawalRequest> {
    const amountNum = Number(amount);
    if (!amountNum || amountNum < 100) {
      throw new BadRequestException('Минимальная сумма вывода - 100 ₽');
    }
    const detailsStr = (details?.trim() || '').slice(0, 500);
    if (!detailsStr) {
      throw new BadRequestException(
        'Укажите реквизиты для перевода (карта, счёт и т.д.)',
      );
    }

    return this.dataSource.transaction(async (manager) => {
      await this.holdBalanceRublesWithManager(manager, userId, amountNum);
      const request = manager.create(WithdrawalRequest, {
        userId,
        amount: amountNum,
        details: detailsStr,
        status: 'pending',
      });
      return manager.save(request);
    });
  }

  async getMyWithdrawalRequests(
    userId: number,
  ): Promise<UserWithdrawalRequestDto[]> {
    const requests = await this.withdrawalRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    return requests.map(toUserWithdrawalRequestDto);
  }

  async approveWithdrawal(
    requestId: number,
    adminId: number,
    comment?: string,
  ): Promise<WithdrawalRequest> {
    return this.dataSource.transaction(async (manager) => {
      const request = await manager
        .createQueryBuilder(WithdrawalRequest, 'wr')
        .setLock('pessimistic_write')
        .where('wr.id = :requestId', { requestId })
        .getOne();
      if (!request) {
        throw new NotFoundException('Заявка не найдена');
      }
      if (request.status !== 'pending') {
        throw new BadRequestException('Заявка уже обработана');
      }

      const amount = Number(request.amount);
      await this.addApprovedWithdrawalTransactionWithManager(
        manager,
        request.userId,
        requestId,
        amount,
      );

      request.status = 'approved';
      request.adminComment = comment || null;
      request.processedByAdminId = adminId;
      request.processedAt = new Date();
      return manager.save(request);
    });
  }

  async rejectWithdrawal(
    requestId: number,
    adminId: number,
    comment?: string,
  ): Promise<WithdrawalRequest> {
    return this.dataSource.transaction(async (manager) => {
      const request = await manager
        .createQueryBuilder(WithdrawalRequest, 'wr')
        .setLock('pessimistic_write')
        .where('wr.id = :requestId', { requestId })
        .getOne();
      if (!request) {
        throw new NotFoundException('Заявка не найдена');
      }
      if (request.status !== 'pending') {
        throw new BadRequestException('Заявка уже обработана');
      }

      await this.restoreHeldBalanceRublesWithManager(
        manager,
        request.userId,
        Number(request.amount),
      );

      request.status = 'rejected';
      request.adminComment = comment || null;
      request.processedByAdminId = adminId;
      request.processedAt = new Date();
      return manager.save(request);
    });
  }
}
