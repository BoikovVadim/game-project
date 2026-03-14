import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateNewsDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  topic!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  body!: string;
}

export class UpdateNewsDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  topic?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  body?: string;

  @IsOptional()
  @IsBoolean()
  published?: boolean;
}
