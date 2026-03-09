import React from 'react';
import { Link } from 'react-router-dom';

/** Главная страница: приветствие и ссылки на Вход и Регистрацию. */
const Home: React.FC = () => (
  <div style={{ padding: '48px 24px', textAlign: 'center', minHeight: '50vh', background: '#e8e8e8', borderRadius: 12, margin: 24, boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
    <h1 style={{ margin: '0 0 12px', fontSize: 32, color: '#111' }}>Главная</h1>
    <p style={{ margin: '0 0 32px', fontSize: 18, color: '#333', maxWidth: 480, marginLeft: 'auto', marginRight: 'auto' }}>
      Добро пожаловать. Войдите в аккаунт или зарегистрируйтесь.
    </p>
    <div style={{ display: 'flex', gap: 20, justifyContent: 'center', flexWrap: 'wrap' }}>
      <Link
        to="/login"
        className="gold-bg"
        style={{ padding: '14px 28px', borderRadius: 8, textDecoration: 'none', color: '#fff', fontWeight: 600, fontSize: 16 }}
      >
        Вход
      </Link>
      <Link
        to="/register"
        style={{ padding: '14px 28px', borderRadius: 8, textDecoration: 'none', color: '#1565c0', border: '2px solid #1565c0', fontWeight: 600, fontSize: 16 }}
      >
        Регистрация
      </Link>
    </div>
  </div>
);

export default Home;
