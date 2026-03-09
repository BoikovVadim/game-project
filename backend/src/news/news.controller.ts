import { Controller, Get, Post, Put, Delete, Body, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { NewsService } from './news.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@Controller('news')
export class NewsController {
  constructor(private readonly newsService: NewsService) {}

  @Get()
  getPublished() {
    return this.newsService.findAll();
  }

  @Get('admin')
  @UseGuards(JwtAuthGuard, AdminGuard)
  getAllAdmin() {
    return this.newsService.findAllAdmin();
  }

  @Post('generate')
  @UseGuards(JwtAuthGuard, AdminGuard)
  generate() {
    return this.newsService.generate();
  }

  @Post()
  @UseGuards(JwtAuthGuard, AdminGuard)
  create(@Body() body: { topic: string; body: string }) {
    return this.newsService.create(body.topic, body.body);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { topic?: string; body?: string; published?: boolean },
  ) {
    return this.newsService.update(id, body);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.newsService.remove(id);
  }
}
