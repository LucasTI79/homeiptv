import { exec } from 'child_process';

// Ports detectHardwareAcceleration/extractVainfoGPUDetails from
// server.js:528-608. Purely diagnostic (logged at startup, matching the
// original -- nothing currently exposes this over the API).
export const detectedHardware = {
  nvidia: null as string | null,
  intel_qsv: null as string | null,
  intel_vaapi: null as string | null,
  radeon_vaapi: null as string | null,
};

function extractVainfoGPUDetails(vainfoStdout: string): string {
  const startTag = 'Driver version: ';
  const endTag = 'vainfo: Supported profile';

  let details = vainfoStdout.substring(
    vainfoStdout.indexOf(startTag) + startTag.length,
    vainfoStdout.lastIndexOf(endTag) - 1,
  );
  if (details === '') {
    details = vainfoStdout;
  } else {
    console.log(`[HW] Detected: ${details}`);
  }
  return details;
}

export async function detectHardwareAcceleration(): Promise<void> {
  const vaapiRadeonGpuDrivers = ['r600_drv_video.so', 'radeonsi_drv_video.so'];
  const intelQsvGpuDrivers = ['iHD_drv_video.so'];
  const intelVaapiGpuDrivers = ['i965_drv_video.so'];

  console.log('[HW] Detecting hardware acceleration capabilities...');

  exec('nvidia-smi --query-gpu=gpu_name --format=csv,noheader', (err, stdout, stderr) => {
    if (err || stderr) {
      console.log('[HW] NVIDIA GPU not detected or nvidia-smi failed.');
    } else {
      const gpuName = stdout.trim();
      detectedHardware.nvidia = gpuName;
      console.log(`[HW] NVIDIA GPU detected: ${gpuName}`);
    }
  });

  exec('vainfo', (_err, stdout, stderr) => {
    if (stderr) {
      let found = false;
      const trimmedStdout = stdout.trim();

      if (intelQsvGpuDrivers.some((s) => stderr.includes(s))) {
        detectedHardware.intel_qsv = extractVainfoGPUDetails(trimmedStdout);
        found = true;
      }
      if (vaapiRadeonGpuDrivers.some((s) => stderr.includes(s))) {
        detectedHardware.radeon_vaapi = extractVainfoGPUDetails(trimmedStdout);
        found = true;
      }
      if (intelVaapiGpuDrivers.some((s) => stderr.includes(s))) {
        detectedHardware.intel_vaapi = extractVainfoGPUDetails(trimmedStdout);
        found = true;
      }

      if (!found) {
        console.log('[HW] vainfo did not detect any recognized GPU');
        if (stderr) console.log(`[HW] vainfo init (stderr): ${stderr.trim()}`);
        if (stdout) console.log(`[HW] vainfo GPU info (stdout): ${stdout.trim()}`);
      }
    }
  });
}
