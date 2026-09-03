import fs from 'fs';
import os from 'os';
import { exec } from 'child_process';

export const detectedHardware = {
  cpu: null as string | null,
  nvidia: null as string | null,
  intel_qsv: null as string | null,
  intel_vaapi: null as string | null,
  radeon_vaapi: null as string | null,
};

function detectCpuInfo(): string {
  try {
    const cpus = os.cpus();
    if (cpus.length > 0) {
      return `${cpus[0].model.trim()} (${cpus.length} Threads)`;
    }
  } catch {}
  return 'Generic CPU';
}

export async function detectHardwareAcceleration(): Promise<void> {
  detectedHardware.cpu = detectCpuInfo();
  console.log(`[HW] CPU Detected: ${detectedHardware.cpu}`);
  console.log('[HW] Detecting hardware acceleration capabilities...');

  // 1. Check NVIDIA GPU
  exec('nvidia-smi --query-gpu=gpu_name --format=csv,noheader', (err, stdout, stderr) => {
    if (!err && !stderr && stdout.trim()) {
      const gpuName = stdout.trim();
      detectedHardware.nvidia = gpuName;
      console.log(`[HW] NVIDIA GPU detected: ${gpuName}`);
    } else {
      console.log('[HW] NVIDIA GPU not detected or nvidia-smi unavailable.');
    }
  });

  // 2. Check VAAPI Devices directly via FFmpeg & DRI nodes (works without vainfo binary)
  const driDevices = ['/dev/dri/renderD128', '/dev/dri/renderD129'];
  for (const driDev of driDevices) {
    if (fs.existsSync(driDev)) {
      exec(`ffmpeg -init_hw_device vaapi=va:${driDev} -v verbose -f lavfi -i nullsrc -t 0.1 -f null - 2>&1`, (_err, output) => {
        if (output.includes('Initialised VAAPI connection') || output.includes('VAAPI driver')) {
          const match = output.match(/VAAPI driver:\s*([^\n\r]+)/i);
          const driverInfo = match ? match[1].trim() : `VAAPI on ${driDev}`;

          if (driverInfo.toLowerCase().includes('radeon') || driverInfo.toLowerCase().includes('amd') || output.toLowerCase().includes('radeonsi')) {
            detectedHardware.radeon_vaapi = driverInfo;
            console.log(`[HW] AMD Radeon VAAPI detected on ${driDev}: ${driverInfo}`);
          } else if (driverInfo.toLowerCase().includes('intel') || driverInfo.toLowerCase().includes('i965')) {
            detectedHardware.intel_vaapi = driverInfo;
            console.log(`[HW] Intel VAAPI detected on ${driDev}: ${driverInfo}`);
          } else {
            detectedHardware.radeon_vaapi = driverInfo;
            console.log(`[HW] VAAPI device detected on ${driDev}: ${driverInfo}`);
          }
        }
      });
    }
  }

  // 3. Optional fallback check with vainfo if installed
  exec('vainfo 2>&1', (_err, stdout) => {
    if (stdout.includes('Driver version:')) {
      const startTag = 'Driver version: ';
      const driver = stdout.substring(stdout.indexOf(startTag) + startTag.length).split('\n')[0].trim();
      if (driver.toLowerCase().includes('radeon') && !detectedHardware.radeon_vaapi) {
        detectedHardware.radeon_vaapi = driver;
      }
    }
  });
}
