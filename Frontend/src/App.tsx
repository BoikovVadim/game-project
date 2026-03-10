import React, { Suspense, useState, useEffect } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import Register from './components/Register.tsx';
import Login from './components/Login.tsx';
import VerifyEmail from './components/VerifyEmail.tsx';
import VerifyCode from './components/VerifyCode.tsx';
import ForgotPassword from './components/ForgotPassword.tsx';
import ResetPassword from './components/ResetPassword.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './App.css';

const Profile = React.lazy(() => import('./components/Profile.tsx'));
const Admin = React.lazy(() => import('./components/Admin.tsx'));
const SupportChat = React.lazy(() => import('./components/SupportChat.tsx'));
const Offer = React.lazy(() => import('./components/Offer.tsx'));

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

  useEffect(() => {
    const el = document.getElementById('loading-screen');
    if (!el) return;
    let rafId: number;
    const check = () => {
      const ready = document.querySelector('.cabinet-sidebar, .admin-panel, .app-main form, .app-main nav');
      if (ready) {
        el.style.opacity = '0';
        setTimeout(() => { try { el.remove(); } catch (_) {} }, 160);
        return;
      }
      rafId = requestAnimationFrame(check);
    };
    rafId = requestAnimationFrame(check);
    const safety = setTimeout(() => {
      cancelAnimationFrame(rafId);
      el.style.opacity = '0';
      setTimeout(() => { try { el.remove(); } catch (_) {} }, 160);
    }, 3000);
    return () => { cancelAnimationFrame(rafId); clearTimeout(safety); };
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
      requestAnimationFrame(() => {
        apply();
        sessionStorage.removeItem(SCROLL_RESTORE_KEY);
      });
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
            padding: '14px 16px',
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
        <main className="app-main" style={{ flex: 1, padding: hideTopNav ? 0 : '24px 16px' }}>
          <Suspense fallback={
            isProfile ? (
              <div style={{ display: 'flex', minHeight: '100vh' }}>
                <div style={{ width: 70, background: '#000', flexShrink: 0 }} />
                <div style={{ flex: 1 }} />
              </div>
            ) : (
              <div style={{ minHeight: 200 }} />
            )
          }>
          <Routes>
            <Route path="/" element={hasToken ? <Navigate to="/profile" replace /> : <Login onLogin={handleLogin} />} />
            <Route path="/login" element={<Navigate to={hasToken ? '/profile' : '/'} replace />} />
            <Route path="/register" element={<Register />} />
            <Route path="/offer" element={<Offer />} />
            <Route path="/verify-email" element={<VerifyEmail />} />
            <Route path="/verify-code" element={<VerifyCode onLogin={handleLogin} />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/profile" element={hasToken ? <ErrorBoundary><Profile token={token} onLogout={handleLogout} /></ErrorBoundary> : <Navigate to="/" replace />} />
            <Route path="/support" element={hasToken ? <SupportChat token={token} /> : <Navigate to="/" replace />} />
            <Route path="/admin" element={hasToken ? <Admin token={token} onLogout={handleLogout} /> : <Navigate to="/login" replace />} />
            <Route path="*" element={<Navigate to={hasToken ? '/profile' : '/'} replace />} />
          </Routes>
          </Suspense>
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
