import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min, IsNumber } from 'class-validator';

export class WithdrawalDecisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class ImpersonateDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId!: number;
}

export class CreditBalanceDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class SetUserAdminDto {
  @IsBoolean()
  isAdmin!: boolean;
}
