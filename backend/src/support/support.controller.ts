import { Controller, Get, Post, Body, Param, Query, UseGuards, Request, ParseIntPipe, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SupportService } from './support.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@Controller('support')
@UseGuards(JwtAuthGuard)
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  /** Создать новый тикет (первое сообщение) */
  @Post('tickets')
  async createTicket(@Request() req: { user: { id: number } }, @Body() body: { text: string }) {
    const text = (body.text || '').trim();
    if (!text) throw new BadRequestException('Пустое сообщение');
    return this.supportService.createTicket(req.user.id, text);
  }

  /** Список тикетов игрока */
  @Get('tickets')
  getTickets(@Request() req: { user: { id: number } }) {
    return this.supportService.getTicketsForUser(req.user.id);
  }

  /** Сообщения в тикете (для игрока) */
  @Get('tickets/:id/messages')
  async getTicketMessages(@Param('id', ParseIntPipe) id: number, @Request() req: { user: { id: number } }) {
    const ticket = await this.supportService.getTicket(id);
    if (!ticket || ticket.userId !== req.user.id) throw new ForbiddenException();
    await this.supportService.markReadByUser(id);
    return this.supportService.getTicketMessages(id);
  }

  /** Отправить сообщение в тикет (игрок) */
  @Post('tickets/:id/messages')
  async sendMessage(@Param('id', ParseIntPipe) id: number, @Request() req: { user: { id: number } }, @Body() body: { text: string }) {
    const text = (body.text || '').trim();
    if (!text) throw new BadRequestException('Пустое сообщение');
    const ticket = await this.supportService.getTicket(id);
    if (!ticket || ticket.userId !== req.user.id) throw new ForbiddenException();
    if (ticket.status === 'closed') {
      await this.supportService.reopenTicket(id);
    }
    return this.supportService.sendUserMessage(id, req.user.id, text);
  }

  /** Есть ли непрочитанные у пользователя */
  @Get('unread')
  async hasUnread(@Request() req: { user: { id: number } }) {
    return { unread: await this.supportService.hasUnreadForUser(req.user.id) };
  }

  // --- Admin ---

  /** Все тикеты (для админки) */
  @Get('admin/tickets')
  @UseGuards(AdminGuard)
  getAdminTickets(@Query('status') status?: string) {
    return this.supportService.getTicketsForAdmin(status);
  }

  /** Количество тикетов с непрочитанными */
  @Get('admin/unread-count')
  @UseGuards(AdminGuard)
  async adminUnreadCount() {
    return { count: await this.supportService.totalUnreadForAdmin() };
  }

  /** Сообщения тикета (для админа) */
  @Get('admin/tickets/:id/messages')
  @UseGuards(AdminGuard)
  async getAdminTicketMessages(@Param('id', ParseIntPipe) id: number) {
    const ticket = await this.supportService.getTicket(id);
    if (!ticket) throw new NotFoundException();
    await this.supportService.markReadByAdmin(id);
    return this.supportService.getTicketMessages(id);
  }

  /** Ответ админа в тикет */
  @Post('admin/tickets/:id/messages')
  @UseGuards(AdminGuard)
  async sendAdminReply(@Param('id', ParseIntPipe) id: number, @Body() body: { text: string }) {
    const text = (body.text || '').trim();
    if (!text) throw new BadRequestException('Пустое сообщение');
    const ticket = await this.supportService.getTicket(id);
    if (!ticket) throw new NotFoundException();
    return this.supportService.sendAdminMessage(id, ticket.userId, text);
  }

  /** Закрыть тикет */
  @Post('admin/tickets/:id/close')
  @UseGuards(AdminGuard)
  async closeTicket(@Param('id', ParseIntPipe) id: number) {
    const ticket = await this.supportService.getTicket(id);
    if (!ticket) throw new NotFoundException();
    return this.supportService.closeTicket(id);
  }

  /** Переоткрыть тикет */
  @Post('admin/tickets/:id/reopen')
  @UseGuards(AdminGuard)
  async reopenTicket(@Param('id', ParseIntPipe) id: number) {
    const ticket = await this.supportService.getTicket(id);
    if (!ticket) throw new NotFoundException();
    return this.supportService.reopenTicket(id);
  }
}
