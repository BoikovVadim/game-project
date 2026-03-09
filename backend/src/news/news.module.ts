import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { News } from './news.entity';
import { NewsService } from './news.service';
import { NewsController } from './news.controller';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([News]),
    UsersModule,
    JwtModule.register({ secret: process.env.JWT_SECRET || 'fallback-dev-key-change-me', signOptions: { expiresIn: '6h' } }),
  ],
  controllers: [NewsController],
  providers: [NewsService],
  exports: [NewsService],
})
export class NewsModule {}
