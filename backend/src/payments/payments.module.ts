import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from './payment.entity';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { YooKassaService } from './yookassa.service';
import { RobokassaService } from './robokassa.service';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment]),
    UsersModule,
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService, YooKassaService, RobokassaService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
