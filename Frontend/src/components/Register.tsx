import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';

/** Генерирует сложный пароль (буквы, цифры, символы) */
function generateStrongPassword(): string {
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const upper = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const digits = '23456789';
  const symbols = '!@#$%&*';
  const all = lower + upper + digits + symbols;
  const pick = (s: string, n: number) =>
    Array.from({ length: n }, () => s[Math.floor(Math.random() * s.length)]).join('');
  const parts = [
    pick(lower, 3),
    pick(upper, 2),
    pick(digits, 2),
    pick(symbols, 1),
    pick(all, 6),
  ];
  return parts
    .sort(() => Math.random() - 0.5)
    .join('');
}

/** Извлекает реферальный код из строки (ссылка или просто код) */
function parseReferralInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    if (trimmed.startsWith('http')) {
      const url = new URL(trimmed);
      return url.searchParams.get('ref') || trimmed;
    }
    return trimmed;
  } catch {
    return trimmed;
  }
}

const Register: React.FC = () => {
  const [searchParams] = useSearchParams();
  const refFromUrl = searchParams.get('ref') ?? '';
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [referralInput, setReferralInput] = useState(refFromUrl);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedAge, setAcceptedAge] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    if (refFromUrl) setReferralInput(refFromUrl);
  }, [refFromUrl]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!acceptedTerms) {
      setError('Вы должны принять правила игры.');
      return;
    }
    if (!acceptedAge) {
      setError('Подтвердите, что вам есть 18 лет.');
      return;
    }
    if (password !== passwordConfirm) {
      setError('Пароли не совпадают');
      return;
    }
    const referralCode = parseReferralInput(referralInput) || undefined;
    try {
      await axios.post('/auth/register', { username, email, password, referralCode });
      alert('Регистрация прошла успешно! На вашу почту отправлено письмо со ссылкой для подтверждения. Перейдите по ссылке, затем войдите в систему.');
      navigate('/login');
    } catch (err) {
      setError('Не удалось зарегистрироваться');
    }
  };

  const handlePasswordFocus = () => {
    if (!password) {
      const generated = generateStrongPassword();
      setPassword(generated);
      setPasswordConfirm(generated);
      setError('');
    }
  };

  return (
    <div style={{ textAlign: 'center' }}>
      <h2 style={{ marginBottom: 16 }}>Регистрация</h2>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Логин"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        <input
          type="email"
          placeholder="Электронная почта"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Пароль (при клике предложится сложный пароль)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onFocus={handlePasswordFocus}
          required
        />
        <input
          type="password"
          placeholder="Повторите пароль"
          value={passwordConfirm}
          onChange={(e) => setPasswordConfirm(e.target.value)}
          required
        />
        <input
          type="text"
          placeholder="Реферальная ссылка или код (необязательно)"
          value={referralInput}
          onChange={(e) => setReferralInput(e.target.value)}
        />
        <label style={{ display: 'flex', alignItems: 'baseline', margin: '5px 0', gap: '6px', fontSize: '12px', whiteSpace: 'nowrap' }}>
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={(e) => setAcceptedTerms(e.target.checked)}
            required
          />
          <span>Я ознакомлен и принимаю <Link to="/offer" target="_blank" style={{ color: '#1a73e8' }}>правила игры</Link> <span style={{ color: '#c00' }}>*</span></span>
        </label>
        <label style={{ display: 'flex', alignItems: 'baseline', margin: '5px 0', gap: '6px', fontSize: '12px', whiteSpace: 'nowrap' }}>
          <input
            type="checkbox"
            checked={acceptedAge}
            onChange={(e) => setAcceptedAge(e.target.checked)}
            required
          />
          Мне есть 18 лет <span style={{ color: '#c00' }}>*</span>
        </label>
        {error && <p style={{ color: 'red' }}>{error}</p>}
        <button type="submit">Зарегистрироваться</button>
      </form>
    </div>
  );
};

export default Register;