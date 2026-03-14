import { Type } from 'class-transformer';
import { IsIn, IsNumber, Min, Max } from 'class-validator';

export class CreatePaymentDto {
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(500000)
  amount!: number;

  @IsIn(['yookassa', 'robokassa'])
  provider!: 'yookassa' | 'robokassa';
}
