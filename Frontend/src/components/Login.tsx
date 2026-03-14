import React, { useState } from 'react';
import axios from 'axios';
import { Link, useSearchParams } from 'react-router-dom';

interface LoginProps {
  onLogin: (token: string) => void;
}

const EyeOpen = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
);

const EyeClosed = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
);

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [searchParams] = useSearchParams();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const authNotice = searchParams.get('reason') === 'session-expired'
    ? 'Сессия истекла. Войдите снова.'
    : searchParams.get('reason') === 'login-required'
      ? 'Войдите, чтобы открыть личный кабинет.'
      : '';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const response = await axios.post<{ access_token?: string }>('/auth/login', { identifier: login, password });
      const token = response.data?.access_token;
      if (!token) {
        setError('Сервер не вернул токен. Попробуйте ещё раз.');
        return;
      }
      onLogin(token);
    } catch (err: unknown) {
      const ax = err && typeof err === 'object' && 'isAxiosError' in err && (err as { isAxiosError?: boolean }).isAxiosError;
      const res = ax && err && typeof err === 'object' && 'response' in err ? (err as { response?: { status?: number; data?: { message?: string; error?: string; email?: string } } }).response : undefined;
      const status = res?.status;
      const backendMessage = res?.data?.message;
      const backendError = res?.data?.error;
      const msg = ax && err && typeof err === 'object' && 'message' in err ? (err as { message?: string }).message : '';
      if (status === 401) {
        if (backendMessage === 'EMAIL_NOT_VERIFIED') {
          const userEmail = res?.data?.email || login;
          window.location.hash = `#/verify-code?email=${encodeURIComponent(userEmail)}`;
          return;
        }
        const text = backendMessage && typeof backendMessage === 'string' && backendMessage !== 'Invalid credentials' ? backendMessage : 'Неверный логин/email или пароль.';
        setError(text);
      }
      else if (status === 500) setError(backendMessage || backendError ? `Ошибка сервера: ${backendMessage || backendError}` : 'Ошибка сервера. Убедитесь, что бэкенд запущен (npm run dev).');
      else if (msg === 'Network Error' || !status) setError('Не удалось подключиться к серверу. Запустите проект: npm run dev.');
      else setError('Не удалось войти. Попробуйте ещё раз.');
    }
  };

  return (
    <div style={{ textAlign: 'center' }}>
      <h2 style={{ marginBottom: 16 }}>Вход</h2>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Логин или электронная почта"
          value={login}
          onChange={(e) => setLogin(e.target.value)}
          required
        />
        <div style={{ position: 'relative', marginBottom: 10 }}>
          <input
            type={showPassword ? 'text' : 'password'}
            placeholder="Пароль"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ width: '100%', boxSizing: 'border-box', paddingRight: 40, marginBottom: 0 }}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            style={{
              position: 'absolute',
              right: 8,
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 4,
              color: '#999',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: 'none',
            }}
            tabIndex={-1}
            aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
          >
            {showPassword ? <EyeClosed /> : <EyeOpen />}
          </button>
        </div>
        <p style={{ margin: '8px 0 0', fontSize: 14, textAlign: 'center' }}>
          Забыли пароль? <Link to="/forgot-password">Восстановить</Link>
        </p>
        {!error && authNotice && (
          <div style={{
            background: '#fff7e8',
            border: '1px solid #f0c36d',
            borderRadius: 8,
            color: '#8a5a00',
            padding: '10px 16px',
            marginTop: 12,
            fontSize: 15,
            textAlign: 'center',
            lineHeight: 1.4,
          }}>
            {authNotice}
          </div>
        )}
        {error && (
          <div style={{
            background: '#fff0f0',
            border: '1px solid #e88',
            borderRadius: 8,
            color: '#c00',
            padding: '10px 16px',
            marginTop: 12,
            fontSize: 15,
            textAlign: 'center',
            lineHeight: 1.4,
          }}>
            {error}
          </div>
        )}
        <button type="submit">Войти</button>
      </form>
    </div>
  );
};

export default Login;
