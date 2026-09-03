export * from '@homeiptv/shared-types';

export interface HealthStatus {
  status: 'ok' | 'degraded';
  dbClient: string;
  appName?: string;
  timestamp: string;
}
