import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import './SupportChat.css';

interface Message {
  id: number;
  senderRole: 'user' | 'admin';
  text: string;
  createdAt: string;
}

export default function SupportChat({ token }: { token: string }) {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const headers = { Authorization: `Bearer ${token}` };

  const fetchMessages = useCallback(() => {
    axios.get<Message[]>('/support/messages', { headers })
      .then((r) => setMessages(r.data))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    fetchMessages();
    const iv = setInterval(fetchMessages, 4000);
    return () => clearInterval(iv);
  }, [fetchMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await axios.post('/support/messages', { text }, { headers });
      setDraft('');
      fetchMessages();
    } catch (_) {}
    setSending(false);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="support-chat-page">
      <header className="support-chat-header">
        <button type="button" className="support-chat-back" onClick={() => navigate('/profile')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Назад
        </button>
        <h1 className="support-chat-title">Тех. поддержка</h1>
      </header>

      <div className="support-chat-messages">
        {messages.length === 0 && (
          <div className="support-chat-empty">Напишите нам — мы поможем!</div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`support-msg ${m.senderRole === 'user' ? 'support-msg--user' : 'support-msg--admin'}`}>
            <div className="support-msg-bubble">
              <div className="support-msg-text">{m.text}</div>
              <div className="support-msg-time">{formatTime(m.createdAt)}</div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="support-chat-input-wrap">
        <textarea
          className="support-chat-input"
          placeholder="Введите сообщение..."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKey}
          rows={1}
        />
        <button type="button" className="support-chat-send" onClick={send} disabled={!draft.trim() || sending}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
