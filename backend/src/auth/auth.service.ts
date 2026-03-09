import { Injectable, UnauthorizedException } from '@nestjs/common';
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
  ): Promise<User> {
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
    const emailVerificationToken = generateVerificationToken();
    const user = this.userRepository.create({
      username,
      email,
      password: hashedPassword,
      referralCode: myCode,
      referrerId,
      emailVerified: false,
      emailVerificationToken,
    });
    const saved = await this.userRepository.save(user);
    this.mailService.sendVerificationEmail(email, emailVerificationToken, username).catch((err) => {
      console.error('[AuthService] Не удалось отправить письмо:', err);
    });
    return saved;
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
    user.emailVerified = true;
    user.emailVerificationToken = null;
    await this.userRepository.save(user);
    return { success: true, message: 'Почта подтверждена. Теперь вы можете войти.' };
  }

  async login(email: string, password: string): Promise<{ access_token: string }> {
    if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
      throw new UnauthorizedException('Invalid credentials');
    }
    const emailNorm = String(email).trim().toLowerCase();
    const row = await this.userRepository
      .createQueryBuilder('u')
      .select('u.id', 'id')
      .addSelect('u.username', 'username')
      .addSelect('u.password', 'password')
      .addSelect('u.emailVerified', 'emailVerified')
      .addSelect('u.emailVerificationToken', 'emailVerificationToken')
      .where('LOWER(u.email) = :email', { email: emailNorm })
      .getRawOne<{ id: number; username: string; password: string; emailVerified: number; emailVerificationToken: string | null }>();
    if (!row || row.password == null || row.password === undefined) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const needsVerification = row.emailVerificationToken != null && !row.emailVerified;
    if (needsVerification) {
      throw new UnauthorizedException('Подтвердите почту. Проверьте письмо со ссылкой.');
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

  async changePassword(email: string, oldPassword: string, newPassword: string): Promise<{ message: string }> {
    const user = await this.userRepository.findOneBy({ email });
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