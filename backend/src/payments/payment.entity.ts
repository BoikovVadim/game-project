import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity()
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
