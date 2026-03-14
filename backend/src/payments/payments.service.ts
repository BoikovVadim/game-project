import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Payment } from './payment.entity';
import { YooKassaService } from './yookassa.service';
import { RobokassaService } from './robokassa.service';
import { UsersService } from '../users/users.service';

export type YooKassaWebhookResult = {
  success: boolean;
  retryable: boolean;
  code:
    | 'ignored'
    | 'processed'
    | 'already_processed'
    | 'payment_not_found'
    | 'invalid_amount'
    | 'external_mismatch'
    | 'fetch_failed';
};

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    private readonly yookassa: YooKassaService,
    private readonly robokassa: RobokassaService,
    private readonly dataSource: DataSource,
    private readonly usersService: UsersService,
  ) {}

  private async finalizeTopupPayment(
    paymentId: number,
    provider: 'yookassa' | 'robokassa',
    externalId: string,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const payment = await manager
        .createQueryBuilder(Payment, 'payment')
        .setLock('pessimistic_write')
        .where('payment.id = :paymentId', { paymentId })
        .andWhere('payment.provider = :provider', { provider })
        .andWhere('payment.status = :status', { status: 'pending' })
        .getOne();
      if (!payment) return false;

      const amount = Number(payment.amount);
      payment.status = 'succeeded';
      payment.externalId = externalId || payment.externalId;

      await this.usersService.creditRublesWithManager(
        manager,
        payment.userId,
        amount,
        UsersService.buildPaymentTopupDescription(provider, payment.id, externalId),
      );
      await manager.save(payment);

      return true;
    });
  }

  /** Создаёт платёж и возвращает URL для редиректа */
  async createPayment(userId: number, amount: number, provider: 'yookassa' | 'robokassa'): Promise<{ paymentUrl: string; paymentId: number }> {
    const amountNum = Number(amount);
    if (!amountNum || amountNum < 1 || amountNum > 500000) {
      throw new BadRequestException('Сумма от 1 до 500 000 ₽');
    }
    if (provider === 'yookassa' && !this.yookassa.isEnabled()) {
      throw new BadRequestException('ЮKassa не настроена');
    }
    if (provider === 'robokassa' && !this.robokassa.isEnabled()) {
      throw new BadRequestException('Robokassa не настроена');
    }

    const payment = this.paymentRepository.create({
      userId,
      amount: amountNum,
      provider,
      externalId: '',
      status: 'pending',
    });
    const saved = await this.paymentRepository.save(payment);

    const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
    const returnUrl = `${appUrl}/#/profile?section=finance-topup&payment=success`;
    const cancelUrl = `${appUrl}/#/profile?section=finance-topup&payment=cancelled`;

    if (provider === 'yookassa') {
      const orderId = `pay-${saved.id}`;
      const result = await this.yookassa.createPayment({
        amount: amountNum,
        orderId,
        returnUrl,
        description: `Пополнение баланса`,
      });
      if (!result) throw new BadRequestException('Не удалось создать платёж ЮKassa');
      saved.externalId = result.paymentId;
      await this.paymentRepository.save(saved);
      return { paymentUrl: result.confirmationUrl, paymentId: saved.id };
    }

    // Robokassa
    const paymentUrl = this.robokassa.getPaymentUrl({
      amount: amountNum,
      invId: saved.id,
      description: 'Пополнение баланса',
    });
    if (!paymentUrl) throw new BadRequestException('Не удалось создать платёж Robokassa');
    saved.externalId = String(saved.id);
    await this.paymentRepository.save(saved);
    return { paymentUrl, paymentId: saved.id };
  }

  /** Обработка успешного уведомления от ЮKassa (webhook). Идемпотентно через DB-транзакцию. */
  async handleYooKassaNotification(payload: { object?: { id?: string; status?: string; metadata?: { orderId?: string }; amount?: { value?: string } } }): Promise<YooKassaWebhookResult> {
    const obj = payload?.object;
    if (!obj?.id) return { success: true, retryable: false, code: 'ignored' };

    let remotePayment: Awaited<ReturnType<YooKassaService['getPayment']>>;
    try {
      remotePayment = await this.yookassa.getPayment(obj.id);
    } catch {
      return { success: false, retryable: true, code: 'fetch_failed' };
    }
    if (!remotePayment) return { success: false, retryable: true, code: 'fetch_failed' };
    if (remotePayment.status !== 'succeeded' || remotePayment.paid !== true) {
      return { success: true, retryable: false, code: 'ignored' };
    }

    const orderId = remotePayment.metadata?.orderId;
    if (!orderId || !orderId.startsWith('pay-')) return { success: true, retryable: false, code: 'ignored' };
    const paymentId = parseInt(orderId.replace('pay-', ''), 10);
    if (Number.isNaN(paymentId)) return { success: true, retryable: false, code: 'ignored' };

    const payment = await this.paymentRepository.findOne({ where: { id: paymentId, provider: 'yookassa' } });
    if (!payment) return { success: true, retryable: false, code: 'payment_not_found' };
    if (payment.status === 'succeeded') return { success: true, retryable: false, code: 'already_processed' };
    if (payment.externalId !== obj.id) return { success: true, retryable: false, code: 'external_mismatch' };

    const remoteAmount = Number(remotePayment.amount?.value ?? 0);
    if (!remoteAmount || Number(payment.amount) !== remoteAmount) {
      return { success: true, retryable: false, code: 'invalid_amount' };
    }

    const finalized = await this.finalizeTopupPayment(paymentId, 'yookassa', obj.id);
    return {
      success: true,
      retryable: false,
      code: finalized ? 'processed' : 'already_processed',
    };
  }

  /** Обработка Result URL от Robokassa. Идемпотентно через DB-транзакцию. */
  async handleRobokassaResult(outSum: string, invId: string, signatureValue: string): Promise<boolean> {
    if (!this.robokassa.verifyResultSignature(outSum, invId, signatureValue)) return false;
    const paymentId = parseInt(invId, 10);
    if (Number.isNaN(paymentId)) return false;
    const payment = await this.paymentRepository.findOne({ where: { id: paymentId, provider: 'robokassa' } });
    if (!payment) return false;

    const remoteAmount = parseFloat(outSum);
    if (!remoteAmount || Number(payment.amount) !== remoteAmount) return false;

    await this.finalizeTopupPayment(paymentId, 'robokassa', invId);
    return true;
  }

  /** Список доступных провайдеров */
  getAvailableProviders(): { yookassa: boolean; robokassa: boolean } {
    return {
      yookassa: this.yookassa.isEnabled(),
      robokassa: this.robokassa.isEnabled(),
    };
  }
}
