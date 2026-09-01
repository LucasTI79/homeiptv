import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const dataDir = process.env.DATA_DIR || path.resolve(__dirname, '../../../viniplay-data');
const dvrDir = process.env.DVR_DIR || path.resolve(__dirname, '../../../viniplay-dvr');
const sessionSecretPath = path.join(dataDir, 'session-secret.txt');

// Mirrors server.js's behavior: use SESSION_SECRET from env if set, otherwise
// persist a generated one so it survives restarts (own file instead of the
// old settings.json, since the settings domain isn't ported yet).
function resolveSessionSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (fs.existsSync(sessionSecretPath)) return fs.readFileSync(sessionSecretPath, 'utf-8').trim();

  console.log('[SECURITY] No SESSION_SECRET set. Generating and persisting a new one.');
  const secret = crypto.randomBytes(64).toString('hex');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(sessionSecretPath, secret);
  return secret;
}

export const env = {
  port: Number(process.env.PORT) || 8999,
  nodeEnv: process.env.NODE_ENV || 'development',
  dbClient: process.env.DB_CLIENT || 'better-sqlite3',
  dataDir,
  dvrDir,
  sessionSecret: resolveSessionSecret(),
};
