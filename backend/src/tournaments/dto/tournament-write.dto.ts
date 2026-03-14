import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsPositive, IsNumber, Min } from 'class-validator';

export class CompleteTournamentDto {
  @IsOptional()
  @IsBoolean()
  passed?: boolean;
}

export class SetTournamentProgressDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  count?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  currentIndex?: number;

  @IsOptional()
  @IsNumber()
  timeLeft?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  correctCount?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(0)
  @ArrayMaxSize(1000)
  @Type(() => Number)
  answersChosen?: number[];

  @IsOptional()
  @IsBoolean()
  answerFinal?: boolean;
}

export class CreateTournamentDto {
  @IsInt()
  @IsPositive()
  userId!: number;
}

export class JoinTournamentDto {
  @IsOptional()
  @IsInt()
  @IsPositive()
  leagueAmount?: number;
}
