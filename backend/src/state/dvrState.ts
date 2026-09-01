import type { Job } from 'node-schedule';

// Ports server.js:53-55 (activeDvrJobs, runningFFmpegProcesses).
export const activeDvrJobs = new Map<number, Job>();
export const runningFFmpegProcesses = new Map<number, number>();
