import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import axios from 'axios';
import App from './App.tsx';
import { AUTH_SESSION_INVALID_EVENT, TOKEN_REFRESH_EVENT } from './authSession.ts';

/** Локальный ErrorBoundary без зависимостей от Router — только ссылки по hash */
class RootErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  state = { hasError: false, error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('RootErrorBoundary:', error, info);
  }

  render() {
    if (this.state.hasError) {
      try { document.getElementById('loading-screen')?.remove(); } catch (_) {}
      return (
        <div style={{ padding: 24, textAlign: 'center', maxWidth: 480, margin: '40px auto', background: '#f9f9f9', border: '1px solid #ddd', borderRadius: 8 }}>
          <p style={{ color: '#c00', marginBottom: 16, fontWeight: 600 }}>Ошибка загрузки</p>
          <p style={{ fontSize: 12, color: '#666', marginBottom: 20 }}>{this.state.error?.message}</p>
          <a href="#/login" style={{ color: '#1565c0', marginRight: 12 }}>Вход</a>
          <a href="#/" style={{ color: '#1565c0' }}>На главную</a>
        </div>
      );
    }
    return this.props.children;
  }
}

// Сессия: обновление токена при активности (дебаунс — не чаще раза в 5 минут)
function setupAxiosInterceptor() {
  let lastRefresh = 0;
  let lastSessionInvalid = 0;
  const REFRESH_INTERVAL = 5 * 60 * 1000;
  const SESSION_INVALID_DEBOUNCE_MS = 1500;
  try {
    axios.interceptors.response.use(
      (response) => {
        try {
          const url = String(response.config?.url || '');
          const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
          const now = Date.now();
          if (token && now - lastRefresh > REFRESH_INTERVAL && !url.includes('auth/login') && !url.includes('auth/register') && !url.includes('auth/refresh') && !url.includes('withdrawal-request')) {
            lastRefresh = now;
            axios.get('/auth/refresh', { headers: { Authorization: `Bearer ${token}` } })
              .then((r) => {
                try {
                  const newToken = r.data?.access_token;
                  if (newToken && typeof localStorage !== 'undefined') {
                    localStorage.setItem('token', newToken);
                    window.dispatchEvent(new CustomEvent(TOKEN_REFRESH_EVENT, { detail: newToken }));
                  }
                } catch (_) {}
              })
              .catch(() => {});
          }
        } catch (_) {}
        return response;
      },
      (error) => {
        try {
          const status = error?.response?.status;
          const url = String(error?.config?.url || '');
          const authHeader = error?.config?.headers?.Authorization || error?.config?.headers?.authorization;
          const now = Date.now();
          const isAuthFlow =
            url.includes('auth/login') ||
            url.includes('auth/register') ||
            url.includes('auth/verify-code') ||
            url.includes('auth/resend-code') ||
            url.includes('auth/verify-email');
          if (status === 401 && authHeader && !isAuthFlow && now - lastSessionInvalid > SESSION_INVALID_DEBOUNCE_MS) {
            lastSessionInvalid = now;
            window.dispatchEvent(new CustomEvent(AUTH_SESSION_INVALID_EVENT, {
              detail: { reason: 'session-expired' },
            }));
          }
        } catch (_) {}
        return Promise.reject(error);
      },
    );
  } catch (_) {}
}

const rootEl = document.getElementById('root');
if (!rootEl) {
  document.body.innerHTML = '<p style="padding:24px;color:#c00;">Не найден #root. Обновите страницу.</p>';
} else {
  setupAxiosInterceptor();
  try {
    ReactDOM.createRoot(rootEl).render(
      <RootErrorBoundary>
        <App />
      </RootErrorBoundary>,
    );
  } catch (err) {
    rootEl.innerHTML = '<p style="padding:24px;color:#c00;">Ошибка запуска. Обновите страницу.</p>';
    console.error('React mount error:', err);
  }
}
