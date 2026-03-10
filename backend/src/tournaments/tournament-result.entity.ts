import { Entity, PrimaryGeneratedColumn, Column, Unique } from 'typeorm';

/** Результат участника по турниру: пройден / не пройден (после ответа на все вопросы или истечения времени). */
@Entity()
@Unique(['userId', 'tournamentId'])
export class TournamentResult {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  userId!: number;

  @Column()
  tournamentId!: number;

  @Column({ type: 'integer', default: 0 })
  passed!: number; // 1 = пройден, 0 = не пройден

  @Column({ type: 'timestamp', nullable: true, default: null })
  completedAt!: Date | null;
}
