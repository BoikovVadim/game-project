import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity('question_pool')
@Index('idx_question_pool_topic', ['topic'])
export class QuestionPoolItem {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  topic!: string;

  @Column('text')
  question!: string;

  @Column('simple-json')
  options!: string[];

  @Column()
  correctAnswer!: number;
}
