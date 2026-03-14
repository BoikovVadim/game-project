import { Controller, Post, Get, Body, Param, Query, UseGuards, Request, ParseIntPipe, Logger } from '@nestjs/common';
import { TournamentsService } from './tournaments.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CompleteTournamentDto, CreateTournamentDto, JoinTournamentDto, SetTournamentProgressDto } from './dto/tournament-write.dto';

@Controller('tournaments')
export class TournamentsController {
  private readonly logger = new Logger(TournamentsController.name);

  constructor(private readonly tournamentsService: TournamentsService) {}

  @Get('allowed-leagues')
  @UseGuards(JwtAuthGuard)
  getAllowedLeagues(@Request() req: { user: { id: number } }) {
    return this.tournamentsService.getAllowedLeagues(req.user.id);
  }

  @Get('my')
  @UseGuards(JwtAuthGuard)
  async getMyTournaments(
    @Request() req: { user: { id: number } },
    @Query('mode') mode?: string,
    @Query('currentTournamentId') currentTournamentId?: string,
  ) {
    const currentId = currentTournamentId ? parseInt(currentTournamentId, 10) : undefined;
    const normalizedMode = (mode === 'money' || mode === 'training') ? mode : 'training';
    try {
      return await this.tournamentsService.getMyTournaments(req.user.id, normalizedMode, !Number.isNaN(currentId) ? currentId : undefined);
    } catch (err) {
      this.logger.error(`getMyTournaments failed (userId=${req.user.id}, mode=${normalizedMode}): ${(err as Error)?.message}`, (err as Error)?.stack);
      return { active: [], completed: [] };
    }
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

  @Get('admin/:id/bracket')
  @UseGuards(JwtAuthGuard, AdminGuard)
  getTournamentBracketForAdmin(
    @Param('id', ParseIntPipe) id: number,
    @Query('userId', ParseIntPipe) userId: number,
  ) {
    return this.tournamentsService.getTournamentBracket(userId, id);
  }

  @Get(':id/training-state')
  @UseGuards(JwtAuthGuard)
  getTrainingState(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: { user: { id: number } },
  ) {
    return this.tournamentsService.getTrainingState(req.user.id, id);
  }

  @Post(':id/training-state/prepare')
  @UseGuards(JwtAuthGuard)
  prepareTrainingState(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: { user: { id: number } },
  ) {
    return this.tournamentsService.prepareTrainingState(req.user.id, id);
  }

  @Get('admin/:id/training-state')
  @UseGuards(JwtAuthGuard, AdminGuard)
  getTrainingStateForAdmin(
    @Param('id', ParseIntPipe) id: number,
    @Query('userId', ParseIntPipe) userId: number,
  ) {
    return this.tournamentsService.getTrainingState(userId, id);
  }

  @Post('admin/:id/training-state/prepare')
  @UseGuards(JwtAuthGuard, AdminGuard)
  prepareTrainingStateForAdmin(
    @Param('id', ParseIntPipe) id: number,
    @Query('userId', ParseIntPipe) userId: number,
  ) {
    return this.tournamentsService.prepareTrainingState(userId, id);
  }

  @Post(':id/complete')
  @UseGuards(JwtAuthGuard)
  completeTournament(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: CompleteTournamentDto,
    @Request() req: { user: { id: number } },
  ) {
    return this.tournamentsService.completeTournament(req.user.id, id, body.passed === true);
  }

  @Post(':id/progress')
  @UseGuards(JwtAuthGuard)
  setProgress(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SetTournamentProgressDto,
    @Request() req: { user: { id: number } },
  ) {
    return this.tournamentsService.setProgress(req.user.id, id, body.count ?? 0, body.currentIndex, body.timeLeft, body.correctCount, body.answersChosen, body.answerFinal === true);
  }

  @Post('create')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async create(@Body() body: CreateTournamentDto) {
    return this.tournamentsService.createTournament(body.userId);
  }

  @Post('training/start')
  @UseGuards(JwtAuthGuard)
  async startTraining(@Request() req: { user: { id: number } }) {
    return this.tournamentsService.startTraining(req.user.id);
  }

  @Post('join')
  @UseGuards(JwtAuthGuard)
  async joinTournament(@Body() body: JoinTournamentDto, @Request() req: { user: { id: number } }) {
    const amount = body.leagueAmount ?? 5;
    return this.tournamentsService.joinOrCreateMoneyTournament(req.user.id, amount);
  }

  @Post('backfill-entries')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async backfillEntries() {
    return this.tournamentsService.backfillTournamentEntries();
  }

}