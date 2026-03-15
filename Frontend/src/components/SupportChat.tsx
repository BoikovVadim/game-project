import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import axios from 'axios';
import { useNavigate, useSearchParams } from 'react-router-dom';
import './SupportChat.css';

interface Ticket {
  id: number;
  status: string;
  createdAt: string;
  lastText: string;
  lastMessageAt: string;
  unreadCount: number;
}

interface Message {
  id: number;
  senderRole: 'user' | 'admin';
  text: string;
  createdAt: string;
}

function formatDateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function dateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export default function SupportChat({ token }: { token: string }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const returnTo = searchParams.get('returnTo');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [openTicketId, setOpenTicketId] = useState<number | null>(() => {
    const raw = searchParams.get('ticket');
    const parsed = raw ? parseInt(raw, 10) : NaN;
    return Number.isNaN(parsed) || parsed <= 0 ? null : parsed;
  });
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [userName, setUserName] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const messagesWrapRef = useRef<HTMLDivElement>(null);
  const messagesRequestIdRef = useRef(0);
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  useEffect(() => {
    axios.get<{ nickname?: string; username?: string }>('/users/profile', { headers })
      .then((r) => setUserName(r.data.nickname || r.data.username || ''))
      .catch(() => {});
  }, [headers]);

  const fetchTickets = useCallback(() => {
    axios.get<Ticket[]>('/support/tickets', { headers })
      .then((r) => setTickets(r.data))
      .catch(() => {});
  }, [headers]);

  useEffect(() => {
    fetchTickets();
    const iv = setInterval(fetchTickets, 5000);
    return () => clearInterval(iv);
  }, [fetchTickets]);

  const fetchMessages = useCallback(() => {
    if (!openTicketId) return;
    const requestId = ++messagesRequestIdRef.current;
    setMessagesLoading(true);
    axios.get<Message[]>(`/support/tickets/${openTicketId}/messages`, { headers })
      .then((r) => {
        if (messagesRequestIdRef.current !== requestId) return;
        setMessages(Array.isArray(r.data) ? r.data : []);
        void axios.post(`/support/tickets/${openTicketId}/read`, {}, { headers }).catch(() => {});
        fetchTickets();
      })
      .catch(() => {})
      .finally(() => {
        if (messagesRequestIdRef.current !== requestId) return;
        setMessagesLoading(false);
      });
  }, [headers, openTicketId, fetchTickets]);

  useEffect(() => {
    if (openTicketId) {
      fetchMessages();
      const iv = setInterval(fetchMessages, 4000);
      return () => clearInterval(iv);
    }
  }, [openTicketId, fetchMessages]);

  useEffect(() => {
    const wrap = messagesWrapRef.current;
    if (!wrap) return;
    const nearBottom = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 80;
    if (nearBottom) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const openTicket = (id: number) => {
    setOpenTicketId(id);
    setMessages([]);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('ticket', String(id));
      return next;
    }, { replace: true });
  };

  const createNewTicket = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const r = await axios.post<{ ticket: Ticket }>('/support/tickets', { text }, { headers });
      setDraft('');
      setOpenTicketId(r.data.ticket.id);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('ticket', String(r.data.ticket.id));
        return next;
      }, { replace: true });
      fetchTickets();
    } catch {}
    setSending(false);
  };

  const sendMessage = async () => {
    const text = draft.trim();
    if (!text || sending || !openTicketId) return;
    setSending(true);
    try {
      await axios.post(`/support/tickets/${openTicketId}/messages`, { text }, { headers });
      setDraft('');
      fetchMessages();
      fetchTickets();
    } catch {}
    setSending(false);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (openTicketId) sendMessage();
      else createNewTicket();
    }
  };

  const currentTicket = tickets.find((t) => t.id === openTicketId);
  const navigateBackToCabinet = useCallback(() => {
    if (returnTo && returnTo.startsWith('/')) {
      navigate(returnTo);
      return;
    }
    navigate('/profile?section=news');
  }, [navigate, returnTo]);

  useEffect(() => {
    const raw = searchParams.get('ticket');
    const parsed = raw ? parseInt(raw, 10) : NaN;
    const nextTicketId = Number.isNaN(parsed) || parsed <= 0 ? null : parsed;
    setOpenTicketId((prev) => prev === nextTicketId ? prev : nextTicketId);
  }, [searchParams]);

  // --- Список тикетов ---
  if (!openTicketId) {
    return (
      <div className="support-chat-page">
        <header className="support-chat-header">
          <button type="button" className="support-chat-back" onClick={navigateBackToCabinet}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Назад
          </button>
          <h1 className="support-chat-title">Тех. поддержка</h1>
        </header>

        <div className="support-tickets-list">
          {tickets.length === 0 && (
            <div className="support-chat-empty">У вас пока нет обращений</div>
          )}
          {tickets.map((t) => (
            <button key={t.id} type="button" className={`support-ticket-card ${t.status}`} onClick={() => openTicket(t.id)}>
              <div className="support-ticket-card-top">
                <span className="support-ticket-card-id">#{t.id}</span>
                <span className={`support-ticket-status support-ticket-status--${t.status}`}>
                  {t.status === 'open' ? 'Открыт' : 'Закрыт'}
                </span>
              </div>
              <div className="support-ticket-card-text">{t.lastText.slice(0, 80)}{t.lastText.length > 80 ? '…' : ''}</div>
              <div className="support-ticket-card-bottom">
                <span className="support-ticket-card-date">{formatDateLabel(t.createdAt)}</span>
                {t.unreadCount > 0 && <span className="support-ticket-card-badge">{t.unreadCount}</span>}
              </div>
            </button>
          ))}
        </div>

        <div className="support-new-ticket-wrap">
          <textarea
            className="support-chat-input"
            placeholder="Опишите проблему — создастся новое обращение..."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKey}
            rows={1}
          />
          <button type="button" className="support-chat-send" onClick={createNewTicket} disabled={!draft.trim() || sending}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  // --- Чат внутри тикета ---
  let lastDate = '';

  return (
    <div className="support-chat-page">
      <header className="support-chat-header">
        <button type="button" className="support-chat-back" onClick={() => {
          setOpenTicketId(null);
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.delete('ticket');
            return next;
          }, { replace: true });
          fetchTickets();
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          К обращениям
        </button>
        <h1 className="support-chat-title">Обращение #{openTicketId}</h1>
        {currentTicket && (
          <span className={`support-ticket-header-status support-ticket-status--${currentTicket.status}`}>
            {currentTicket.status === 'open' ? 'Открыт' : 'Закрыт'}
          </span>
        )}
      </header>

      <div className="support-chat-messages" ref={messagesWrapRef}>
        {messagesLoading && messages.length === 0 && (
          <div className="support-chat-empty">Загрузка...</div>
        )}
        {!messagesLoading && messages.length === 0 && (
          <div className="support-chat-empty">Сообщений пока нет</div>
        )}
        {messages.map((m) => {
          const dk = dateKey(m.createdAt);
          const showDate = dk !== lastDate;
          if (showDate) lastDate = dk;
          return (
            <React.Fragment key={m.id}>
              {showDate && <div className="support-date-separator">{formatDateLabel(m.createdAt)}</div>}
              <div className={`support-msg ${m.senderRole === 'user' ? 'support-msg--user' : 'support-msg--admin'}`}>
                <div className="support-msg-col">
                  <div className="support-msg-name">{m.senderRole === 'user' ? (userName || 'Вы') : 'Поддержка'}</div>
                  <div className="support-msg-bubble">
                    <div className="support-msg-body">
                      <div className="support-msg-text">{m.text}</div>
                      <span className="support-msg-time">{formatTime(m.createdAt)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </React.Fragment>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="support-chat-input-wrap">
        <textarea
          className="support-chat-input"
          placeholder={currentTicket?.status === 'closed' ? 'Напишите — обращение откроется заново...' : 'Введите сообщение...'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKey}
          rows={1}
        />
        <button type="button" className="support-chat-send" onClick={sendMessage} disabled={!draft.trim() || sending}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
