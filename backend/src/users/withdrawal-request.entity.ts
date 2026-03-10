import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, Index } from 'typeorm';
import { User } from './user.entity';

@Entity()
@Index('IDX_withdrawal_userId', ['userId'])
@Index('IDX_withdrawal_status', ['status'])
export class WithdrawalRequest {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  userId!: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user!: User;

  /** Сумма в рублях */
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount!: number;

  /** Реквизиты (карта, счёт и т.д.) */
  @Column({ type: 'varchar', length: 500, nullable: true })
  details!: string | null;

  /** pending | approved | rejected */
  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status!: string;

  /** Комментарий админа при одобрении/отклонении */
  @Column({ type: 'varchar', length: 500, nullable: true })
  adminComment!: string | null;

  /** ID админа, обработавшего заявку */
  @Column({ type: 'integer', nullable: true })
  processedByAdminId!: number | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'processedByAdminId' })
  processedByAdmin?: User | null;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  processedAt!: Date | null;
}
