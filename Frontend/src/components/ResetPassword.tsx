import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';

const ResetPassword: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') ?? '';
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!token) setError('Неверная ссылка. Запросите восстановление пароля заново.');
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword !== confirmPassword) {
      setError('Пароли не совпадают');
      return;
    }
    if (newPassword.length < 6) {
      setError('Пароль должен быть не короче 6 символов');
      return;
    }
    try {
      await axios.post('/auth/reset-password', { token, newPassword });
      setSuccess(true);
      setTimeout(() => navigate('/login'), 2000);
    } catch (err: unknown) {
      const ax = err && typeof err === 'object' && 'isAxiosError' in err && (err as { isAxiosError?: boolean }).isAxiosError;
      const res = ax && err && typeof err === 'object' && 'response' in err ? (err as { response?: { data?: { message?: string } } }).response : undefined;
      setError(res?.data?.message || 'Ссылка недействительна или истекла. Запросите восстановление снова.');
    }
  };

  if (success) {
    return (
      <div>
        <h2>Пароль изменён</h2>
        <p>Пароль успешно изменён. Сейчас вы будете перенаправлены на страницу входа.</p>
        <p><Link to="/login">Войти</Link></p>
      </div>
    );
  }

  if (!token) {
    return (
      <div>
        <h2>Восстановление пароля</h2>
        <p style={{ color: '#c00' }}>{error}</p>
        <p><Link to="/forgot-password">Запросить ссылку снова</Link></p>
      </div>
    );
  }

  return (
    <div>
      <h2>Новый пароль</h2>
      <p>Введите новый пароль и подтвердите его.</p>
      <form onSubmit={handleSubmit}>
        <input
          type="password"
          placeholder="Новый пароль"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          minLength={6}
        />
        <input
          type="password"
          placeholder="Повторите пароль"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          minLength={6}
        />
        {error && <p style={{ color: '#c00', marginTop: 8 }}>{error}</p>}
        <button type="submit">Сохранить пароль</button>
      </form>
      <p style={{ marginTop: 12 }}>
        <Link to="/login">Вернуться к входу</Link>
      </p>
    </div>
  );
};

export default ResetPassword;
