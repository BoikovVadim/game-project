import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity()
@Index('IDX_payment_userId', ['userId'])
@Index('IDX_payment_externalId', ['externalId'])
@Index('IDX_payment_status', ['status'])
export class Payment {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  userId!: number;

  /** Сумма в рублях */
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount!: number;

  /** yookassa | robokassa */
  @Column({ type: 'varchar', length: 20 })
  provider!: string;

  /** Внешний ID платежа (id в ЮKassa, InvId в Robokassa) */
  @Column({ type: 'varchar', length: 128 })
  externalId!: string;

  /** pending | succeeded | failed | cancelled */
  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
