import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
import VerifyEmail from './components/VerifyEmail.tsx';
import VerifyCode from './components/VerifyCode.tsx';
import ForgotPassword from './components/ForgotPassword.tsx';
import ResetPassword from './components/ResetPassword.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import {
  AUTH_SESSION_INVALID_EVENT,
  TOKEN_REFRESH_EVENT,
  buildReturnToPath,
  clearAllStoredSessions,
  clearStoredToken,
  consumePendingReturnTo,
  getStoredToken,
  isProtectedPath,
  setStoredToken,
  storePendingReturnTo,
  type AuthFailureReason,
} from './authSession.ts';
import { refreshAccessToken } from './api/authClient.ts';
import { preloadAllLeagueImages } from './preloadLeagueImages.ts';
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
const RewardRules = React.lazy(() => import('./components/RewardRules.tsx'));
const VerificationRules = React.lazy(() => import('./components/VerificationRules.tsx'));
const DisputesPolicy = React.lazy(() => import('./components/DisputesPolicy.tsx'));
const Contacts = React.lazy(() => import('./components/Contacts.tsx'));

const SCROLL_RESTORE_KEY = 'app_scroll_restore';

function removeLoadingScreen() {
  const el = document.getElementById('loading-screen');
  if (!el) return;
  el.style.opacity = '0';
  setTimeout(() => { try { el.remove(); } catch (_) {} }, 180);
}

