import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { Router } from 'express';
import { db } from '../db/connection';
import { getSettings, saveSettings, SETTINGS_PATH } from '../services/settings';
import { processAndMergeSources } from '../services/sources';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { DATA_DIR } from '../config/paths';
import type { Settings } from '@homeiptv/shared-types';

// Ports /api/save/settings, /api/user/settings (server.js:3011-3086) and
// /api/settings/export, /api/settings/import (server.js:5088-5116).
export const settingsRouter = Router();

// User-specific keys that must never leak into the shared global settings.json.
const USER_SPECIFIC_KEYS = ['favorites', 'playerDimensions', 'programDetailsDimensions', 'recentChannels', 'multiviewLayouts'];

settingsRouter.post('/save/settings', requireAuth, async (req, res) => {
  try {
    const currentSettings = getSettings();
    const oldTimezone = currentSettings.timezoneOffset;
    const updatedSettings: Settings = { ...currentSettings };

    for (const key of Object.keys(req.body)) {
      if (!USER_SPECIFIC_KEYS.includes(key)) {
        (updatedSettings as unknown as Record<string, unknown>)[key] = req.body[key];
      } else {
        console.warn(`[SETTINGS_SAVE] Attempted to save user-specific key "${key}" to global settings. This is ignored.`);
      }
    }

    saveSettings(updatedSettings);

    if (updatedSettings.timezoneOffset !== oldTimezone) {
      console.log('[API] Timezone setting changed, re-processing sources.');
      const result = await processAndMergeSources();
      if (result.success) {
        saveSettings(result.updatedSettings);
      }
    }

    res.json({ success: true, message: 'Settings saved.', settings: getSettings() });
  } catch (err) {
    console.error('[API] Error saving global settings:', err);
    res.status(500).json({ error: 'Could not save settings. Check server logs.' });
  }
});

settingsRouter.post('/user/settings', requireAuth, async (req, res) => {
  const { key, value } = req.body as { key?: string; value?: unknown };
  const userId = req.session.userId as number;

  if (!key) {
    return res.status(400).json({ error: 'A setting key is required.' });
  }

  try {
    await db('user_settings')
      .insert({ user_id: userId, key, value: JSON.stringify(value) })
      .onConflict(['user_id', 'key'])
      .merge();

    const globalSettings = getSettings();
    const rows = await db('user_settings').select('key', 'value').where({ user_id: userId });

    const userSettings: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        userSettings[row.key] = JSON.parse(row.value);
      } catch {
        userSettings[row.key] = row.value;
      }
    }

    res.json({ success: true, settings: { ...globalSettings, ...userSettings } });
  } catch (err) {
    console.error(`[API] Error saving user setting for user ${userId}, key ${key}:`, err);
    res.status(500).json({ error: 'Could not save user setting.' });
  }
});

const settingsUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, DATA_DIR),
    filename: (_req, _file, cb) => cb(null, 'settings.tmp.json'),
  }),
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/json') cb(null, true);
    else cb(new Error('Invalid file type. Only JSON is allowed.'));
  },
});

settingsRouter.get('/settings/export', requireAdmin, (_req, res) => {
  if (fs.existsSync(SETTINGS_PATH)) {
    res.download(SETTINGS_PATH, 'viniplay-settings-backup.json', (err) => {
      if (err) console.error('[SETTINGS_EXPORT] Error sending settings file:', err);
    });
  } else {
    res.status(404).json({ error: 'Settings file not found.' });
  }
});

settingsRouter.post('/settings/import', requireAdmin, settingsUpload.single('settingsFile'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No settings file was uploaded.' });
  }
  const tempPath = path.join(DATA_DIR, 'settings.tmp.json');
  try {
    const fileContent = fs.readFileSync(tempPath, 'utf-8');
    JSON.parse(fileContent);
    fs.renameSync(tempPath, SETTINGS_PATH);
    console.log('[SETTINGS_IMPORT] Settings file imported successfully. App will now use new settings.');
    res.json({ success: true, message: 'Settings imported. The application will use them on next load.' });
  } catch (error) {
    console.error('[SETTINGS_IMPORT] Error processing imported settings file:', (error as Error).message);
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    res.status(400).json({ error: `Invalid settings file. Error: ${(error as Error).message}` });
  }
});
