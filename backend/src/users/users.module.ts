import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { User } from './user.entity';
import { Transaction } from './transaction.entity';
import { WithdrawalRequest } from './withdrawal-request.entity';
import { UserBalanceLedgerService } from './user-balance-ledger.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, Transaction, WithdrawalRequest])],
  providers: [UsersService, UserBalanceLedgerService],
  controllers: [UsersController],
  exports: [UsersService],
})
export class UsersModule {}
