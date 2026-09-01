import fs from 'fs';
import path from 'path';
import https from 'https';
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { fetchUrlContent } from '../services/sources';
import { detectedHardware } from '../services/hardwareDetection';

// Ports the small standalone routes from server.js:3858-3871, 4876-4909.
export const miscRouter = Router();

miscRouter.get('/version', requireAuth, (_req, res) => {
  try {
    const packageJsonPath = path.resolve(__dirname, '../../../package.json');
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      res.json({ version: packageJson.version || 'Unknown' });
    } else {
      res.json({ version: 'Unknown' });
    }
  } catch (error) {
    console.error('[API] Error reading package.json:', error);
    res.status(500).json({ error: 'Could not determine app version.' });
  }
});

miscRouter.post('/validate-url', requireAuth, async (req, res) => {
  const { url } = req.body as { url?: string };
  if (!url) {
    return res.status(400).json({ error: 'URL is required.' });
  }
  console.log(`[VALIDATE_URL] Testing URL: ${url}`);
  try {
    await fetchUrlContent(url);
    res.json({ success: true, message: 'URL is reachable and returned a successful response.' });
  } catch (error) {
    res.status(400).json({ success: false, error: `URL is not reachable. Error: ${(error as Error).message}` });
  }
});

miscRouter.get('/hardware', requireAuth, (_req, res) => {
  res.json(detectedHardware);
});

miscRouter.get('/public-ip', requireAuth, (_req, res) => {
  console.log('[IP_API] Fetching public IP address...');
  https.get('https://ifconfig.me/ip', (ipRes) => {
    let data = '';
    ipRes.on('data', (chunk) => { data += chunk; });
    ipRes.on('end', () => res.json({ publicIp: data.trim() }));
  }).on('error', (err) => {
    console.error('[IP_API] Error fetching public IP:', err.message);
    res.status(500).json({ error: 'Could not fetch public IP address.' });
  });
});
