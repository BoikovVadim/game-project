import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class MarkNewsReadDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  newsId!: number;
}

export class UpdateNicknameDto {
  @IsOptional()
  @IsString()
  @MaxLength(15)
  nickname?: string | null;
}

export class UpdateAvatarDto {
  @IsOptional()
  @IsString()
  avatarUrl?: string | null;
}

export class UpdatePersonalDto {
  @IsOptional()
  @IsIn(['male', 'female', 'other'])
  gender?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  birthDate?: string | null;
}

export class UpdateBalanceDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId!: number;

  @Type(() => Number)
  @IsNumber()
  newBalance!: number;
}

export class AddBalanceDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId?: number;
}

export class ConvertCurrencyDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsIn(['rubles_to_l', 'l_to_rubles'])
  direction!: 'rubles_to_l' | 'l_to_rubles';
}

export class WithdrawalRequestDto {
  @Type(() => Number)
  @IsNumber()
  @Min(100)
  @Max(1000000)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  details?: string;
}
