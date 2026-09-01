export * from '@viniplay/shared-types';

export interface HealthStatus {
  status: 'ok' | 'degraded';
  dbClient: string;
  timestamp: string;
}
