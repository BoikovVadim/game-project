import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('news')
export class News {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 255 })
  topic!: string;

  @Column({ type: 'text' })
  body!: string;

  @Column({ default: true })
  published!: boolean;

  @Column({ type: 'varchar', length: 64, nullable: true, default: null })
  commitHash!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
