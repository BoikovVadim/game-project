import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useSearchParams, Link } from 'react-router-dom';

const VerifyEmail: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('Неверная ссылка. Токен отсутствует.');
      return;
    }
    axios
      .get(`/auth/verify-email?token=${encodeURIComponent(token)}`)
      .then((res) => {
        if (res.data?.success === false) {
          setStatus('error');
          setMessage(res.data?.message ?? 'Ссылка недействительна или уже использована.');
          return;
        }
        setStatus('success');
        setMessage(res.data?.message ?? 'Почта подтверждена.');
      })
      .catch((err) => {
        setStatus('error');
        setMessage(err?.response?.data?.message ?? 'Ссылка недействительна или уже использована.');
      });
  }, [token]);

  return (
    <div style={{ padding: 24, maxWidth: 400, margin: '0 auto', textAlign: 'center' }}>
      <h2>Подтверждение почты</h2>
      {status === 'loading' && <p>Проверка ссылки…</p>}
      {status === 'success' && (
        <>
          <p style={{ color: '#0d8050' }}>{message}</p>
          <p>
            <Link to="/login">Войти в систему</Link>
          </p>
        </>
      )}
      {status === 'error' && (
        <>
          <p style={{ color: '#c00' }}>{message}</p>
          <p>
            <Link to="/register">Зарегистрироваться</Link> | <Link to="/login">Вход</Link>
          </p>
        </>
      )}
    </div>
  );
};

export default VerifyEmail;
