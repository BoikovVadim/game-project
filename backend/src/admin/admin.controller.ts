import { Controller, Get, Post, Body, Param, Query, UseGuards, Request, ParseIntPipe } from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('withdrawal-requests')
  getWithdrawalRequests(@Query('status') status?: 'pending' | 'approved' | 'rejected') {
    return this.adminService.getWithdrawalRequests(status);
  }

  @Post('withdrawal-requests/:id/approve')
  approveWithdrawal(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { comment?: string },
    @Request() req: { user: { id: number } },
  ) {
    return this.adminService.approveWithdrawal(id, req.user.id, body.comment);
  }

  @Post('withdrawal-requests/:id/reject')
  rejectWithdrawal(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { comment?: string },
    @Request() req: { user: { id: number } },
  ) {
    return this.adminService.rejectWithdrawal(id, req.user.id, body.comment);
  }

  @Get('users')
  getUsers(@Query('search') search?: string, @Query('limit') limit?: string) {
    return this.adminService.getUsers(search, limit ? parseInt(limit, 10) : 500);
  }

  /** Получить JWT для входа «под пользователем» */
  @Post('impersonate')
  impersonate(@Body() body: { userId: number }, @Request() req: { user: { id: number } }) {
    return this.adminService.getImpersonationToken(req.user.id, body.userId);
  }

  @Post('credit-balance')
  creditBalance(
    @Body() body: { userId: number; amount: number; comment?: string },
    @Request() req: { user: { id: number } },
  ) {
    return this.adminService.creditBalance(req.user.id, body.userId, body.amount, body.comment);
  }

  @Get('credit-history')
  getCreditHistory() {
    return this.adminService.getCreditHistory();
  }

  @Get('stats')
  getStats(@Query('groupBy') groupBy?: 'day' | 'week' | 'month' | 'all') {
    return this.adminService.getStats(groupBy || 'day');
  }

  @Get('transactions')
  getTransactions(@Query('category') category?: string) {
    return this.adminService.getTransactions(category);
  }

  @Get('question-stats')
  getQuestionStats() {
    return this.adminService.getQuestionStats();
  }

  @Get('tournaments-list')
  getTournamentsList() {
    return this.adminService.getTournamentsList();
  }

  @Post('users/:id/set-admin')
  setUserAdmin(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { isAdmin: boolean },
    @Request() req: { user: { id: number } },
  ) {
    return this.adminService.setUserAdmin(id, req.user.id, body.isAdmin === true);
  }
}
