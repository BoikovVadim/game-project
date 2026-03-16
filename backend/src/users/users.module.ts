import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { User } from './user.entity';
import { Transaction } from './transaction.entity';
import { WithdrawalRequest } from './withdrawal-request.entity';
import { UserBalanceLedgerService } from './user-balance-ledger.service';
import { UserRubleTopupService } from './user-ruble-topup.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, Transaction, WithdrawalRequest])],
  providers: [UsersService, UserBalanceLedgerService, UserRubleTopupService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
