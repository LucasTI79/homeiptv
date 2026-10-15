import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { getSettings, saveSettings, defaultSettings, SETTINGS_PATH } from '../settings';

describe('Settings Cast & Inactivity configuration', () => {
  const backupPath = `${SETTINGS_PATH}.bak`;

  beforeEach(() => {
    if (fs.existsSync(SETTINGS_PATH)) {
      fs.copyFileSync(SETTINGS_PATH, backupPath);
    }
  });

  afterEach(() => {
    if (fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, SETTINGS_PATH);
      fs.unlinkSync(backupPath);
    }
  });

  it('provides default castReceiverAppId and streamInactivityTimeoutSeconds', () => {
    expect(defaultSettings.castReceiverAppId).toBe('CC1AD845');
    expect(defaultSettings.streamInactivityTimeoutSeconds).toBe(900);
  });

  it('migrates older settings missing castReceiverAppId and streamInactivityTimeoutSeconds', () => {
    const oldSettings = { ...defaultSettings };
    delete (oldSettings as any).castReceiverAppId;
    delete (oldSettings as any).streamInactivityTimeoutSeconds;
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(oldSettings, null, 2));

    const loaded = getSettings();
    expect(loaded.castReceiverAppId).toBe('CC1AD845');
    expect(loaded.streamInactivityTimeoutSeconds).toBe(900);
  });

  it('persists customized castReceiverAppId and streamInactivityTimeoutSeconds', () => {
    const current = getSettings();
    const updated = {
      ...current,
      castReceiverAppId: 'CUSTOM123',
      streamInactivityTimeoutSeconds: 1800,
    };
    saveSettings(updated);

    const reloaded = getSettings();
    expect(reloaded.castReceiverAppId).toBe('CUSTOM123');
    expect(reloaded.streamInactivityTimeoutSeconds).toBe(1800);
  });
});
