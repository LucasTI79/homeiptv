import { Router } from 'express';
import { db } from '../db/connection';
import { env } from '../config/env';
import type { HealthStatus } from '../types';

export const healthRouter = Router();

healthRouter.get('/health', async (_req, res) => {
  let dbOk = true;
  try {
    await db.raw('select 1');
  } catch (err) {
    dbOk = false;
  }

  const body: HealthStatus = {
    status: dbOk ? 'ok' : 'degraded',
    dbClient: env.dbClient,
    timestamp: new Date().toISOString(),
  };

  res.status(dbOk ? 200 : 503).json(body);
});
