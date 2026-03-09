import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ScheduleModule } from '@nestjs/schedule';
import { join, resolve } from 'path';
import * as fs from 'fs';
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

const frontendBuild = join(__dirname, '..', '..', 'Frontend', 'build');
const dbByEnv = process.env.DATABASE_PATH ? resolve(process.env.DATABASE_PATH) : null;
const dbByDir = resolve(join(__dirname, '..', 'db.sqlite'));
const dbByCwd = resolve(join(process.cwd(), 'db.sqlite'));
const databasePath = dbByEnv || (fs.existsSync(dbByCwd) ? dbByCwd : dbByDir);
console.log('[AppModule] database path:', databasePath, '| cwd:', process.cwd());

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ServeStaticModule.forRoot({
      rootPath: frontendBuild,
      serveStaticOptions: {
        fallthrough: true,
        setHeaders: (res) => {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        },
      },
    }),
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: databasePath,
      entities: [User, Tournament, Question, TournamentEntry, TournamentResult, TournamentProgress, TournamentEscrow, Transaction, Payment, WithdrawalRequest, SupportMessage, SupportTicket, News],
      synchronize: true,
      logging: true,
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
  providers: [],
})
export class AppModule {}