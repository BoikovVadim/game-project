import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { WithdrawalRequest } from '../users/withdrawal-request.entity';
import { Transaction } from '../users/transaction.entity';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { ProjectCostDashboardService } from './project-cost-dashboard.service';
import { UsersModule } from '../users/users.module';
import { TournamentsModule } from '../tournaments/tournaments.module';
import { JwtModule } from '@nestjs/jwt';
import { getRequiredEnv } from '../common/env';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, WithdrawalRequest, Transaction]),
    UsersModule,
    TournamentsModule,
    JwtModule.register({
      secret: getRequiredEnv('JWT_SECRET'),
      signOptions: { expiresIn: '6h' },
    }),
  ],
  controllers: [AdminController],
  providers: [AdminService, ProjectCostDashboardService],
})
export class AdminModule {}
