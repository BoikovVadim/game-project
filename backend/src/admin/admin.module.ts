import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { WithdrawalRequest } from '../users/withdrawal-request.entity';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { UsersModule } from '../users/users.module';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, WithdrawalRequest]),
    UsersModule,
    JwtModule.register({ secret: 'your-secret-key', signOptions: { expiresIn: '6h' } }),
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
