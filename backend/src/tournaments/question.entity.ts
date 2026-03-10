import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { Tournament } from './tournament.entity';

@Entity()
export class Question {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  question!: string;

  @Column('simple-json')
  options!: string[];

  @Column()
  correctAnswer!: number; // индекс правильного ответа

  @Column({ default: 0 })
  roundIndex!: number; // 0 = semi1, 1 = semi2, 2 = final

  @ManyToOne(() => Tournament, tournament => tournament.questions, { onDelete: 'CASCADE' })
  tournament!: Tournament;
}