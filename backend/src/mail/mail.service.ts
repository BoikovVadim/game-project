import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

/** Настройки SMTP из переменных окружения. Без них письма не отправляются. */
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const MAIL_FROM = process.env.MAIL_FROM || SMTP_USER || 'noreply@example.com';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter | null = null;

  constructor() {
    if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
      this.transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,
        auth: {
          user: SMTP_USER,
          pass: SMTP_PASS,
        },
      });
    } else {
      console.warn('[MailService] SMTP не настроен (SMTP_HOST, SMTP_USER, SMTP_PASS). Письма не будут отправляться.');
    }
  }

  /** Отправка письма со ссылкой для сброса пароля */
  async sendPasswordResetEmail(to: string, token: string, username: string): Promise<boolean> {
    const resetUrl = `${APP_URL}/#/reset-password?token=${encodeURIComponent(token)}`;
    const html = this.wrapLayout(`
      <p style="font-size:16px;color:#333;margin:0 0 12px">Здравствуйте, <strong>${username}</strong>!</p>
      <p style="font-size:15px;color:#555;margin:0 0 24px">Вы запросили восстановление пароля. Нажмите кнопку ниже, чтобы задать новый пароль:</p>
      ${this.goldButton('Восстановить пароль', resetUrl)}
      <p style="font-size:13px;color:#999;margin:24px 0 0">Ссылка действительна 1 час.<br>Если вы не запрашивали сброс пароля, проигнорируйте это письмо.</p>
    `);
    return this.send({
      to,
      subject: 'LegendGames — Восстановление пароля',
      html,
      text: `Восстановление пароля: ${resetUrl}`,
    });
  }

  /** Отправка письма для подтверждения email */
  async sendVerificationEmail(to: string, token: string, username: string): Promise<boolean> {
    const verifyUrl = `${APP_URL}/#/verify-email?token=${encodeURIComponent(token)}`;
    const html = this.wrapLayout(`
      <p style="font-size:16px;color:#333;margin:0 0 12px">Здравствуйте, <strong>${username}</strong>!</p>
      <p style="font-size:15px;color:#555;margin:0 0 24px">Спасибо за регистрацию в <strong>LegendGames</strong>! Подтвердите свой email, нажав на кнопку ниже:</p>
      ${this.goldButton('Подтвердить', verifyUrl)}
      <p style="font-size:13px;color:#999;margin:24px 0 0">Ссылка действительна 24 часа.<br>Если вы не регистрировались, проигнорируйте это письмо.</p>
    `);
    return this.send({
      to,
      subject: 'LegendGames — Подтверждение регистрации',
      html,
      text: `Подтвердите регистрацию: ${verifyUrl}`,
    });
  }

  private goldButton(label: string, url: string): string {
    return `
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto">
        <tr>
          <td style="border-radius:8px;background:linear-gradient(135deg,#c9a032,#e2b93b,#f0cc45)" align="center">
            <a href="${url}" target="_blank" style="display:inline-block;padding:14px 40px;font-family:Arial,sans-serif;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px">${label}</a>
          </td>
        </tr>
      </table>`;
  }

  private wrapLayout(body: string): string {
    return `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#1a1a2e;font-family:Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#1a1a2e;padding:32px 0">
    <tr>
      <td align="center">
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.15)">
          <tr>
            <td style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:28px 32px;text-align:center">
              <span style="font-size:26px;font-weight:800;color:#e2b93b;letter-spacing:1px">LegendGames</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 36px;text-align:center">${body}</td>
          </tr>
          <tr>
            <td style="background:#f8f8f8;padding:16px 32px;text-align:center;border-top:1px solid #eee">
              <p style="font-size:12px;color:#aaa;margin:0">&copy; LegendGames. Все права защищены.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  private async send(options: { to: string; subject: string; html: string; text?: string }): Promise<boolean> {
    if (!this.transporter) {
      console.warn('[MailService] Пропуск отправки (SMTP не настроен):', options.subject, '→', options.to);
      return false;
    }
    try {
      const info = await this.transporter.sendMail({
        from: MAIL_FROM,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text || options.html.replace(/<[^>]+>/g, ''),
      });
      console.log('[MailService] Письмо отправлено:', options.subject, '→', options.to, '| messageId:', info.messageId);
      return true;
    } catch (err) {
      console.error('[MailService] Ошибка отправки:', err);
      return false;
    }
  }
}
