import { Injectable } from '@nestjs/common';

const YOOKASSA_API = 'https://api.yookassa.ru/v3/payments';

@Injectable()
export class YooKassaService {
  private readonly shopId: string;
  private readonly secretKey: string;
  private readonly enabled: boolean;

  constructor() {
    this.shopId = process.env.YOOKASSA_SHOP_ID || '';
    this.secretKey = process.env.YOOKASSA_SECRET_KEY || '';
    this.enabled = !!(this.shopId && this.secretKey);
    if (!this.enabled && (this.shopId || this.secretKey)) {
      console.warn('[YooKassa] Настроены не все переменные YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Создаёт платёж и возвращает URL для редиректа пользователя */
  async createPayment(params: {
    amount: number;
    orderId: string;
    returnUrl: string;
    description?: string;
  }): Promise<{ paymentId: string; confirmationUrl: string } | null> {
    if (!this.enabled) return null;
    const auth = Buffer.from(`${this.shopId}:${this.secretKey}`).toString('base64');
    const body = {
      amount: { value: params.amount.toFixed(2), currency: 'RUB' },
      description: params.description || `Пополнение баланса #${params.orderId}`,
      capture: true,
      confirmation: { type: 'redirect' as const, return_url: params.returnUrl },
      metadata: { orderId: params.orderId },
    };
    try {
      const res = await fetch(YOOKASSA_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${auth}`,
          'Idempotence-Key': `${params.orderId}-${Date.now()}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errText = await res.text();
        console.error('[YooKassa] create payment error:', res.status, errText);
        return null;
      }
      const data = (await res.json()) as {
        id?: string;
        status?: string;
        confirmation?: { confirmation_url?: string };
      };
      const confirmationUrl = data.confirmation?.confirmation_url;
      if (!data.id || !confirmationUrl) {
        console.error('[YooKassa] No id or confirmation_url in response:', data);
        return null;
      }
      return { paymentId: data.id, confirmationUrl };
    } catch (err) {
      console.error('[YooKassa] create payment exception:', err);
      return null;
    }
  }
}
