import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';

const CODE_LENGTH = 6;

interface VerifyCodeProps {
  onLogin: (token: string) => void;
}

const VerifyCode: React.FC<VerifyCodeProps> = ({ onLogin }) => {
  const [searchParams] = useSearchParams();
  const emailFromUrl = searchParams.get('email') ?? '';
  const navigate = useNavigate();

  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(''));
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    inputsRef.current[0]?.focus();
  }, []);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const handleChange = (idx: number, value: string) => {
    const char = value.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[idx] = char;
    setDigits(next);
    setMessage('');
    setStatus('idle');
    if (char && idx < CODE_LENGTH - 1) {
      inputsRef.current[idx + 1]?.focus();
    }
  };

  const handleKeyDown = (idx: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !digits[idx] && idx > 0) {
      inputsRef.current[idx - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, CODE_LENGTH);
    if (!pasted) return;
    e.preventDefault();
    const next = [...digits];
    for (let i = 0; i < CODE_LENGTH; i++) next[i] = pasted[i] || '';
    setDigits(next);
    inputsRef.current[Math.min(pasted.length, CODE_LENGTH - 1)]?.focus();
  };

  const code = digits.join('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length < CODE_LENGTH) {
      setStatus('error');
      setMessage('Введите все 6 цифр');
      return;
    }
    setStatus('loading');
    try {
      const res = await axios.post('/auth/verify-code', { email: emailFromUrl, code });
      if (res.data?.success) {
        const token = res.data.access_token;
        if (token) {
          setStatus('success');
          setMessage('Почта подтверждена! Переходим в кабинет…');
          onLogin(token);
          setTimeout(() => navigate('/profile'), 800);
        } else {
          setStatus('success');
          setMessage(res.data.message || 'Почта подтверждена!');
        }
      } else {
        setStatus('error');
        setMessage(res.data?.message || 'Неверный код');
      }
    } catch (err: any) {
      setStatus('error');
      setMessage(err?.response?.data?.message || 'Ошибка проверки кода');
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    try {
      await axios.post('/auth/resend-code', { email: emailFromUrl });
      setResendCooldown(60);
      setMessage('Новый код отправлен!');
      setStatus('idle');
      setDigits(Array(CODE_LENGTH).fill(''));
      inputsRef.current[0]?.focus();
    } catch {
      setMessage('Не удалось отправить код. Попробуйте позже.');
      setStatus('error');
    }
  };

  return (
    <div style={{ textAlign: 'center', maxWidth: 360, margin: '0 auto', padding: '0 16px' }}>
      <h2 style={{ marginBottom: 6 }}>Почти готово!</h2>

      <p style={{ fontSize: 14, color: '#555', lineHeight: 1.5, marginBottom: 4 }}>
        На почту <strong style={{ color: '#222' }}>{emailFromUrl || '—'}</strong> отправлен
        {' '}<strong>6-значный код</strong>.
      </p>
      <p style={{ fontSize: 13, color: '#999', marginTop: 0, marginBottom: 20 }}>
        Введите его ниже — после этого вы сразу попадёте в кабинет.
      </p>

      {status === 'success' ? (
        <div style={{
          background: '#f0faf0',
          border: '1px solid #b7e4c7',
          borderRadius: 8,
          padding: '16px 12px',
          marginBottom: 12,
        }}>
          <p style={{ margin: 0, color: '#1a7a3a', fontSize: 15, fontWeight: 600 }}>{message}</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ maxWidth: 'none' }}>
          <div
            style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 14 }}
            onPaste={handlePaste}
          >
            {digits.map((d, i) => (
              <input
                key={i}
                ref={(el) => { inputsRef.current[i] = el; }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={d}
                onChange={(e) => handleChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                autoComplete="one-time-code"
                style={{
                  width: 44,
                  height: 50,
                  fontSize: 22,
                  fontWeight: 700,
                  textAlign: 'center',
                  border: status === 'error' ? '2px solid #c00' : '1px solid #ddd',
                  borderRadius: 8,
                  marginBottom: 0,
                  padding: 0,
                  caretColor: 'var(--gold-rich)',
                }}
              />
            ))}
          </div>

          {message && status === 'error' && (
            <p style={{ color: '#c00', fontSize: 13, margin: '0 0 10px' }}>{message}</p>
          )}
          {message && status === 'idle' && (
            <p style={{ color: '#1a7a3a', fontSize: 13, margin: '0 0 10px' }}>{message}</p>
          )}

          <button
            type="submit"
            disabled={status === 'loading'}
            style={{
              width: '100%',
              opacity: status === 'loading' ? 0.7 : 1,
              cursor: status === 'loading' ? 'not-allowed' : 'pointer',
            }}
          >
            {status === 'loading' ? 'Проверка…' : 'Подтвердить'}
          </button>

          <p style={{ marginTop: 14, fontSize: 13, color: '#888' }}>
            Не получили код? Проверьте «Спам».{' '}
            {resendCooldown > 0 ? (
              <span style={{ color: '#aaa' }}>Повторить через {resendCooldown} сек</span>
            ) : (
              <button
                type="button"
                onClick={handleResend}
                style={{
                  background: 'none',
                  border: 'none',
                  boxShadow: 'none',
                  color: 'var(--gold-dark)',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  fontSize: 13,
                  padding: 0,
                  fontWeight: 500,
                }}
              >
                Отправить повторно
              </button>
            )}
          </p>

          <p style={{ marginTop: 10, fontSize: 13 }}>
            <Link to="/register">Назад к регистрации</Link>
            {' | '}
            <Link to="/">Вход</Link>
          </p>
        </form>
      )}
    </div>
  );
};

export default VerifyCode;
