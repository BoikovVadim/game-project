export interface ImpersonationAuditScope {
  active: true;
  actorId: number;
  actorUsername: string;
  targetUserId: number;
  targetUsername: string;
  startedAt: string;
}

export interface AuthJwtPayload {
  sub: number;
  username?: string;
  impersonation?: ImpersonationAuditScope;
}

export interface AuthenticatedRequestUser {
  id: number;
  username: string;
  isAdmin: boolean;
  isImpersonating: boolean;
  impersonation: ImpersonationAuditScope | null;
}
