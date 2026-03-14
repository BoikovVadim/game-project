import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { generateReferralCode } from '../common/referral';
import { User } from '../users/user.entity';
import { MailService } from '../mail/mail.service';

function generateVerificationToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function generateVerificationCode(): string {
  return String(crypto.randomInt(100000, 999999));
}

const CODE_TTL_MINUTES = 15;

type RegisterResult = {
  success: true;
  requiresEmailVerification: true;
  email: string;
  username: string;
};

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
  ) {}

  async register(
    username: string,
    email: string,
    password: string,
    referralCodeInput?: string,
  ): Promise<RegisterResult> {
    const normalizedUsername = String(username || '').trim();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const existing = await this.userRepository
      .createQueryBuilder('u')
      .select(['u.id'])
      .where('LOWER(u.email) = :email', { email: normalizedEmail })
      .orWhere('LOWER(u.username) = :username', { username: normalizedUsername.toLowerCase() })
      .getOne();
    if (existing) {
      throw new ConflictException('Пользователь с таким email или username уже существует');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const DEFAULT_REFERRER_ID = 1;
    let referrerId: number | null = DEFAULT_REFERRER_ID;
    if (referralCodeInput?.trim()) {
      const raw = referralCodeInput.trim();
      // Поддерживаем два формата: ?ref=<id> и старый ?ref=<referralCode>
      if (/^\d+$/.test(raw)) {
        const id = Number(raw);
        const referrer = await this.userRepository.findOne({ where: { id } });
        if (referrer) referrerId = referrer.id;
      } else {
        const referrer = await this.userRepository.findOne({
          where: { referralCode: raw },
        });
        if (referrer) referrerId = referrer.id;
      }
    }
    const myCode = generateReferralCode();
    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);
    const user = this.userRepository.create({
      username: normalizedUsername,
      email: normalizedEmail,
      password: hashedPassword,
      referralCode: myCode,
      referrerId,
      emailVerified: false,
      emailVerificationToken: code,
      emailVerificationExpiresAt: expiresAt,
    });
    const saved = await this.userRepository.save(user);
    this.mailService.sendVerificationCode(normalizedEmail, code, normalizedUsername).catch((err) => {
      console.error('[AuthService] Не удалось отправить код подтверждения:', err);
    });
    return {
      success: true,
      requiresEmailVerification: true,
      email: saved.email,
      username: saved.username,
    };
  }

  async verifyEmail(token: string): Promise<{ success: boolean; message: string }> {
    if (!token || typeof token !== 'string') {
      return { success: false, message: 'Неверная ссылка' };
    }
    const user = await this.userRepository.findOne({
      where: { emailVerificationToken: token.trim() },
    });
    if (!user) {
      return { success: false, message: 'Ссылка недействительна или уже использована' };
    }
    if (user.emailVerificationExpiresAt && user.emailVerificationExpiresAt < new Date()) {
      return { success: false, message: 'Ссылка недействительна или истекла' };
    }
    user.emailVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationExpiresAt = null;
    await this.userRepository.save(user);
    return { success: true, message: 'Почта подтверждена. Теперь вы можете войти.' };
  }

  async login(email: string, password: string): Promise<{ access_token: string }> {
    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      throw new UnauthorizedException('Invalid credentials');
    }
    const input = String(email).trim().toLowerCase();
    const isEmail = input.includes('@');
    const qb = this.userRepository
      .createQueryBuilder('u')
      .select('u.id', 'id')
      .addSelect('u.username', 'username')
      .addSelect('u.email', 'email')
      .addSelect('u.password', 'password')
      .addSelect('u.emailVerified', 'emailVerified')
      .addSelect('u.emailVerificationToken', 'emailVerificationToken');
    if (isEmail) {
      qb.where('LOWER(u.email) = :input', { input });
    } else {
      qb.where('LOWER(u.username) = :input', { input });
    }
    const row = await qb.getRawOne<{ id: number; username: string; email: string; password: string; emailVerified: number; emailVerificationToken: string | null }>();
    if (!row || row.password == null || row.password === undefined) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const needsVerification = row.emailVerificationToken != null && !row.emailVerified;
    if (needsVerification) {
      throw new UnauthorizedException({ message: 'EMAIL_NOT_VERIFIED', email: row.email });
    }
    const passwordStr = String(row.password);
    const match = await bcrypt.compare(password, passwordStr);
    if (!match) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const userId = Number(row.id);
    const username = String(row.username ?? '');
    return {
      access_token: this.jwtService.sign({ username, sub: userId }),
    };
  }

  async verifyCode(email: string, code: string): Promise<{ success: boolean; message: string; access_token?: string }> {
    if (!email || !code) {
      return { success: false, message: 'Укажите email и код' };
    }
    const emailNorm = email.trim().toLowerCase();
    const user = await this.userRepository.findOne({ where: { email: emailNorm } });
    if (!user) {
      return { success: false, message: 'Пользователь не найден' };
    }
    if (user.emailVerified) {
      return { success: false, message: 'Почта уже подтверждена. Войдите через пароль.' };
    }
    if (!user.emailVerificationToken) {
      return { success: false, message: 'Код не был отправлен. Запросите новый.' };
    }
    if (user.emailVerificationExpiresAt && user.emailVerificationExpiresAt < new Date()) {
      return { success: false, message: 'Код истёк. Запросите новый.' };
    }
    if (user.emailVerificationToken !== code.trim()) {
      return { success: false, message: 'Неверный код' };
    }
    user.emailVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationExpiresAt = null;
    await this.userRepository.save(user);
    const token = this.jwtService.sign({ username: user.username, sub: user.id });
    return { success: true, message: 'Почта подтверждена!', access_token: token };
  }

  async resendCode(email: string): Promise<{ success: boolean; message: string }> {
    if (!email) {
      return { success: false, message: 'Укажите email' };
    }
    const emailNorm = email.trim().toLowerCase();
    const user = await this.userRepository.findOne({ where: { email: emailNorm } });
    if (!user) {
      return { success: true, message: 'Если аккаунт существует, код отправлен.' };
    }
    if (user.emailVerified) {
      return { success: true, message: 'Почта уже подтверждена.' };
    }
    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000);
    user.emailVerificationToken = code;
    user.emailVerificationExpiresAt = expiresAt;
    await this.userRepository.save(user);
    this.mailService.sendVerificationCode(user.email, code, user.username).catch((err) => {
      console.error('[AuthService] Не удалось отправить код:', err);
    });
    return { success: true, message: 'Новый код отправлен на почту.' };
  }

  async refresh(userId: number): Promise<{ access_token: string }> {
    const user = await this.userRepository.findOneBy({ id: userId });
    if (!user) throw new UnauthorizedException('User not found');
    return this.issueToken(user);
  }

  private issueToken(user: User): { access_token: string } {
    const payload = { username: user.username, sub: user.id };
    return {
      access_token: this.jwtService.sign(payload),
    };
  }

  async changePassword(userId: number, oldPassword: string, newPassword: string): Promise<{ message: string }> {
    const user = await this.userRepository.findOneBy({ id: userId });
    if (!user || !(await bcrypt.compare(oldPassword, user.password))) {
      throw new UnauthorizedException('Invalid current password');
    }
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await this.userRepository.save(user);
    return { message: 'Password changed successfully' };
  }

  /** Запрос восстановления пароля: отправляет письмо с ссылкой. Не раскрывает, есть ли пользователь с таким email. */
  async forgotPassword(email: string): Promise<{ message: string }> {
    const normalized = (email || '').trim().toLowerCase();
    if (!normalized) {
      return { message: 'Если аккаунт с такой почтой существует, на неё отправлена инструкция.' };
    }
    const user = await this.userRepository.findOne({ where: { email: normalized } });
    if (user) {
      const token = generateVerificationToken();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 час
      user.passwordResetToken = token;
      user.passwordResetExpiresAt = expiresAt;
      await this.userRepository.save(user);
      this.mailService.sendPasswordResetEmail(user.email, token, user.username).catch((err) => {
        console.error('[AuthService] Не удалось отправить письмо сброса пароля:', err);
      });
    }
    return { message: 'Если аккаунт с такой почтой существует, на неё отправлена инструкция.' };
  }

  /** Установка нового пароля по токену из письма */
  async resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
    const t = (token || '').trim();
    if (!t || !newPassword || newPassword.length < 6) {
      throw new UnauthorizedException('Неверная ссылка или слишком короткий пароль');
    }
    const user = await this.userRepository.findOne({
      where: { passwordResetToken: t },
    });
    if (!user || !user.passwordResetExpiresAt || user.passwordResetExpiresAt < new Date()) {
      throw new UnauthorizedException('Ссылка недействительна или истекла');
    }
    user.password = await bcrypt.hash(newPassword, 10);
    user.passwordResetToken = null;
    user.passwordResetExpiresAt = null;
    await this.userRepository.save(user);
    return { message: 'Пароль успешно изменён. Войдите с новым паролем.' };
  }
}