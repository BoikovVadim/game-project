import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, Index } from 'typeorm';
import { User } from '../users/user.entity';

/** Буфер: взнос игрока в турнир. При отсутствии победы/поражения (время вышло) — возврат. */
@Entity()
@Index('IDX_escrow_tournamentId', ['tournamentId'])
@Index('IDX_escrow_userId', ['userId'])
@Index('IDX_escrow_status', ['status'])
export class TournamentEscrow {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  userId!: number;

  @Column()
  tournamentId!: number;

  @Column({ type: 'integer' })
  amount!: number;

  /** 'held' | 'refunded' | 'paid_to_winner' */
  @Column({ type: 'varchar', length: 20, default: 'held' })
  status!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
