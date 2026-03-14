import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CacheModule } from '@nestjs/cache-manager';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { join } from 'path';
import { AppController } from './app.controller';
import { UsersModule } from './users/users.module';
import { TournamentsModule } from './tournaments/tournaments.module';
import { AuthModule } from './auth/auth.module';
import { MailModule } from './mail/mail.module';
import { User } from './users/user.entity';
import { Tournament } from './tournaments/tournament.entity';
import { Question } from './tournaments/question.entity';
import { TournamentEntry } from './tournaments/tournament-entry.entity';
import { TournamentResult } from './tournaments/tournament-result.entity';
import { TournamentProgress } from './tournaments/tournament-progress.entity';
import { Transaction } from './users/transaction.entity';
import { TournamentEscrow } from './tournaments/tournament-escrow.entity';
import { Payment } from './payments/payment.entity';
import { PaymentsModule } from './payments/payments.module';
import { WithdrawalRequest } from './users/withdrawal-request.entity';
import { AdminModule } from './admin/admin.module';
import { SupportModule } from './support/support.module';
import { SupportMessage } from './support/support-message.entity';
import { SupportTicket } from './support/support-ticket.entity';
import { NewsModule } from './news/news.module';
import { News } from './news/news.entity';
import { QuestionPoolItem } from './tournaments/question-pool.entity';
import { TournamentRoundResolution } from './tournaments/tournament-round-resolution.entity';
import { getRequiredEnv } from './common/env';

const frontendBuild = join(__dirname, '..', '..', 'Frontend', 'build');

@Module({
  imports: [
    CacheModule.register({ isGlobal: true, ttl: 30000, max: 200 }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{
      name: 'short',
      ttl: 60000,
      limit: 120,
    }, {
      name: 'long',
      ttl: 600000,
      limit: 800,
    }]),
    ServeStaticModule.forRoot({
      rootPath: frontendBuild,
      serveStaticOptions: {
        fallthrough: true,
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.html') || filePath.endsWith('/')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
          } else {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      },
    }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: getRequiredEnv('DB_HOST'),
      port: parseInt(getRequiredEnv('DB_PORT'), 10),
      username: getRequiredEnv('DB_USER'),
      password: getRequiredEnv('DB_PASS'),
      database: getRequiredEnv('DB_NAME'),
      entities: [User, Tournament, Question, QuestionPoolItem, TournamentEntry, TournamentResult, TournamentProgress, TournamentEscrow, TournamentRoundResolution, Transaction, Payment, WithdrawalRequest, SupportMessage, SupportTicket, News],
      synchronize: process.env.NODE_ENV !== 'production',
      logging: process.env.NODE_ENV !== 'production',
    }),
    MailModule,
    UsersModule,
    TournamentsModule,
    AuthModule,
    PaymentsModule,
    AdminModule,
    SupportModule,
    NewsModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}