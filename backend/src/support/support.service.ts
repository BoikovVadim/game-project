import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupportTicket } from './support-ticket.entity';
import { SupportMessage } from './support-message.entity';

@Injectable()
export class SupportService {
  constructor(
    @InjectRepository(SupportTicket)
    private readonly ticketRepo: Repository<SupportTicket>,
    @InjectRepository(SupportMessage)
    private readonly msgRepo: Repository<SupportMessage>,
  ) {}

  /** Игрок отправляет первое сообщение → создаётся тикет + сообщение */
  async createTicket(userId: number, text: string): Promise<{ ticket: SupportTicket; message: SupportMessage }> {
    const ticket = this.ticketRepo.create({ userId, status: 'open' });
    const saved = await this.ticketRepo.save(ticket);
    const msg = this.msgRepo.create({ ticketId: saved.id, userId, senderRole: 'user', text, unreadByAdmin: true, unreadByUser: false });
    const savedMsg = await this.msgRepo.save(msg);
    return { ticket: saved, message: savedMsg };
  }

  /** Игрок отправляет сообщение в существующий тикет */
  async sendUserMessage(ticketId: number, userId: number, text: string): Promise<SupportMessage> {
    const msg = this.msgRepo.create({ ticketId, userId, senderRole: 'user', text, unreadByAdmin: true, unreadByUser: false });
    return this.msgRepo.save(msg);
  }

  /** Тикеты игрока */
  async getTicketsForUser(userId: number): Promise<any[]> {
    const tickets = await this.ticketRepo.find({ where: { userId }, order: { createdAt: 'DESC' } });
    const result: any[] = [];
    for (const t of tickets) {
      const lastMsg = await this.msgRepo.findOne({ where: { ticketId: t.id }, order: { createdAt: 'DESC' } });
      const unreadCount = await this.msgRepo.count({ where: { ticketId: t.id, unreadByUser: true } });
      result.push({ ...t, lastText: lastMsg?.text ?? '', lastMessageAt: lastMsg?.createdAt ?? t.createdAt, unreadCount });
    }
    return result;
  }

  /** Сообщения в тикете */
  async getTicketMessages(ticketId: number): Promise<SupportMessage[]> {
    return this.msgRepo.find({ where: { ticketId }, order: { createdAt: 'ASC' } });
  }

  /** Пометить сообщения как прочитанные пользователем */
  async markReadByUser(ticketId: number): Promise<void> {
    await this.msgRepo.update({ ticketId, unreadByUser: true }, { unreadByUser: false });
  }

  /** Есть ли непрочитанные у пользователя (по всем тикетам) */
  async hasUnreadForUser(userId: number): Promise<boolean> {
    const count = await this.msgRepo.count({ where: { userId, unreadByUser: true } });
    return count > 0;
  }

  /** Получить тикет */
  async getTicket(ticketId: number): Promise<SupportTicket | null> {
    return this.ticketRepo.findOne({ where: { id: ticketId } });
  }

  // --- Admin ---

  /** Все тикеты (для админки) с фильтром по статусу */
  async getTicketsForAdmin(status?: string): Promise<any[]> {
    const where: any = {};
    if (status === 'open' || status === 'closed') where.status = status;
    const tickets = await this.ticketRepo.find({ where, order: { createdAt: 'DESC' } });
    const result: any[] = [];
    for (const t of tickets) {
      const user = await this.ticketRepo.query(
        `SELECT id, username, nickname, email FROM user WHERE id = ?`, [t.userId],
      );
      const lastMsg = await this.msgRepo.findOne({ where: { ticketId: t.id }, order: { createdAt: 'DESC' } });
      const unreadCount = await this.msgRepo.count({ where: { ticketId: t.id, unreadByAdmin: true } });
      result.push({
        ...t,
        username: user[0]?.username ?? '',
        nickname: user[0]?.nickname ?? '',
        email: user[0]?.email ?? '',
        lastText: lastMsg?.text ?? '',
        lastMessageAt: lastMsg?.createdAt ?? t.createdAt,
        unreadCount,
      });
    }
    return result;
  }

  /** Пометить сообщения тикета как прочитанные админом */
  async markReadByAdmin(ticketId: number): Promise<void> {
    await this.msgRepo.update({ ticketId, unreadByAdmin: true }, { unreadByAdmin: false });
  }

  /** Админ отвечает в тикет */
  async sendAdminMessage(ticketId: number, userId: number, text: string): Promise<SupportMessage> {
    const msg = this.msgRepo.create({ ticketId, userId, senderRole: 'admin', text, unreadByAdmin: false, unreadByUser: true });
    return this.msgRepo.save(msg);
  }

  /** Закрыть тикет (с прощальным сообщением игроку) */
  async closeTicket(ticketId: number): Promise<SupportTicket> {
    const ticket = await this.ticketRepo.findOne({ where: { id: ticketId } });
    if (!ticket) return null as any;
    const farewell = 'Хорошей игры и настроения, всего доброго!';
    const msg = this.msgRepo.create({ ticketId, userId: ticket.userId, senderRole: 'admin', text: farewell, unreadByAdmin: false, unreadByUser: true });
    await this.msgRepo.save(msg);
    await this.ticketRepo.update(ticketId, { status: 'closed', closedAt: new Date() });
    return (await this.ticketRepo.findOne({ where: { id: ticketId } }))!;
  }

  /** Переоткрыть тикет */
  async reopenTicket(ticketId: number): Promise<SupportTicket> {
    await this.ticketRepo.update(ticketId, { status: 'open', closedAt: null as any });
    return (await this.ticketRepo.findOne({ where: { id: ticketId } }))!;
  }

  /** Количество открытых тикетов с непрочитанными */
  async totalUnreadForAdmin(): Promise<number> {
    const rows = await this.msgRepo.query(
      `SELECT COUNT(DISTINCT ticketId) as cnt FROM support_message WHERE unreadByAdmin = 1`,
    );
    return Number(rows[0]?.cnt ?? 0);
  }
}
