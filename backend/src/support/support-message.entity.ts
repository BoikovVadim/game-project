import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../users/user.entity';
import { SupportTicket } from './support-ticket.entity';

@Entity('support_message')
export class SupportMessage {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  ticketId!: number;

  @Column()
  userId!: number;

  /** 'user' — от игрока, 'admin' — от поддержки */
  @Column({ type: 'varchar', length: 10 })
  senderRole!: 'user' | 'admin';

  @Column({ type: 'text' })
  text!: string;

  @Column({ type: 'boolean', default: false })
  unreadByAdmin!: boolean;

  @Column({ type: 'boolean', default: false })
  unreadByUser!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @ManyToOne(() => SupportTicket, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticketId' })
  ticket?: SupportTicket;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: User;
}