function AppContent() {
  const navigate = useNavigate();
  const [token, setToken] = useState(getStoredToken);
  const [authBootstrapping, setAuthBootstrapping] = useState(() => !!getStoredToken());
  const location = useLocation();
  const bootstrapAttemptedRef = useRef(false);
  const hasToken = !!token;
  const isAuthenticated = hasToken && !authBootstrapping;

  const redirectToAuth = useCallback((reason: AuthFailureReason, preserveCurrentPath = true) => {
    if (preserveCurrentPath && isProtectedPath(location.pathname)) {
      const currentPath = buildReturnToPath(location.pathname, location.search);
      storePendingReturnTo(currentPath);
    }
    clearStoredToken();
    setToken('');
    setAuthBootstrapping(false);
    const nextParams = new URLSearchParams();
    nextParams.set('reason', reason);
    navigate(`/?${nextParams.toString()}`, { replace: true });
  }, [location.pathname, location.search, navigate]);

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
    if (bootstrapAttemptedRef.current) return;
    bootstrapAttemptedRef.current = true;
    const existingToken = getStoredToken();
    if (!existingToken) {
      setAuthBootstrapping(false);
      return;
    }
    let cancelled = false;
    refreshAccessToken(existingToken)
      .then((nextToken) => {
        if (cancelled) return;
        setToken(nextToken);
      })
      .catch(() => {
        if (cancelled) return;
        redirectToAuth('session-expired', isProtectedPath(location.pathname));
      })
      .finally(() => {
        if (!cancelled) {
          setAuthBootstrapping(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [location.pathname, redirectToAuth]);

  useEffect(() => {
    import('./components/Profile.tsx');
    import('./components/Admin.tsx');
    import('./components/SupportChat.tsx');
    import('./components/Offer.tsx');
    import('./components/RewardRules.tsx');
    import('./components/VerificationRules.tsx');
    import('./components/DisputesPolicy.tsx');
  }, []);

  // Предзагрузка картинок лиг сразу при входе под токеном (без ожидания чанков)
  useEffect(() => {
    if (hasToken) preloadAllLeagueImages();
  }, [hasToken]);

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
    const t = getStoredToken();
    if (t) setToken(t);
  }, []);

  useEffect(() => {
    const onRefresh = (e: Event) => setToken((e as CustomEvent<string>).detail);
    window.addEventListener(TOKEN_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(TOKEN_REFRESH_EVENT, onRefresh);
  }, []);

  useEffect(() => {
    const onSessionInvalid = (e: Event) => {
      const reason = (e as CustomEvent<{ reason?: AuthFailureReason }>).detail?.reason || 'session-expired';
      redirectToAuth(reason, true);
    };
    window.addEventListener(AUTH_SESSION_INVALID_EVENT, onSessionInvalid);
    return () => window.removeEventListener(AUTH_SESSION_INVALID_EVENT, onSessionInvalid);
  }, [redirectToAuth]);

  useEffect(() => {
    if (authBootstrapping || hasToken || !isProtectedPath(location.pathname)) return;
    storePendingReturnTo(buildReturnToPath(location.pathname, location.search));
  }, [authBootstrapping, hasToken, location.pathname, location.search]);

  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return;
    if (hasToken) {
      root.style.background = '';
      document.body.style.background = '';
    }
  }, [hasToken]);

  const handleLogin = useCallback((newToken: string) => {
    setStoredToken(newToken);
    setToken(newToken);
    setAuthBootstrapping(false);
    navigate(consumePendingReturnTo('/profile'), { replace: true });
  }, [navigate]);

  const handleLogout = useCallback(() => {
    clearAllStoredSessions();
    setToken('');
    setAuthBootstrapping(false);
    navigate('/', { replace: true });
  }, [navigate]);

  const isProfile = location.pathname === '/profile' && isAuthenticated;
  const isAdmin = location.pathname === '/admin' && isAuthenticated;
  const isSupport = location.pathname === '/support' && isAuthenticated;
  const isRedirecting = isAuthenticated && (location.pathname === '/' || location.pathname === '/login');

  const publicInfoPages = ['/', '/about', '/offer', '/privacy', '/payment-terms', '/tournament-rules', '/balance-rules', '/reward-rules', '/verification-rules', '/disputes-policy', '/contacts', '/register'];
  const isPublicPage = !hasToken && publicInfoPages.includes(location.pathname);
  const hideTopNav = isProfile || isAdmin || isSupport || isRedirecting || isPublicPage;
  const noPadding = hideTopNav || isPublicPage;

  const routeElement = useMemo(() => {
    if (authBootstrapping) {
      return <div style={{ minHeight: '100vh' }} />;
    }
    return (
      <Routes>
        <Route path="/" element={isAuthenticated ? <Navigate to="/profile" replace /> : <LandingHome onLogin={handleLogin} />} />
        <Route path="/login" element={<Navigate to={isAuthenticated ? '/profile' : '/'} replace />} />
        <Route path="/register" element={<Navigate to="/?tab=register" replace />} />
        <Route path="/offer" element={<Offer />} />
        <Route path="/about" element={<About />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/payment-terms" element={<PaymentTerms />} />
        <Route path="/tournament-rules" element={<TournamentRules />} />
        <Route path="/balance-rules" element={<BalanceRules />} />
        <Route path="/reward-rules" element={<RewardRules />} />
        <Route path="/verification-rules" element={<VerificationRules />} />
        <Route path="/disputes-policy" element={<DisputesPolicy />} />
        <Route path="/contacts" element={<Contacts />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/verify-code" element={<VerifyCode onLogin={handleLogin} />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/profile" element={isAuthenticated ? <ErrorBoundary><Profile token={token} onLogout={handleLogout} /></ErrorBoundary> : <Navigate to="/?reason=login-required" replace />} />
        <Route path="/support" element={isAuthenticated ? <SupportChat token={token} /> : <Navigate to="/?reason=login-required" replace />} />
        <Route path="/admin" element={isAuthenticated ? <Admin token={token} onLogout={handleLogout} /> : <Navigate to="/?reason=login-required" replace />} />
        <Route path="*" element={<Navigate to={isAuthenticated ? '/profile' : '/'} replace />} />
      </Routes>
    );
  }, [authBootstrapping, handleLogin, handleLogout, isAuthenticated, token]);

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
            {routeElement}
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
