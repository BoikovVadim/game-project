import { Controller, Get, Post, Body, Param, UseGuards, Request, ParseIntPipe } from '@nestjs/common';
import { SupportService } from './support.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@Controller('support')
@UseGuards(JwtAuthGuard)
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Post('messages')
  sendMessage(@Request() req: { user: { id: number } }, @Body() body: { text: string }) {
    const text = (body.text || '').trim();
    if (!text) return { error: 'Пустое сообщение' };
    return this.supportService.sendUserMessage(req.user.id, text);
  }

  @Get('messages')
  async getMessages(@Request() req: { user: { id: number } }) {
    await this.supportService.markReadByUser(req.user.id);
    return this.supportService.getMessagesForUser(req.user.id);
  }

  @Get('unread')
  async hasUnread(@Request() req: { user: { id: number } }) {
    return { unread: await this.supportService.hasUnreadForUser(req.user.id) };
  }

  // --- Admin ---

  @Get('admin/conversations')
  @UseGuards(AdminGuard)
  getConversations() {
    return this.supportService.getConversations();
  }

  @Get('admin/unread-count')
  @UseGuards(AdminGuard)
  async adminUnreadCount() {
    return { count: await this.supportService.totalUnreadForAdmin() };
  }

  @Get('admin/conversations/:userId')
  @UseGuards(AdminGuard)
  async getConversation(@Param('userId', ParseIntPipe) userId: number) {
    await this.supportService.markReadByAdmin(userId);
    return this.supportService.getMessagesForAdmin(userId);
  }

  @Post('admin/conversations/:userId/messages')
  @UseGuards(AdminGuard)
  sendAdminReply(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() body: { text: string },
  ) {
    const text = (body.text || '').trim();
    if (!text) return { error: 'Пустое сообщение' };
    return this.supportService.sendAdminMessage(userId, text);
  }
}
