import fs from 'fs';
import path from 'path';
import webpush from 'web-push';
import { DATA_DIR } from '../config/paths';

// Ports the VAPID key bootstrap from server.js:108-125.
const VAPID_KEYS_PATH = path.join(DATA_DIR, 'vapid.json');

export let vapidKeys: { publicKey: string; privateKey: string } = { publicKey: '', privateKey: '' };

export function initializeVapid(): void {
  try {
    if (fs.existsSync(VAPID_KEYS_PATH)) {
      console.log('[Push] Loading existing VAPID keys...');
      vapidKeys = JSON.parse(fs.readFileSync(VAPID_KEYS_PATH, 'utf-8'));
    } else {
      console.log('[Push] VAPID keys not found. Generating new keys...');
      vapidKeys = webpush.generateVAPIDKeys();
      fs.writeFileSync(VAPID_KEYS_PATH, JSON.stringify(vapidKeys, null, 2));
      console.log('[Push] New VAPID keys generated and saved.');
    }
    const vapidContactEmail = process.env.VAPID_CONTACT_EMAIL || 'mailto:admin@example.com';
    console.log(`[Push] Setting VAPID contact to: ${vapidContactEmail}`);
    webpush.setVapidDetails(vapidContactEmail, vapidKeys.publicKey, vapidKeys.privateKey);
  } catch (error) {
    console.error('[Push] FATAL: Could not load or generate VAPID keys.', error);
  }
}
