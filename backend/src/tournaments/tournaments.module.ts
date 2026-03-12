import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TournamentsService } from './tournaments.service';
import { TournamentsController } from './tournaments.controller';
import { Tournament } from './tournament.entity';
import { Question } from './question.entity';
import { TournamentEntry } from './tournament-entry.entity';
import { TournamentResult } from './tournament-result.entity';
import { TournamentProgress } from './tournament-progress.entity';
import { TournamentEscrow } from './tournament-escrow.entity';
import { QuestionPoolItem } from './question-pool.entity';
import { User } from '../users/user.entity';
import { Transaction } from '../users/transaction.entity';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Tournament, Question, QuestionPoolItem, TournamentEntry, TournamentResult, TournamentProgress, TournamentEscrow, User, Transaction]),
    forwardRef(() => UsersModule),
  ],
  providers: [TournamentsService],
  controllers: [TournamentsController],
  exports: [TournamentsService],
})
export class TournamentsModule {}