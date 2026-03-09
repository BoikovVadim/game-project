import { IsString, MinLength, MaxLength } from 'class-validator';

export class ForgotPasswordDto {
  @IsString()
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(1)
  token!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(100)
  newPassword!: string;
}
