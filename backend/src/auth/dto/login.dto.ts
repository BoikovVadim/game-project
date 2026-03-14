import { IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';

export class LoginDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  email?: string;

  @ValidateIf((o) => !o.email)
  @IsString()
  @MinLength(1)
  identifier?: string;

  @IsString()
  @MinLength(1)
  password!: string;
}
