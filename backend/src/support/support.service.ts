import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupportMessage } from './support-message.entity';

@Injectable()
export class SupportService {
  constructor(
    @InjectRepository(SupportMessage)
    private readonly msgRepo: Repository<SupportMessage>,
  ) {}

  async sendUserMessage(userId: number, text: string): Promise<SupportMessage> {
    const msg = this.msgRepo.create({ userId, senderRole: 'user', text, unreadByAdmin: true, unreadByUser: false });
    return this.msgRepo.save(msg);
  }

  async getMessagesForUser(userId: number): Promise<SupportMessage[]> {
    return this.msgRepo.find({ where: { userId }, order: { createdAt: 'ASC' } });
  }

  async markReadByUser(userId: number): Promise<void> {
    await this.msgRepo.update({ userId, unreadByUser: true }, { unreadByUser: false });
  }

  async hasUnreadForUser(userId: number): Promise<boolean> {
    const count = await this.msgRepo.count({ where: { userId, unreadByUser: true } });
    return count > 0;
  }

  /** Все диалоги (для админки) — последнее сообщение и счётчик непрочитанных */
  async getConversations(): Promise<any[]> {
    const rows = await this.msgRepo.query(`
      SELECT m.userId,
             u.username,
             u.nickname,
             u.email,
             (SELECT COUNT(*) FROM support_message WHERE userId = m.userId AND unreadByAdmin = 1) AS unreadCount,
             (SELECT text FROM support_message WHERE userId = m.userId ORDER BY createdAt DESC LIMIT 1) AS lastText,
             (SELECT createdAt FROM support_message WHERE userId = m.userId ORDER BY createdAt DESC LIMIT 1) AS lastMessageAt
      FROM support_message m
      LEFT JOIN user u ON u.id = m.userId
      GROUP BY m.userId
      ORDER BY lastMessageAt DESC
    `);
    return rows;
  }

  async getMessagesForAdmin(userId: number): Promise<SupportMessage[]> {
    return this.msgRepo.find({ where: { userId }, order: { createdAt: 'ASC' } });
  }

  async markReadByAdmin(userId: number): Promise<void> {
    await this.msgRepo.update({ userId, unreadByAdmin: true }, { unreadByAdmin: false });
  }

  async sendAdminMessage(userId: number, text: string): Promise<SupportMessage> {
    const msg = this.msgRepo.create({ userId, senderRole: 'admin', text, unreadByAdmin: false, unreadByUser: true });
    return this.msgRepo.save(msg);
  }

  async totalUnreadForAdmin(): Promise<number> {
    return this.msgRepo.count({ where: { unreadByAdmin: true } });
  }
}
