import React, { useState } from 'react';
import axios from 'axios';
import { Link, useNavigate } from 'react-router-dom';

interface LoginProps {
  onLogin: (token: string) => void;
}

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const response = await axios.post<{ access_token?: string }>('/auth/login', { email, password });
      const token = response.data?.access_token;
      if (!token) {
        setError('Сервер не вернул токен. Попробуйте ещё раз.');
        return;
      }
      onLogin(token);
      localStorage.setItem('token', token);
      navigate('/profile');
    } catch (err: unknown) {
      const ax = err && typeof err === 'object' && 'isAxiosError' in err && (err as { isAxiosError?: boolean }).isAxiosError;
      const res = ax && err && typeof err === 'object' && 'response' in err ? (err as { response?: { status?: number; data?: { message?: string; error?: string } } }).response : undefined;
      const status = res?.status;
      const backendMessage = res?.data?.message;
      const backendError = res?.data?.error;
      const msg = ax && err && typeof err === 'object' && 'message' in err ? (err as { message?: string }).message : '';
      if (status === 401) {
        const text = backendMessage && typeof backendMessage === 'string' && backendMessage !== 'Invalid credentials' ? backendMessage : 'Неверный email или пароль.';
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
          type="email"
          placeholder="Электронная почта"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Пароль"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <p style={{ margin: '8px 0 0', fontSize: 14, textAlign: 'center' }}>
          Забыли пароль? <Link to="/forgot-password">Восстановить</Link>
        </p>
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