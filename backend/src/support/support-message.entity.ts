import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../users/user.entity';

@Entity('support_message')
export class SupportMessage {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  userId!: number;

  /** 'user' — от игрока, 'admin' — от поддержки */
  @Column({ type: 'varchar', length: 10 })
  senderRole!: 'user' | 'admin';

  @Column({ type: 'text' })
  text!: string;

  /** true если админ ещё не видел (для бейджа) */
  @Column({ type: 'boolean', default: false })
  unreadByAdmin!: boolean;

  /** true если пользователь ещё не видел (для бейджа) */
  @Column({ type: 'boolean', default: false })
  unreadByUser!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: User;
}
