import { Controller, Get, Post, Body, UseGuards, Request, Param, ParseIntPipe, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from './user.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  findAll(): Promise<User[]> {
    return this.usersService.findAll();
  }

  @Post()
  create(@Body() userData: { username: string; email: string; password: string }): Promise<User> {
    return this.usersService.create(userData);
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/cabinet-ping')
  cabinetPing(@Request() req: { user: { id: number } }) {
    return this.usersService.updateCabinetSeenAt(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('admin-status')
  getAdminStatus(@Request() req: { user: { isAdmin?: boolean } }) {
    return { isAdmin: !!req.user?.isAdmin };
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(@Request() req: any) {
    return this.usersService.getProfile(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('profile/nickname')
  updateNickname(@Body() body: { nickname: string | null }, @Request() req: any) {
    return this.usersService.updateNickname(req.user.id, body.nickname ?? null);
  }

  @UseGuards(JwtAuthGuard)
  @Get('transactions')
  getTransactions(@Request() req: any) {
    return this.usersService.getTransactions(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('withdrawal-requests')
  getMyWithdrawalRequests(@Request() req: { user: { id: number } }) {
    return this.usersService.getMyWithdrawalRequests(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('referral-code')
  async getReferralCode(@Request() req: { user: { id: number } }) {
    const referralCode = await this.usersService.getReferralCode(req.user.id);
    return { referralCode };
  }

  @UseGuards(JwtAuthGuard)
  @Get('referral-tree')
  async getReferralTree(@Request() req: { user: { id: number } }) {
    return this.usersService.getReferralTree(Number(req.user.id));
  }

  @UseGuards(JwtAuthGuard)
  @Post('seed-referral-model')
  async seedReferralModel(@Request() req: { user: { id: number } }) {
    return this.usersService.seedReferralModel(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('global-stats')
  async getGlobalStats() {
    return this.usersService.getGlobalStats();
  }

  @UseGuards(JwtAuthGuard)
  @Get('online-count')
  async getOnlineCount() {
    return this.usersService.getOnlineCount();
  }

  @UseGuards(JwtAuthGuard)
  @Get('rankings')
  async getRankings(
    @Request() req: { user: { id: number } },
    @Query('metric') metric?: string,
  ) {
    const validMetrics = ['gamesPlayed', 'wins', 'totalWinnings', 'correctAnswers', 'referrals', 'totalWithdrawn'];
    const m = validMetrics.includes(metric || '')
      ? (metric as 'gamesPlayed' | 'wins' | 'totalWinnings' | 'correctAnswers' | 'referrals' | 'totalWithdrawn')
      : 'gamesPlayed';
    return this.usersService.getRankings(m, req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/referral-stats-by-day')
  async getMyReferralStatsByDay(
    @Request() req: { user: { id: number } },
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('metric') metric?: string,
  ) {
    const m = ['referralCount', 'referralEarnings'].includes(metric || '')
      ? (metric as 'referralCount' | 'referralEarnings')
      : 'referralCount';
    return this.usersService.getReferralStatsByDay(req.user.id, from || '', to || '', m);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me/stats-by-day')
  async getMyStatsByDay(
    @Request() req: { user: { id: number } },
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('metric') metric?: string,
    @Query('gameType') gameType?: string,
  ) {
    const m = ['gamesPlayed', 'wins', 'totalWinnings', 'correctAnswers'].includes(metric || '')
      ? (metric as 'gamesPlayed' | 'wins' | 'totalWinnings' | 'correctAnswers')
      : 'gamesPlayed';
    const gt = ['training', 'money', 'all'].includes(gameType || '') ? (gameType as 'training' | 'money' | 'all') : 'all';
    return this.usersService.getStatsByDay(req.user.id, from || '', to || '', m, gt);
  }

  @UseGuards(JwtAuthGuard)
  @Get(['stats', 'me/stats'])
  async getMyStats(@Request() req: { user: { id: number } }) {
    try {
      return await this.usersService.getStats(req.user.id);
    } catch (e) {
      console.error('[getMyStats]', e);
      return {
        gamesPlayed: 0,
        gamesPlayedTraining: 0,
        gamesPlayedMoney: 0,
        completedMatches: 0,
        completedMatchesTraining: 0,
        completedMatchesMoney: 0,
        wins: 0,
        winRatePercent: null,
        correctAnswers: 0,
        totalQuestions: 0,
        correctAnswersTraining: 0,
        totalQuestionsTraining: 0,
        correctAnswersMoney: 0,
        totalQuestionsMoney: 0,
        totalWinnings: 0,
        maxLeague: null,
        maxLeagueName: null,
      };
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/public-stats')
  async getPublicStats(@Param('id', ParseIntPipe) id: number) {
    try {
      return await this.usersService.getStats(id);
    } catch (e) {
      console.error('[getPublicStats]', e);
      return {
        gamesPlayed: 0,
        gamesPlayedTraining: 0,
        gamesPlayedMoney: 0,
        completedMatches: 0,
        completedMatchesTraining: 0,
        completedMatchesMoney: 0,
        wins: 0,
        winRatePercent: null,
        correctAnswers: 0,
        totalQuestions: 0,
        correctAnswersTraining: 0,
        totalQuestionsTraining: 0,
        correctAnswersMoney: 0,
        totalQuestionsMoney: 0,
        totalWinnings: 0,
        maxLeague: null,
        maxLeagueName: null,
      };
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post('update-balance')
  updateBalance(@Body() body: { userId: number; newBalance: number }, @Request() req: any) {
    return this.usersService.updateBalance(body.userId, body.newBalance);
  }

  @UseGuards(JwtAuthGuard)
  @Post('add-balance')
  addBalance(@Body() body: { amount: number; userId?: number }, @Request() req: any) {
    const userId = body.userId ?? req.user.id;
    return this.usersService.addToBalance(userId, body.amount);
  }

  @UseGuards(JwtAuthGuard)
  @Post('convert-currency')
  convertCurrency(@Body() body: { amount: number; direction: 'rubles_to_l' | 'l_to_rubles' }, @Request() req: any) {
    return this.usersService.convertCurrency(req.user.id, Number(body.amount) || 0, body.direction);
  }

  @UseGuards(JwtAuthGuard)
  @Post('withdrawal-request')
  @HttpCode(HttpStatus.CREATED)
  async createWithdrawalRequest(@Body() body: { amount: number; details?: string }, @Request() req: { user: { id: number } }) {
    const userId = req.user.id;
    const amount = Number(body.amount) || 0;
    const details = body.details?.trim() || '';
    console.log('[UsersController] POST withdrawal-request userId=%s amount=%s', userId, amount);
    const created = await this.usersService.createWithdrawalRequest(userId, amount, details);
    console.log('[UsersController] Withdrawal created id=%s', created.id);
    return created;
  }

  @UseGuards(JwtAuthGuard)
  @Post('import-from-file')
  importFromFile(@Body() body: { filePath: string }) {
    return this.usersService.importFromFile(body.filePath);
  }
}