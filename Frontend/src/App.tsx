import React, { Suspense, useState, useEffect } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
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
const LandingHome = React.lazy(() => import('./components/LandingHome.tsx'));
const About = React.lazy(() => import('./components/About.tsx'));
const Privacy = React.lazy(() => import('./components/Privacy.tsx'));
const PaymentTerms = React.lazy(() => import('./components/PaymentTerms.tsx'));
const TournamentRules = React.lazy(() => import('./components/TournamentRules.tsx'));
const BalanceRules = React.lazy(() => import('./components/BalanceRules.tsx'));
const Contacts = React.lazy(() => import('./components/Contacts.tsx'));

function getToken(): string {
  try {
    return localStorage.getItem('token') || '';
  } catch {
    return '';
  }
}

const SCROLL_RESTORE_KEY = 'app_scroll_restore';

function removeLoadingScreen() {
  const el = document.getElementById('loading-screen');
  if (!el) return;
  el.style.opacity = '0';
  setTimeout(() => { try { el.remove(); } catch (_) {} }, 180);
}

function AppContent() {
  const [token, setToken] = useState(getToken);
  const location = useLocation();
  const hasToken = !!token;

  useEffect(() => {
    const el = document.getElementById('loading-screen');
    if (!el) return;
    const root = document.getElementById('root');
    if (!root) { removeLoadingScreen(); return; }
    const observer = new MutationObserver(() => {
      if (document.querySelector('.cabinet-sidebar, .admin-panel, .app-main form, .app-main nav, .landing-header')) {
        observer.disconnect();
        removeLoadingScreen();
      }
    });
    observer.observe(root, { childList: true, subtree: true });
    const safety = setTimeout(() => { observer.disconnect(); removeLoadingScreen(); }, 3000);
    return () => { observer.disconnect(); clearTimeout(safety); };
  }, []);

  useEffect(() => {
    import('./components/Profile.tsx');
    import('./components/Admin.tsx');
    import('./components/SupportChat.tsx');
    import('./components/Offer.tsx');
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
      sessionStorage.removeItem(SCROLL_RESTORE_KEY);
      let attempts = 0;
      const maxAttempts = 20;
      const tryRestore = () => {
        window.scrollTo(x, y);
        if (Math.abs(window.scrollY - y) < 2 || attempts >= maxAttempts) return;
        attempts++;
        setTimeout(tryRestore, 100);
      };
      requestAnimationFrame(tryRestore);
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

  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return;
    if (hasToken) {
      root.style.background = '';
      document.body.style.background = '';
    }
  }, [hasToken]);

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

  const publicInfoPages = ['/', '/about', '/offer', '/privacy', '/payment-terms', '/tournament-rules', '/balance-rules', '/contacts', '/register'];
  const isPublicPage = !hasToken && publicInfoPages.includes(location.pathname);
  const hideTopNav = isProfile || isAdmin || isSupport || isRedirecting || isPublicPage;
  const noPadding = hideTopNav || isPublicPage;

  return (
    <ErrorBoundary>
      <div className={`App${hideTopNav ? ' app-loggedin' : ''}${isProfile ? ' cabinet-open' : ''}${isAdmin ? ' admin-open' : ''}`}>
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
        <main className="app-main" style={{ flex: 1, padding: noPadding ? 0 : '24px 16px' }}>
          <Suspense fallback={<div style={{ minHeight: '100vh' }} />}>
          <Routes>
            <Route path="/" element={hasToken ? <Navigate to="/profile" replace /> : <LandingHome onLogin={handleLogin} />} />
            <Route path="/login" element={<Navigate to={hasToken ? '/profile' : '/'} replace />} />
            <Route path="/register" element={<Navigate to="/?tab=register" replace />} />
            <Route path="/offer" element={<Offer />} />
            <Route path="/about" element={<About />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/payment-terms" element={<PaymentTerms />} />
            <Route path="/tournament-rules" element={<TournamentRules />} />
            <Route path="/balance-rules" element={<BalanceRules />} />
            <Route path="/contacts" element={<Contacts />} />
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
