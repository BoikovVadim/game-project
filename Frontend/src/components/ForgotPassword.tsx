import React, { useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';

const ForgotPassword: React.FC = () => {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await axios.post('/auth/forgot-password', { email: email.trim() });
      setSent(true);
    } catch (err) {
      setError('Не удалось отправить запрос. Попробуйте позже.');
    }
  };

  if (sent) {
    return (
      <div>
        <h2>Восстановление пароля</h2>
        <p>Если аккаунт с такой почтой существует, на неё отправлена инструкция. Проверьте почту и перейдите по ссылке из письма.</p>
        <p><Link to="/login">Вернуться к входу</Link></p>
      </div>
    );
  }

  return (
    <div>
      <h2>Восстановление пароля</h2>
      <p>Укажите почту, на которую зарегистрирован аккаунт. Мы отправим ссылку для сброса пароля.</p>
      <form onSubmit={handleSubmit}>
        <input
          type="email"
          placeholder="Электронная почта"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        {error && <p style={{ color: '#c00', marginTop: 8 }}>{error}</p>}
        <button type="submit">Отправить инструкцию</button>
      </form>
      <p style={{ marginTop: 12 }}>
        <Link to="/login">Вернуться к входу</Link>
      </p>
    </div>
  );
};

export default ForgotPassword;
