import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, Index } from 'typeorm';
import { User } from './user.entity';

@Entity()
@Index('IDX_transaction_userId', ['userId'])
@Index('IDX_transaction_category', ['category'])
@Index('IDX_transaction_createdAt', ['createdAt'])
@Index('IDX_transaction_userId_category', ['userId', 'category'])
export class Transaction {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column()
  userId!: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount!: number;

  @Column()
  description!: string;

  /** ID турнира (для списаний, выигрышей, возвратов) */
  @Column({ type: 'integer', nullable: true })
  tournamentId!: number | null;

  /** topup | loss | win | withdraw | refund | other */
  @Column({ type: 'varchar', length: 20, default: 'other' })
  category!: string;

  @CreateDateColumn()
  createdAt!: Date;
}