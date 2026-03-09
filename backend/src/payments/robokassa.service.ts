import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

const ROBOBASSA_URL = 'https://auth.robokassa.ru/Merchant/Index.aspx';

@Injectable()
export class RobokassaService {
  private readonly merchantLogin: string;
  private readonly password1: string;
  private readonly password2: string;
  private readonly enabled: boolean;

  constructor() {
    this.merchantLogin = process.env.ROBOBASSA_MERCHANT_LOGIN || '';
    this.password1 = process.env.ROBOBASSA_PASSWORD1 || '';
    this.password2 = process.env.ROBOBASSA_PASSWORD2 || '';
    this.enabled = !!(this.merchantLogin && this.password1 && this.password2);
    if (!this.enabled && (this.merchantLogin || this.password1)) {
      console.warn('[Robokassa] Настроены не все переменные ROBOBASSA_MERCHANT_LOGIN, ROBOBASSA_PASSWORD1, ROBOBASSA_PASSWORD2');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Подпись для перехода на оплату: MerchantLogin:OutSum:InvId:Password1 */
  private getPaymentSignature(outSum: string, invId: number): string {
    const str = `${this.merchantLogin}:${outSum}:${invId}:${this.password1}`;
    return crypto.createHash('md5').update(str).digest('hex').toUpperCase();
  }

  /** Подпись для Result URL (серверный callback): OutSum:InvId:Password2 */
  verifyResultSignature(outSum: string, invId: string, signatureValue: string): boolean {
    const str = `${outSum}:${invId}:${this.password2}`;
    const expected = crypto.createHash('md5').update(str).digest('hex').toUpperCase();
    return expected === (signatureValue || '').toUpperCase();
  }

  /** Формирует URL для редиректа пользователя на оплату */
  getPaymentUrl(params: { amount: number; invId: number; description?: string }): string | null {
    if (!this.enabled) return null;
    const outSum = params.amount.toFixed(2);
    const signature = this.getPaymentSignature(outSum, params.invId);
    const url = new URL(ROBOBASSA_URL);
    url.searchParams.set('MerchantLogin', this.merchantLogin);
    url.searchParams.set('OutSum', outSum);
    url.searchParams.set('InvId', String(params.invId));
    url.searchParams.set('SignatureValue', signature);
    url.searchParams.set('Description', params.description || `Пополнение баланса #${params.invId}`);
    return url.toString();
  }
}
