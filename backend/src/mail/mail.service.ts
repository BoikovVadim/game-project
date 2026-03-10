import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import * as dns from 'dns';

dns.setDefaultResultOrder('ipv4first');

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const MAIL_FROM = process.env.MAIL_FROM || SMTP_USER || 'noreply@example.com';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

const BREVO_API_KEY = process.env.BREVO_API_KEY || '';
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || SMTP_USER || 'noreply@example.com';
const BREVO_SENDER_NAME = process.env.BREVO_SENDER_NAME || 'Legend Games';

interface MailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter | null = null;
  private hasBrevo: boolean;
  private hasSmtp: boolean;

  constructor() {
    this.hasSmtp = !!(SMTP_HOST && SMTP_USER && SMTP_PASS);
    this.hasBrevo = !!BREVO_API_KEY;

    if (this.hasSmtp) {
      this.transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
        tls: { rejectUnauthorized: false },
        connectionTimeout: 10000,
        greetingTimeout: 8000,
        socketTimeout: 10000,
      });
      console.log('[MailService] SMTP настроен:', SMTP_HOST, ':', SMTP_PORT);
    }

    if (this.hasBrevo) {
      console.log('[MailService] Brevo API настроен (отправитель:', BREVO_SENDER_EMAIL + ')');
    }

    if (!this.hasSmtp && !this.hasBrevo) {
      console.warn('[MailService] Ни SMTP, ни Brevo не настроены. Письма не будут отправляться.');
    }
  }

  async sendPasswordResetEmail(to: string, token: string, username: string): Promise<boolean> {
    const resetUrl = `${APP_URL}/#/reset-password?token=${encodeURIComponent(token)}`;
    const html = this.wrapSimple(`
      <p>Здравствуйте, ${username}!</p>
      <p>Вы запросили восстановление пароля. Перейдите по ссылке:</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>Ссылка действительна 1 час.</p>
      <p>Если вы не запрашивали сброс пароля, проигнорируйте это письмо.</p>
    `);
    return this.send({
      to,
      subject: `Восстановление пароля для ${username}`,
      html,
      text: `Здравствуйте, ${username}!\n\nВы запросили восстановление пароля. Перейдите по ссылке:\n${resetUrl}\n\nСсылка действительна 1 час.\nЕсли вы не запрашивали сброс пароля, проигнорируйте это письмо.`,
    });
  }

  async sendVerificationCode(to: string, code: string, username: string): Promise<boolean> {
    const html = this.wrapBranded(`
      <tr><td style="padding:32px 24px 0;text-align:center">
        <h1 style="margin:0 0 4px;font-size:22px;font-weight:700;color:#c9a84c">Legend Games</h1>
        <p style="margin:0;font-size:13px;color:#aaa;letter-spacing:1px">ПОДТВЕРЖДЕНИЕ ПОЧТЫ</p>
      </td></tr>
      <tr><td style="padding:24px 24px 0;text-align:center">
        <p style="margin:0 0 6px;font-size:15px;color:#ddd">Здравствуйте, <strong style="color:#fff">${username}</strong>!</p>
        <p style="margin:0;font-size:14px;color:#999">Ваш код подтверждения:</p>
      </td></tr>
      <tr><td style="padding:20px 24px;text-align:center">
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto"><tr><td>
          <a style="display:inline-block;padding:14px 32px;background:#222;border:2px solid #c9a84c;border-radius:12px;font-size:32px;font-weight:700;letter-spacing:10px;color:#c9a84c;font-family:'Courier New',Courier,monospace;text-decoration:none;cursor:pointer;-webkit-user-select:all;user-select:all">${code}</a>
        </td></tr></table>
        <p style="margin:10px 0 0;font-size:11px;color:#666">Нажмите на код, чтобы выделить и скопировать</p>
      </td></tr>
      <tr><td style="padding:0 24px;text-align:center">
        <p style="margin:0 0 4px;font-size:13px;color:#bbb">Введите этот код на сайте</p>
        <p style="margin:0;font-size:12px;color:#888">Код действителен <strong style="color:#c9a84c">15 минут</strong></p>
      </td></tr>
      <tr><td style="padding:24px 24px 0;text-align:center;border-top:1px solid #333">
        <p style="margin:0;font-size:11px;color:#666">Если вы не регистрировались на LegendGames, проигнорируйте это письмо.</p>
      </td></tr>
    `);
    return this.send({
      to,
      subject: `${code} — код подтверждения LegendGames`,
      html,
      text: `Здравствуйте, ${username}!\n\nВаш код подтверждения: ${code}\n\nВведите этот код на сайте. Код действителен 15 минут.\nЕсли вы не регистрировались, проигнорируйте это письмо.`,
    });
  }

  /* ───── Транспорты с fallback-цепочкой ───── */

  private async send(payload: MailPayload): Promise<boolean> {
    if (!this.hasSmtp && !this.hasBrevo) {
      console.warn('[MailService] Пропуск отправки (нет транспортов):', payload.subject, '→', payload.to);
      return false;
    }

    // 1. Yandex SMTP (основной)
    if (this.hasSmtp) {
      try {
        const ok = await this.sendViaSmtp(payload);
        if (ok) return true;
      } catch { /* fallback ниже */ }
    }

    // 2. Brevo HTTP API (резервный)
    if (this.hasBrevo) {
      try {
        const ok = await this.sendViaBrevo(payload);
        if (ok) return true;
      } catch (err) {
        console.error('[MailService] Brevo тоже не смог отправить:', err);
      }
    }

    console.error('[MailService] Все транспорты не смогли отправить:', payload.subject, '→', payload.to);
    return false;
  }

  private async sendViaSmtp(payload: MailPayload): Promise<boolean> {
    if (!this.transporter) return false;
    try {
      const info = await this.transporter.sendMail({
        from: MAIL_FROM,
        to: payload.to,
        replyTo: SMTP_USER,
        subject: payload.subject,
        html: payload.html,
        text: payload.text || payload.html.replace(/<[^>]+>/g, ''),
        headers: {
          'X-Mailer': 'LegendGames',
          'Precedence': 'bulk',
        },
      });
      console.log('[MailService] SMTP отправлено:', payload.subject, '→', payload.to, '| id:', info.messageId);
      return true;
    } catch (err: any) {
      console.warn('[MailService] SMTP ошибка, переключаюсь на fallback:', err?.message || err);
      return false;
    }
  }

  private async sendViaBrevo(payload: MailPayload): Promise<boolean> {
    const body = JSON.stringify({
      sender: { name: BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL },
      to: [{ email: payload.to }],
      subject: payload.subject,
      htmlContent: payload.html,
      textContent: payload.text || payload.html.replace(/<[^>]+>/g, ''),
    });

    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': BREVO_API_KEY,
        'content-type': 'application/json',
      },
      body,
    });

    if (res.ok) {
      const data = await res.json() as any;
      console.log('[MailService] Brevo отправлено:', payload.subject, '→', payload.to, '| id:', data?.messageId);
      return true;
    }

    const errText = await res.text();
    console.error('[MailService] Brevo HTTP', res.status, ':', errText);
    return false;
  }

  /* ───── Шаблоны ───── */

  private wrapBranded(rows: string): string {
    return `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#111;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#111;padding:24px 0">
    <tr><td align="center">
      <table role="presentation" width="420" cellpadding="0" cellspacing="0" style="max-width:420px;width:100%;background:#1a1a1a;border-radius:16px;border:1px solid #333;overflow:hidden">
        ${rows}
        <tr><td style="padding:16px 24px 20px;text-align:center">
          <p style="margin:0;font-size:11px;color:#555">© Legend Games ${new Date().getFullYear()}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }

  private wrapSimple(body: string): string {
    return `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:20px;font-family:Arial,sans-serif;font-size:14px;color:#333">
  ${body}
  <p style="margin-top:24px;font-size:12px;color:#999">— LegendGames</p>
</body>
</html>`;
  }
}
