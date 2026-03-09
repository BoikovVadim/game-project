import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { WithdrawalRequest } from '../users/withdrawal-request.entity';
import { Transaction } from '../users/transaction.entity';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { UsersModule } from '../users/users.module';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, WithdrawalRequest, Transaction]),
    UsersModule,
    JwtModule.register({ secret: process.env.JWT_SECRET || 'fallback-dev-key-change-me', signOptions: { expiresIn: '6h' } }),
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
