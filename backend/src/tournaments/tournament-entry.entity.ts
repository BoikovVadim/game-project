import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { Tournament } from './tournament.entity';
import { User } from '../users/user.entity';

@Entity()
@Index('IDX_entry_tournamentId', ['tournament'])
@Index('IDX_entry_userId', ['user'])
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
