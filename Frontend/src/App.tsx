import React, { useState, useEffect, useLayoutEffect } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import Register from './components/Register.tsx';
import Login from './components/Login.tsx';
import Home from './components/Home.tsx';
import Profile from './components/Profile.tsx';
import VerifyEmail from './components/VerifyEmail.tsx';
import ForgotPassword from './components/ForgotPassword.tsx';
import ResetPassword from './components/ResetPassword.tsx';
import Admin from './components/Admin.tsx';
import SupportChat from './components/SupportChat.tsx';
import Offer from './components/Offer.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './App.css';

function getToken(): string {
  try {
    return localStorage.getItem('token') || '';
  } catch {
    return '';
  }
}

const SCROLL_RESTORE_KEY = 'app_scroll_restore';

function AppContent() {
  const [token, setToken] = useState(getToken);
  const location = useLocation();
  const hasToken = !!token;

  useLayoutEffect(() => {
    const el = document.getElementById('loading-screen');
    if (el && el.parentNode) el.remove();
  }, []);

  useEffect(() => {
    const saveScroll = () => {
      try {
        const path = window.location.hash || '#/';
        sessionStorage.setItem(SCROLL_RESTORE_KEY, JSON.stringify({
          x: window.scrollX,
          y: window.scrollY,
          path,
        }));
      } catch (_e) {}
    };
    window.addEventListener('beforeunload', saveScroll);
    window.addEventListener('pagehide', saveScroll);
    return () => {
      window.removeEventListener('beforeunload', saveScroll);
      window.removeEventListener('pagehide', saveScroll);
    };
  }, []);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SCROLL_RESTORE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as { x?: number; y?: number; path?: string };
      const currentPath = window.location.hash || '#/';
      if (data.path !== currentPath) return;
      const x = Number(data.x);
      const y = Number(data.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const apply = () => window.scrollTo(x, y);
      apply();
      requestAnimationFrame(() => requestAnimationFrame(apply));
      const t1 = setTimeout(apply, 100);
      const t2 = setTimeout(apply, 300);
      const t3 = setTimeout(() => {
        apply();
        sessionStorage.removeItem(SCROLL_RESTORE_KEY);
      }, 600);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    } catch (_e) {}
  }, [location.pathname, location.search]);

  useEffect(() => {
    const t = getToken();
    if (t) setToken(t);
  }, []);

  useEffect(() => {
    const onRefresh = (e: Event) => setToken((e as CustomEvent<string>).detail);
    window.addEventListener('token-refresh', onRefresh);
    return () => window.removeEventListener('token-refresh', onRefresh);
  }, []);

  const handleLogin = (newToken: string) => {
    localStorage.setItem('token', newToken);
    setToken(newToken);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('adminToken');
    setToken('');
    window.location.hash = '#/';
  };

  const isProfile = location.pathname === '/profile' && hasToken;
  const isAdmin = location.pathname === '/admin' && hasToken;
  const isSupport = location.pathname === '/support' && hasToken;
  const isRedirecting = hasToken && (location.pathname === '/' || location.pathname === '/login');
  const hideTopNav = isProfile || isAdmin || isSupport || isRedirecting;
  return (
    <ErrorBoundary>
      <div className={`App${isProfile ? ' cabinet-open' : ''}${isAdmin ? ' admin-open' : ''}`}>
        {!hideTopNav && (
          <nav style={{
            padding: '14px 24px',
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            width: '100%',
            boxSizing: 'border-box',
            background: '#f0f0f0',
            borderBottom: '1px solid #ddd',
            minHeight: 48,
          }}>
            <Link to="/" style={{ color: '#111', textDecoration: 'none', fontWeight: 600, fontSize: 16 }}>Вход</Link>
            <span style={{ margin: '0 10px', color: '#666', fontSize: 16 }}>/</span>
            <Link to="/register" style={{ color: '#111', textDecoration: 'none', fontWeight: 600, fontSize: 16 }}>Регистрация</Link>
          </nav>
        )}
        <main className="app-main" style={{ flex: 1, padding: hideTopNav ? 0 : 24 }}>
          <Routes>
            <Route path="/" element={hasToken ? <Navigate to="/profile" replace /> : <Login onLogin={handleLogin} />} />
            <Route path="/login" element={<Navigate to={hasToken ? '/profile' : '/'} replace />} />
            <Route path="/register" element={<Register />} />
            <Route path="/offer" element={<Offer />} />
            <Route path="/verify-email" element={<VerifyEmail />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/profile" element={hasToken ? <ErrorBoundary><Profile token={token} onLogout={handleLogout} /></ErrorBoundary> : <Navigate to="/" replace />} />
            <Route path="/support" element={hasToken ? <SupportChat token={token} /> : <Navigate to="/" replace />} />
            <Route path="/admin" element={hasToken ? <Admin token={token} onLogout={handleLogout} /> : <Navigate to="/login" replace />} />
            <Route path="*" element={<Navigate to={hasToken ? '/profile' : '/'} replace />} />
          </Routes>
        </main>
      </div>
    </ErrorBoundary>
  );
}

function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}

export default App;
