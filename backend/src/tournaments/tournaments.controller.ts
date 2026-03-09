import { Controller, Post, Get, Body, Param, Query, UseGuards, Request, ParseIntPipe } from '@nestjs/common';
import { TournamentsService } from './tournaments.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@Controller('tournaments')
export class TournamentsController {
  constructor(private readonly tournamentsService: TournamentsService) {}

  @Get('allowed-leagues')
  @UseGuards(JwtAuthGuard)
  getAllowedLeagues(@Request() req: { user: { id: number } }) {
    return this.tournamentsService.getAllowedLeagues(req.user.id);
  }

  @Get('my')
  @UseGuards(JwtAuthGuard)
  getMyTournaments(
    @Request() req: { user: { id: number } },
    @Query('mode') mode?: 'training' | 'money',
    @Query('currentTournamentId') currentTournamentId?: string,
  ) {
    const currentId = currentTournamentId ? parseInt(currentTournamentId, 10) : undefined;
    return this.tournamentsService.getMyTournaments(req.user.id, mode, !Number.isNaN(currentId) ? currentId : undefined);
  }

  @Get(':id/state')
  @UseGuards(JwtAuthGuard)
  getTournamentState(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: { user: { id: number } },
  ) {
    return this.tournamentsService.getTournamentState(req.user.id, id);
  }

  @Get(':id/bracket')
  @UseGuards(JwtAuthGuard)
  getTournamentBracket(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: { user: { id: number } },
  ) {
    return this.tournamentsService.getTournamentBracket(req.user.id, id);
  }

  @Get(':id/training-state')
  @UseGuards(JwtAuthGuard)
  getTrainingState(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: { user: { id: number } },
  ) {
    return this.tournamentsService.getTrainingState(req.user.id, id);
  }

  @Post(':id/complete')
  @UseGuards(JwtAuthGuard)
  completeTournament(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { passed?: boolean },
    @Request() req: { user: { id: number } },
  ) {
    return this.tournamentsService.completeTournament(req.user.id, id, body.passed === true);
  }

  @Post(':id/progress')
  @UseGuards(JwtAuthGuard)
  setProgress(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { count?: number; currentIndex?: number; timeLeft?: number; correctCount?: number; answersChosen?: number[] },
    @Request() req: { user: { id: number } },
  ) {
    return this.tournamentsService.setProgress(req.user.id, id, body.count ?? 0, body.currentIndex, body.timeLeft, body.correctCount, body.answersChosen);
  }

  @Post('create')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async create(@Body() body: { userId: number }) {
    return this.tournamentsService.createTournament(body.userId);
  }

  @Post('training/start')
  @UseGuards(JwtAuthGuard)
  async startTraining(@Request() req: { user: { id: number } }) {
    return this.tournamentsService.startTraining(req.user.id);
  }

  @Post('join')
  @UseGuards(JwtAuthGuard)
  async joinTournament(@Body() body: { leagueAmount?: number }, @Request() req: { user: { id: number } }) {
    const amount = body.leagueAmount ?? 5;
    return this.tournamentsService.joinOrCreateMoneyTournament(req.user.id, amount);
  }

  @Post('backfill-entries')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async backfillEntries() {
    return this.tournamentsService.backfillTournamentEntries();
  }

}