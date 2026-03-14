import { IsEmail, IsString, Length, MinLength } from 'class-validator';

export class VerifyCodeDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(1, 32)
  code!: string;
}

export class ResendCodeDto {
  @IsEmail()
  email!: string;
}
