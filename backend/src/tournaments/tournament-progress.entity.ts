import { Entity, PrimaryGeneratedColumn, Column, Unique } from 'typeorm';

/** Сколько вопросов ответил участник в турнире (для статуса: не пройден только если начал и не ответил на все). */
@Entity()
@Unique(['userId', 'tournamentId'])
export class TournamentProgress {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  userId!: number;

  @Column()
  tournamentId!: number;

  @Column({ type: 'integer', default: 0 })
  questionsAnsweredCount!: number;

  /** Сколько ответов было верными (для статистики). */
  @Column({ type: 'integer', default: 0 })
  correctAnswersCount!: number;

  /** Верных ответов в полуфинале (первые 10 вопросов). Заполняется при достижении 10 ответов — для сравнения с соперником. */
  @Column({ type: 'integer', nullable: true })
  semiFinalCorrectCount!: number | null;

  /** Индекс вопроса, на котором остановились (0–9 полуфинал, 10–19 финал). Для продолжения с того же вопроса. */
  @Column({ type: 'integer', default: 0 })
  currentQuestionIndex!: number;

  /** Секунд осталось на вопрос в момент выхода (чтобы не давать лишнее время при возврате). */
  @Column({ type: 'integer', nullable: true })
  timeLeftSeconds!: number | null;

  /** Момент выхода (для пересчёта оставшегося времени при возврате). */
  @Column({ type: 'timestamptz', nullable: true })
  leftAt!: Date | null;

  /** Верных ответов в каждом доп. раунде полуфинала: [r1, r2, ...] — для неограниченных доп. раундов. */
  @Column({ type: 'simple-json', nullable: true })
  tiebreakerRoundsCorrect!: number[] | null;

  /** Верных ответов в каждом доп. раунде финала: [r1, r2, ...]. */
  @Column({ type: 'simple-json', nullable: true })
  finalTiebreakerRoundsCorrect!: number[] | null;

  /** Индексы выбранных ответов по вопросам (0-based по порядку вопросов: 0–9 полуфинал 1, 10–19 полуфинал 2, 20–29 финал). */
  @Column({ type: 'simple-json', nullable: true })
  answersChosen!: number[] | null;

  /** Количество заблокированных ответов — ответы с индексом < lockedAnswerCount не могут быть перезаписаны (защита от читерства). */
  @Column({ type: 'integer', default: 0 })
  lockedAnswerCount!: number;

  /** Когда игрок начал текущий раунд (для персонального 24ч таймера). Сбрасывается при переходе на новый этап (ТБ, финал). */
  @Column({ type: 'timestamptz', nullable: true })
  roundStartedAt!: Date | null;
}
