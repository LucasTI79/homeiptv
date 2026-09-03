export interface User {
  id: number;
  username: string;
  isAdmin: boolean;
  canUseDvr: boolean;
  allowed_sources: string[] | null;
}

// Subset of User returned by /api/auth/status, /api/auth/login, /api/auth/setup-admin
// (session-derived, no allowed_sources).
export interface SessionUser {
  id: number;
  username: string;
  isAdmin: boolean;
  canUseDvr: boolean;
}

export type AuthStatus =
  | { isLoggedIn: true; user: SessionUser }
  | { isLoggedIn: false };

export interface HealthStatus {
  status: 'ok' | 'degraded';
  dbClient: string;
  appName?: string;
  timestamp: string;
}
