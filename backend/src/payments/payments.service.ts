import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment } from './payment.entity';
import { YooKassaService } from './yookassa.service';
import { RobokassaService } from './robokassa.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    private readonly yookassa: YooKassaService,
    private readonly robokassa: RobokassaService,
    private readonly usersService: UsersService,
  ) {}

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
    const returnUrl = `${appUrl}/profile#finance-topup?payment=success`;
    const cancelUrl = `${appUrl}/profile#finance-topup?payment=cancelled`;

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

  /** Обработка успешного уведомления от ЮKassa (webhook) */
  async handleYooKassaNotification(payload: { object?: { id?: string; status?: string; metadata?: { orderId?: string }; amount?: { value?: string } } }): Promise<void> {
    const obj = payload?.object;
    if (!obj || obj.status !== 'succeeded') return;
    const orderId = obj.metadata?.orderId;
    if (!orderId || !orderId.startsWith('pay-')) return;
    const paymentId = parseInt(orderId.replace('pay-', ''), 10);
    if (Number.isNaN(paymentId)) return;
    const payment = await this.paymentRepository.findOne({ where: { id: paymentId, provider: 'yookassa', status: 'pending' } });
    if (!payment) return;
    const amount = parseFloat(obj.amount?.value ?? '0') || Number(payment.amount);
    payment.status = 'succeeded';
    payment.externalId = obj.id || payment.externalId;
    await this.paymentRepository.save(payment);
    await this.usersService.addToBalance(payment.userId, amount, `Пополнение через ЮKassa`);
  }

  /** Обработка Result URL от Robokassa (GET с OutSum, InvId, SignatureValue) */
  async handleRobokassaResult(outSum: string, invId: string, signatureValue: string): Promise<boolean> {
    if (!this.robokassa.verifyResultSignature(outSum, invId, signatureValue)) return false;
    const paymentId = parseInt(invId, 10);
    if (Number.isNaN(paymentId)) return false;
    const payment = await this.paymentRepository.findOne({ where: { id: paymentId, provider: 'robokassa', status: 'pending' } });
    if (!payment) return true; // уже обработан — отвечаем OK
    const amount = parseFloat(outSum) || Number(payment.amount);
    payment.status = 'succeeded';
    payment.externalId = invId;
    await this.paymentRepository.save(payment);
    await this.usersService.addToBalance(payment.userId, amount, `Пополнение через Robokassa`);
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
