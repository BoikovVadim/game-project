export const TOKEN_REFRESH_EVENT = 'token-refresh';
export const AUTH_SESSION_INVALID_EVENT = 'auth-session-invalid';
export const AUTH_RETURN_TO_STORAGE_KEY = 'auth_return_to';
export const ADMIN_TOKEN_STORAGE_KEY = 'adminToken';
export const ADMIN_RETURN_HASH_STORAGE_KEY = 'adminReturnHash';

export type AuthFailureReason = 'session-expired' | 'login-required';

export function getStoredToken(): string {
  try {
    return localStorage.getItem('token') || '';
  } catch {
    return '';
  }
}

export function setStoredToken(token: string): void {
  try {
    localStorage.setItem('token', token);
  } catch {
    // Ignore storage errors and keep the in-memory session alive.
  }
}

export function clearStoredToken(): void {
  try {
    localStorage.removeItem('token');
  } catch {
    // Ignore storage errors during logout/session reset.
  }
}

export function clearAllStoredSessions(): void {
  try {
    localStorage.removeItem('token');
    localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    localStorage.removeItem(ADMIN_RETURN_HASH_STORAGE_KEY);
    localStorage.removeItem(AUTH_RETURN_TO_STORAGE_KEY);
  } catch {
    // Ignore storage errors during a full logout.
  }
}

export function setAdminSession(adminToken: string, returnHash: string): void {
  try {
    localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, adminToken);
    localStorage.setItem(ADMIN_RETURN_HASH_STORAGE_KEY, returnHash);
  } catch {
    // Ignore storage errors and keep the in-memory session alive.
  }
}

export function getAdminToken(): string {
  try {
    return localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function getAdminReturnHash(): string | null {
  try {
    return localStorage.getItem(ADMIN_RETURN_HASH_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function clearAdminSession(): void {
  try {
    localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    localStorage.removeItem(ADMIN_RETURN_HASH_STORAGE_KEY);
  } catch {
    // Ignore storage errors during admin-session reset.
  }
}

export function isProtectedPath(pathname: string): boolean {
  return pathname === '/profile' || pathname === '/admin' || pathname === '/support';
}

export function buildReturnToPath(pathname: string, search: string): string {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${normalizedPath}${search || ''}`;
}

export function storePendingReturnTo(path: string): void {
  if (!path.startsWith('/')) return;
  try {
    localStorage.setItem(AUTH_RETURN_TO_STORAGE_KEY, path);
  } catch {
    // Ignore storage errors and fall back to the default redirect.
  }
}

export function consumePendingReturnTo(defaultPath = '/profile'): string {
  try {
    const stored = localStorage.getItem(AUTH_RETURN_TO_STORAGE_KEY) || '';
    localStorage.removeItem(AUTH_RETURN_TO_STORAGE_KEY);
    if (stored.startsWith('/')) {
      return stored;
    }
  } catch {
    // Ignore storage errors and fall back to the default redirect.
  }
  return defaultPath;
}
