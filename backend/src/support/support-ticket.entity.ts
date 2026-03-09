import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../users/user.entity';

@Entity('support_ticket')
export class SupportTicket {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  userId!: number;

  /** 'open' | 'closed' */
  @Column({ type: 'varchar', length: 16, default: 'open' })
  status!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: 'datetime', nullable: true })
  closedAt!: Date | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: User;
}
