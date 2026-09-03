import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { z } from 'zod';

// Single source of truth for the dev-vs-built-output path offset -- paths.ts
// imports resolveFromRepoRoot instead of recomputing this itself, so the two
// files can't drift out of sync.
const isDist = __dirname.includes(`${path.sep}dist${path.sep}`);
const rootOffset = isDist ? '../../../../' : '../../../';
export function resolveFromRepoRoot(...segments: string[]): string {
  return path.resolve(__dirname, rootOffset, ...segments);
}

const defaultDataDir = resolveFromRepoRoot('data');
const defaultDvrDir = resolveFromRepoRoot('dvr');

const envSchema = z.object({
  PORT: z.coerce.number().default(8999),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DB_CLIENT: z.enum(['better-sqlite3', 'mysql2', 'pg']).default('better-sqlite3'),
  DB_CONNECTION: z.string().optional(),
  DATA_DIR: z.string().default(defaultDataDir),
  DVR_DIR: z.string().default(defaultDvrDir),
  SESSION_SECRET: z.string().optional(),
  APP_NAME: z.string().default('HomeIPTV'),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('[CONFIG_ERROR] Invalid environment variables:', parsedEnv.error.format());
  process.exit(1);
}

const envVars = parsedEnv.data;
fs.mkdirSync(envVars.DATA_DIR, { recursive: true });
fs.mkdirSync(envVars.DVR_DIR, { recursive: true });

const sessionSecretPath = path.join(envVars.DATA_DIR, 'session-secret.txt');

function resolveSessionSecret(): string {
  if (envVars.SESSION_SECRET) return envVars.SESSION_SECRET;
  if (fs.existsSync(sessionSecretPath)) return fs.readFileSync(sessionSecretPath, 'utf-8').trim();

  console.log('[SECURITY] No SESSION_SECRET set. Generating and persisting a new one.');
  const secret = crypto.randomBytes(64).toString('hex');
  fs.mkdirSync(envVars.DATA_DIR, { recursive: true });
  fs.writeFileSync(sessionSecretPath, secret);
  return secret;
}

export const env = {
  port: envVars.PORT,
  nodeEnv: envVars.NODE_ENV,
  dbClient: envVars.DB_CLIENT,
  dbConnection: envVars.DB_CONNECTION,
  dataDir: envVars.DATA_DIR,
  dvrDir: envVars.DVR_DIR,
  sessionSecret: resolveSessionSecret(),
  appName: envVars.APP_NAME,
};
