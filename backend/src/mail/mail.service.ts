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
    const resetUrl = `${APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
    const html = `
      <p>Здравствуйте, ${username}!</p>
      <p>Вы запросили восстановление пароля. Перейдите по ссылке, чтобы задать новый пароль:</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>Ссылка действительна 1 час.</p>
      <p>Если вы не запрашивали сброс пароля, проигнорируйте это письмо.</p>
    `;
    return this.send({
      to,
      subject: 'Восстановление пароля',
      html,
      text: `Восстановление пароля: ${resetUrl}`,
    });
  }

  /** Отправка письма для подтверждения email */
  async sendVerificationEmail(to: string, token: string, username: string): Promise<boolean> {
    const verifyUrl = `${APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
    const html = `
      <p>Здравствуйте, ${username}!</p>
      <p>Подтвердите регистрацию, перейдя по ссылке:</p>
      <p><a href="${verifyUrl}">${verifyUrl}</a></p>
      <p>Ссылка действительна 24 часа.</p>
      <p>Если вы не регистрировались, проигнорируйте это письмо.</p>
    `;
    return this.send({
      to,
      subject: 'Подтверждение регистрации',
      html,
      text: `Подтвердите регистрацию: ${verifyUrl}`,
    });
  }

  private async send(options: { to: string; subject: string; html: string; text?: string }): Promise<boolean> {
    if (!this.transporter) {
      console.warn('[MailService] Пропуск отправки (SMTP не настроен):', options.subject, '→', options.to);
      return false;
    }
    try {
      await this.transporter.sendMail({
        from: MAIL_FROM,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text || options.html.replace(/<[^>]+>/g, ''),
      });
      return true;
    } catch (err) {
      console.error('[MailService] Ошибка отправки:', err);
      return false;
    }
  }
}
