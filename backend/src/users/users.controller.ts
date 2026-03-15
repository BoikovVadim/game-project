import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Request,
  Param,
  ParseIntPipe,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import {
  AddBalanceDto,
  ConvertCurrencyDto,
  MarkNewsReadDto,
  UpdateAvatarDto,
  UpdateBalanceDto,
  UpdateNicknameDto,
  UpdatePersonalDto,
  WithdrawalRequestDto,
} from './dto/users-write.dto';
import {
  buildEmptyUserStatsDto,
  type UserAdminListItemDto,
  type UserAdminStatusDto,
  type UserCabinetPingDto,
  type UserGlobalStatsDto,
  type UserProfileDto,
  type UserReferralCodeDto,
  type UserStatsDto,
  type UserTransactionDto,
  type UserWithdrawalRequestDto,
} from './dto/users-read.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Get()
  findAll(): Promise<UserAdminListItemDto[]> {
    return this.usersService.findAll();
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/cabinet-ping')
  cabinetPing(
    @Request() req: { user: { id: number } },
  ): Promise<UserCabinetPingDto> {
    return this.usersService.updateCabinetSeenAt(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('admin-status')
  getAdminStatus(
    @Request() req: { user: { isAdmin?: boolean } },
  ): UserAdminStatusDto {
    return { isAdmin: !!req.user?.isAdmin };
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  getProfile(
    @Request() req: { user: { id: number } },
  ): Promise<UserProfileDto> {
    return this.usersService.getProfile(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/read-news')
  markNewsAsRead(
    @Body() body: MarkNewsReadDto,
    @Request() req: { user: { id: number } },
  ) {
    return this.usersService.markNewsAsRead(req.user.id, Number(body.newsId));
  }

  @UseGuards(JwtAuthGuard)
  @Post('profile/nickname')
  updateNickname(
    @Body() body: UpdateNicknameDto,
    @Request() req: { user: { id: number } },
  ) {
    return this.usersService.updateNickname(req.user.id, body.nickname ?? null);
  }

  @UseGuards(JwtAuthGuard)
  @Post('profile/avatar')
  updateAvatar(
    @Body() body: UpdateAvatarDto,
    @Request() req: { user: { id: number } },
  ) {
    return this.usersService.updateAvatar(req.user.id, body.avatarUrl ?? null);
  }

  @UseGuards(JwtAuthGuard)
  @Post('profile/personal')
  updatePersonal(
    @Body() body: UpdatePersonalDto,
    @Request() req: { user: { id: number } },
  ) {
    return this.usersService.updatePersonal(
      req.user.id,
      body.gender,
      body.birthDate,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('transactions')
  getTransactions(
    @Request() req: { user: { id: number } },
  ): Promise<UserTransactionDto[]> {
    return this.usersService.getTransactions(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('withdrawal-requests')
  getMyWithdrawalRequests(
    @Request() req: { user: { id: number } },
  ): Promise<UserWithdrawalRequestDto[]> {
    return this.usersService.getMyWithdrawalRequests(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('referral-code')
  async getReferralCode(
    @Request() req: { user: { id: number } },
  ): Promise<UserReferralCodeDto> {
    const referralCode = await this.usersService.getReferralCode(req.user.id);
    return { referralCode };
  }

  @UseGuards(JwtAuthGuard)
  @Post('me/referral-code/ensure')
  async ensureReferralCode(
    @Request() req: { user: { id: number } },
  ): Promise<UserReferralCodeDto> {
    const referralCode = await this.usersService.ensureReferralCode(
      req.user.id,
    );
    return { referralCode };
  }

  @UseGuards(JwtAuthGuard)
  @Get('referral-tree')
  async getReferralTree(@Request() req: { user: { id: number } }) {
    return this.usersService.getReferralTree(Number(req.user.id));
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('seed-referral-model')
  async seedReferralModel(@Request() req: { user: { id: number } }) {
    return this.usersService.seedReferralModel(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('global-stats')
  async getGlobalStats(): Promise<UserGlobalStatsDto> {
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
    const validMetrics = [
      'gamesPlayed',
      'wins',
      'totalWinnings',
      'correctAnswers',
      'correctAnswerRate',
      'referrals',
      'totalWithdrawn',
    ];
    const m = validMetrics.includes(metric || '')
      ? (metric as
          | 'gamesPlayed'
          | 'wins'
          | 'totalWinnings'
          | 'correctAnswers'
          | 'correctAnswerRate'
          | 'referrals'
          | 'totalWithdrawn')
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
    return this.usersService.getReferralStatsByDay(
      req.user.id,
      from || '',
      to || '',
      m,
    );
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
    const m = [
      'gamesPlayed',
      'wins',
      'totalWinnings',
      'correctAnswers',
    ].includes(metric || '')
      ? (metric as 'gamesPlayed' | 'wins' | 'totalWinnings' | 'correctAnswers')
      : 'gamesPlayed';
    const gt = ['training', 'money', 'all'].includes(gameType || '')
      ? (gameType as 'training' | 'money' | 'all')
      : 'all';
    return this.usersService.getStatsByDay(
      req.user.id,
      from || '',
      to || '',
      m,
      gt,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get(['stats', 'me/stats'])
  async getMyStats(
    @Request() req: { user: { id: number } },
  ): Promise<UserStatsDto> {
    try {
      return await this.usersService.getStats(req.user.id);
    } catch (e) {
      console.error('[getMyStats]', e);
      return buildEmptyUserStatsDto();
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/public-stats')
  async getPublicStats(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<UserStatsDto> {
    try {
      return await this.usersService.getStats(id);
    } catch (e) {
      console.error('[getPublicStats]', e);
      return buildEmptyUserStatsDto();
    }
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('update-balance')
  updateBalance(@Body() body: UpdateBalanceDto) {
    return this.usersService.updateBalance(body.userId, body.newBalance);
  }

  @UseGuards(JwtAuthGuard, AdminGuard)
  @Post('add-balance')
  addBalance(
    @Body() body: AddBalanceDto,
    @Request() req: { user: { id: number } },
  ) {
    const userId = body.userId ?? req.user.id;
    return this.usersService.addToBalance(userId, body.amount);
  }

  @UseGuards(JwtAuthGuard)
  @Post('convert-currency')
  convertCurrency(
    @Body() body: ConvertCurrencyDto,
    @Request() req: { user: { id: number } },
  ) {
    return this.usersService.convertCurrency(
      req.user.id,
      Number(body.amount) || 0,
      body.direction,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('withdrawal-request')
  @HttpCode(HttpStatus.CREATED)
  async createWithdrawalRequest(
    @Body() body: WithdrawalRequestDto,
    @Request() req: { user: { id: number } },
  ) {
    const userId = req.user.id;
    const amount = Number(body.amount) || 0;
    const details = body.details?.trim() || '';
    console.log(
      '[UsersController] POST withdrawal-request userId=%s amount=%s',
      userId,
      amount,
    );
    const created = await this.usersService.createWithdrawalRequest(
      userId,
      amount,
      details,
    );
    console.log('[UsersController] Withdrawal created id=%s', created.id);
    return created;
  }
}
