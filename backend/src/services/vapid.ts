import fs from 'fs';
import path from 'path';
import webpush from 'web-push';
import { DATA_DIR } from '../config/paths';
import { logger as defaultLogger } from './logSystem';
import type { ILogger } from '../logging';

// Ports the VAPID key bootstrap from server.js:108-125.
const VAPID_KEYS_PATH = path.join(DATA_DIR, 'vapid.json');

export let vapidKeys: { publicKey: string; privateKey: string } = { publicKey: '', privateKey: '' };

export function initializeVapid(injectedLogger: ILogger = defaultLogger): void {
  try {
    if (fs.existsSync(VAPID_KEYS_PATH)) {
      injectedLogger.info('[Push] Loading existing VAPID keys...');
      vapidKeys = JSON.parse(fs.readFileSync(VAPID_KEYS_PATH, 'utf-8'));
    } else {
      injectedLogger.info('[Push] VAPID keys not found. Generating new keys...');
      vapidKeys = webpush.generateVAPIDKeys();
      fs.writeFileSync(VAPID_KEYS_PATH, JSON.stringify(vapidKeys, null, 2));
      injectedLogger.info('[Push] New VAPID keys generated and saved.');
    }
    const vapidContactEmail = process.env.VAPID_CONTACT_EMAIL || 'mailto:admin@example.com';
    injectedLogger.info(`[Push] Setting VAPID contact to: ${vapidContactEmail}`);
    webpush.setVapidDetails(vapidContactEmail, vapidKeys.publicKey, vapidKeys.privateKey);
  } catch (error) {
    injectedLogger.error('[Push] FATAL: Could not load or generate VAPID keys.', { error });
  }
}
