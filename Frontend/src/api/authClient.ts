import axios from 'axios';
import {
  TOKEN_REFRESH_EVENT,
  clearAdminSession,
  getAdminToken,
  getAdminReturnHash,
  setAdminSession,
  setStoredToken,
} from '../authSession.ts';

export async function refreshAccessToken(token: string): Promise<string> {
  const response = await axios.get<{ access_token?: string }>('/auth/refresh', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const nextToken = response.data?.access_token || token;
  if (nextToken) {
    setStoredToken(nextToken);
    window.dispatchEvent(new CustomEvent(TOKEN_REFRESH_EVENT, { detail: nextToken }));
  }
  return nextToken;
}

export function setAdminImpersonationSession(adminToken: string, newToken: string, adminReturnHash: string): void {
  setAdminSession(adminToken, adminReturnHash);
  setStoredToken(newToken);
  window.dispatchEvent(new CustomEvent(TOKEN_REFRESH_EVENT, { detail: newToken }));
}

export function restoreAdminSession(): { token: string; returnHash: string | null } | null {
  const adminToken = getAdminToken();
  if (!adminToken) return null;
  const adminReturnHash = getAdminReturnHash();
  clearAdminSession();
  setStoredToken(adminToken);
  window.dispatchEvent(new CustomEvent(TOKEN_REFRESH_EVENT, { detail: adminToken }));
  return { token: adminToken, returnHash: adminReturnHash };
}
