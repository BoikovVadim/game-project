import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';

/** Простая страница кабинета: показывается вместо тяжёлого Profile, чтобы не было белого экрана. */
const ProfilePlaceholder: React.FC<{ token: string; onLogout: () => void }> = ({ token, onLogout }) => {
  const [email, setEmail] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get('/users/profile', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        const data = res?.data;
        if (data && typeof data === 'object') setEmail(data.email || data.username || '');
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <div style={{ minHeight: '100vh', background: '#e8e8e8', padding: 24, boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 480, margin: '0 auto', background: '#fff', padding: 48, borderRadius: 12, boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}>
        <h1 style={{ margin: '0 0 24px', fontSize: 24, color: '#111' }}>Личный кабинет</h1>
        {loading ? (
          <p style={{ color: '#666', margin: '0 0 24px' }}>Загрузка…</p>
        ) : (
          <p style={{ margin: '0 0 24px', color: '#444' }}>{email || 'Вы вошли в аккаунт.'}</p>
        )}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link to="/" style={{ padding: '10px 20px', background: '#f0f0f0', color: '#333', borderRadius: 8, textDecoration: 'none', fontWeight: 600 }}>На главную</Link>
          <button type="button" onClick={onLogout} style={{ padding: '10px 20px', background: '#e8e8e8', color: '#333', border: '1px solid #ccc', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>Выйти</button>
        </div>
      </div>
    </div>
  );
};

export default ProfilePlaceholder;
