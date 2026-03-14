import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

export enum TournamentResolutionStage {
  SEMI = 'semi',
  FINAL = 'final',
}

export enum TournamentResolutionOutcome {
  SLOT_A_WINS = 'slotA_wins',
  SLOT_B_WINS = 'slotB_wins',
  BOTH_LOST = 'both_lost',
}

export enum TournamentResolutionReason {
  TIMEOUT = 'timeout',
}

export enum TournamentResolutionSource {
  CRON = 'cron',
  BACKFILL = 'backfill',
}

@Entity('tournament_round_resolution')
@Index('IDX_tournament_round_resolution_tournamentId', ['tournamentId'])
@Index('IDX_tournament_round_resolution_stage_pair', ['tournamentId', 'stage', 'pairIndex'])
@Unique('UQ_tournament_round_resolution_round', ['tournamentId', 'stage', 'pairIndex', 'roundNumber'])
export class TournamentRoundResolution {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'integer' })
  tournamentId!: number;

  @Column({ type: 'varchar', length: 10 })
  stage!: TournamentResolutionStage;

  @Column({ type: 'integer' })
  pairIndex!: number;

  @Column({ type: 'integer' })
  roundNumber!: number;

  @Column({ type: 'integer' })
  slotAUserId!: number;

  @Column({ type: 'integer' })
  slotBUserId!: number;

  @Column({ type: 'varchar', length: 20 })
  outcome!: TournamentResolutionOutcome;

  @Column({ type: 'varchar', length: 20 })
  reason!: TournamentResolutionReason;

  @Column({ type: 'integer', nullable: true })
  winnerUserId!: number | null;

  @Column({ type: 'integer', nullable: true })
  loserUserId!: number | null;

  @Column({ type: 'timestamptz', nullable: true })
  sharedRoundStartedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  deadlineAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  resolvedAt!: Date;

  @Column({ type: 'varchar', length: 20 })
  source!: TournamentResolutionSource;

  @Column({ type: 'jsonb', nullable: true })
  meta!: Record<string, unknown> | null;
}
