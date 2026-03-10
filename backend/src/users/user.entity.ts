import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, Index } from 'typeorm';

@Entity('user')
@Index('IDX_user_email', ['email'])
@Index('IDX_user_username', ['username'])
@Index('IDX_user_referrerId', ['referrerId'])
export class User {
  @PrimaryGeneratedColumn()
  id!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @Column()
  username!: string;

  /** Отображаемый ник (никнейм) игрока. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  nickname!: string | null;

  @Column()
  email!: string;

  /** Подтверждена ли почта (после перехода по ссылке из письма) */
  @Column({ type: 'boolean', default: false })
  emailVerified!: boolean;

  /** 6-значный код для подтверждения почты */
  @Column({ type: 'varchar', length: 64, nullable: true })
  emailVerificationToken!: string | null;

  /** Срок действия кода подтверждения почты */
  @Column({ type: 'timestamptz', nullable: true })
  emailVerificationExpiresAt!: Date | null;

  @Column()
  password!: string;

  /** Токен для сброса пароля (ссылка в письме) */
  @Column({ type: 'varchar', length: 64, nullable: true })
  passwordResetToken!: string | null;

  /** Срок действия ссылки сброса пароля */
  @Column({ type: 'timestamptz', nullable: true })
  passwordResetExpiresAt!: Date | null;

  /** Баланс в L (Legend) — используется в играх */
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  balance!: number;

  /** Баланс в рублях — отдельно от L */
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  balanceRubles!: number;

  /** Уникальный код для реферальной ссылки (например /register?ref=XXX) */
  @Column({ type: 'varchar', length: 128, unique: true, nullable: true })
  referralCode!: string | null;

  /** Кто пригласил этого пользователя (id пользователя) */
  @Column({ nullable: true })
  referrerId!: number | null;

  /** Время последнего «пинга» из личного кабинета (для подсчёта «онлайн»). */
  @Column({ type: 'timestamptz', nullable: true })
  lastCabinetSeenAt!: Date | null;

  /** Пол: 'male' | 'female' | null (не указан) */
  @Column({ type: 'varchar', length: 10, nullable: true })
  gender!: string | null;

  /** Дата рождения (YYYY-MM-DD) */
  @Column({ type: 'varchar', length: 10, nullable: true })
  birthDate!: string | null;

  /** Аватар пользователя (base64 data URL) */
  @Column({ type: 'text', nullable: true })
  avatarUrl!: string | null;

  @Column({ type: 'simple-json', nullable: true, default: null })
  readNewsIds!: number[] | null;

  /** Доступ в админ-панель и расширенные действия */
  @Column({ type: 'boolean', default: false })
  isAdmin!: boolean;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'referrerId' })
  referrer?: User | null;
}