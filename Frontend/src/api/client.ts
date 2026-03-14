export function withBearerToken(token: string) {
  return { headers: { Authorization: `Bearer ${token}` } as const };
}
