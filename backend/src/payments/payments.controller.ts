import { Controller, Post, Body, Get, Query, Req, UseGuards } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @UseGuards(JwtAuthGuard)
  @Post('create')
  async create(
    @Body() body: { amount: number; provider: 'yookassa' | 'robokassa' },
    @Req() req: { user: { id: number } },
  ) {
    return this.paymentsService.createPayment(
      req.user.id,
      Number(body.amount) || 0,
      body.provider === 'robokassa' ? 'robokassa' : 'yookassa',
    );
  }

  @Get('providers')
  getProviders() {
    return this.paymentsService.getAvailableProviders();
  }

  /** ЮKassa webhook (notification) — вызывается серверами ЮKassa */
  @Post('webhook/yookassa')
  async webhookYooKassa(@Req() _req: Request, @Body() body: unknown) {
    if (body && typeof body === 'object') {
      await this.paymentsService.handleYooKassaNotification(body as any);
    }
    return { success: true };
  }

  /** Robokassa Result URL — GET-запрос от Robokassa после оплаты (серверный callback) */
  @Get('webhook/robokassa/result')
  async robokassaResult(
    @Query('OutSum') outSum: string,
    @Query('InvId') invId: string,
    @Query('SignatureValue') signatureValue: string,
  ) {
    const ok = await this.paymentsService.handleRobokassaResult(
      outSum || '',
      invId || '',
      signatureValue || '',
    );
    if (ok) return 'OK' + invId;
    return 'bad sign';
  }
}
