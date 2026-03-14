import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';

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
  return parts.sort(() => Math.random() - 0.5).join('');
}

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

const eyeBtnStyle: React.CSSProperties = {
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
};

const Register: React.FC = () => {
  const [searchParams] = useSearchParams();
  const refFromUrl = searchParams.get('ref') ?? '';
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);
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
    if (password.length < 6) {
      setError('Пароль должен быть не менее 6 символов.');
      return;
    }
    if (password !== passwordConfirm) {
      setError('Пароли не совпадают');
      return;
    }
    const referralCode = parseReferralInput(referralInput) || undefined;
    try {
      const response = await axios.post<{ deliveryFailed?: boolean }>('/auth/register', { username, email, password, referralCode });
      const nextParams = new URLSearchParams();
      nextParams.set('email', email);
      if (response.data?.deliveryFailed) {
        nextParams.set('delivery', 'failed');
      }
      navigate(`/verify-code?${nextParams.toString()}`);
    } catch (err: any) {
      const msg = err?.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join('. ') : (msg || 'Не удалось зарегистрироваться'));
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
        <div style={{ position: 'relative', marginBottom: 10 }}>
          <input
            type={showPassword ? 'text' : 'password'}
            placeholder="Пароль (при клике предложится сложный пароль)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onFocus={handlePasswordFocus}
            required
            minLength={6}
            style={{ width: '100%', boxSizing: 'border-box', paddingRight: 40, marginBottom: 0 }}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            style={eyeBtnStyle}
            tabIndex={-1}
            aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
          >
            {showPassword ? <EyeClosed /> : <EyeOpen />}
          </button>
        </div>
        <div style={{ position: 'relative', marginBottom: 10 }}>
          <input
            type={showPasswordConfirm ? 'text' : 'password'}
            placeholder="Повторите пароль"
            value={passwordConfirm}
            onChange={(e) => setPasswordConfirm(e.target.value)}
            required
            style={{ width: '100%', boxSizing: 'border-box', paddingRight: 40, marginBottom: 0 }}
          />
          <button
            type="button"
            onClick={() => setShowPasswordConfirm((v) => !v)}
            style={eyeBtnStyle}
            tabIndex={-1}
            aria-label={showPasswordConfirm ? 'Скрыть пароль' : 'Показать пароль'}
          >
            {showPasswordConfirm ? <EyeClosed /> : <EyeOpen />}
          </button>
        </div>
        <input
          type="text"
          placeholder="Реферальная ссылка или код (необязательно)"
          value={referralInput}
          onChange={(e) => setReferralInput(e.target.value)}
        />
        <label style={{ display: 'flex', alignItems: 'baseline', margin: '5px 0', gap: '6px', fontSize: '12px' }}>
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={(e) => setAcceptedTerms(e.target.checked)}
            required
          />
          <span>Я ознакомлен и принимаю <Link to="/offer" target="_blank" style={{ color: '#1a73e8' }}>правила игры</Link> <span style={{ color: '#c00' }}>*</span></span>
        </label>
        <label style={{ display: 'flex', alignItems: 'baseline', margin: '5px 0', gap: '6px', fontSize: '12px' }}>
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
