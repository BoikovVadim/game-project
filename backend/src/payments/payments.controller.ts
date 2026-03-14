import { Controller, Post, Body, Get, Query, Req, UseGuards, ServiceUnavailableException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreatePaymentDto } from './dto/payments-write.dto';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @UseGuards(JwtAuthGuard)
  @Post('create')
  async create(
    @Body() body: CreatePaymentDto,
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
      const result = await this.paymentsService.handleYooKassaNotification(body as any);
      if (result.retryable) {
        throw new ServiceUnavailableException('Temporary YooKassa webhook processing failure');
      }
      return { success: result.success, code: result.code };
    }
    return { success: true, code: 'ignored' };
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
