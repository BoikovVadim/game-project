import { Entity, PrimaryGeneratedColumn, Column, OneToMany, ManyToMany, JoinTable, CreateDateColumn, Index } from 'typeorm';
import { User } from '../users/user.entity';
import { Question } from './question.entity';

export enum TournamentStatus {
  WAITING = 'waiting',
  ACTIVE = 'active',
  FINISHED = 'finished',
}

export const ROUND_DEADLINE_HOURS = 24;
export const WAITING_DEADLINE_HOURS = 24;

@Entity()
@Index('IDX_tournament_status', ['status'])
@Index('IDX_tournament_gameType', ['gameType'])
@Index('IDX_tournament_createdAt', ['createdAt'])
export class Tournament {
  @PrimaryGeneratedColumn()
  id!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({
    type: 'simple-enum',
    enum: TournamentStatus,
    default: TournamentStatus.WAITING,
  })
  status!: TournamentStatus;

  /** 'training' = тренировка, 'money' = турнир за деньги. null = старые записи (считаем за money). */
  @Column({ type: 'varchar', length: 20, nullable: true })
  gameType!: string | null;

  /** Ставка лиги в L (legend coin) (только для gameType='money'). null = старые турниры. */
  @Column({ type: 'integer', nullable: true })
  leagueAmount!: number | null;

  /** Порядок входа игроков (массив userId). Определяет слоты: [0 vs 1] = полуфинал 1, [2 vs 3] = полуфинал 2. */
  @Column({ type: 'simple-json', nullable: true, default: null })
  playerOrder!: number[] | null;

  @ManyToMany(() => User)
  @JoinTable()
  players!: User[];

  @OneToMany(() => Question, question => question.tournament)
  questions!: Question[];
}