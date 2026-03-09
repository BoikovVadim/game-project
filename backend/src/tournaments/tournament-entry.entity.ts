import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Tournament } from './tournament.entity';
import { User } from '../users/user.entity';

@Entity()
export class TournamentEntry {
  @PrimaryGeneratedColumn()
  id!: number;

  @ManyToOne(() => Tournament, { onDelete: 'CASCADE' })
  @JoinColumn()
  tournament!: Tournament;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn()
  user!: User;

  @Column()
  joinedAt!: Date;
}
