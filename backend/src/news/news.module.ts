import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { News } from './news.entity';
import { NewsService } from './news.service';
import { NewsController } from './news.controller';
import { UsersModule } from '../users/users.module';
import { getRequiredEnv } from '../common/env';

@Module({
  imports: [
    TypeOrmModule.forFeature([News]),
    UsersModule,
    JwtModule.register({ secret: getRequiredEnv('JWT_SECRET'), signOptions: { expiresIn: '6h' } }),
  ],
  controllers: [NewsController],
  providers: [NewsService],
  exports: [NewsService],
})
export class NewsModule {}
