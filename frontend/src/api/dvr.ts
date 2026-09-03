import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { DvrJob } from '@homeiptv/shared-types/dvr';

export interface DvrRecording {
  id: string;
  channelName: string;
  programTitle: string;
  startTime: string;
  durationSeconds: number;
  fileSizeBytes: number;
  filename: string;
  username?: string;
}

export interface StorageInfo {
  total: number;
  used: number;
  percentage: number;
}
export function useDvrJobs() {
  return useQuery({
    queryKey: ['dvr', 'jobs'],
    queryFn: () => apiFetch<DvrJob[]>('/api/dvr/jobs'),
  });
}

export function useDvrRecordings() {
  return useQuery({
    queryKey: ['dvr', 'recordings'],
    queryFn: () => apiFetch<DvrRecording[]>('/api/dvr/recordings'),
  });
}

export function useDvrStorage() {
  return useQuery({
    queryKey: ['dvr', 'storage'],
    queryFn: () => apiFetch<StorageInfo>('/api/dvr/storage'),
  });
}

// Finds a scheduled/active DVR job for a program, mirroring the legacy
// findDvrJobForProgram: jobs store the buffered record window (program time
// +/- pre/post buffer), so we un-buffer before comparing against the
// program's own start/stop (with a 1-minute tolerance, as before).
export function findDvrJobForProgram(
  jobs: DvrJob[] | undefined,
  channelId: string,
  programStart: Date,
  programStop: Date,
): DvrJob | undefined {
  return jobs?.find((job) => {
    const jobProgramStart = new Date(job.startTime).getTime() + (job.preBufferMinutes ?? 0) * 60000;
    const jobProgramStop = new Date(job.endTime).getTime() - (job.postBufferMinutes ?? 0) * 60000;
    return (
      job.channelId === channelId &&
      Math.abs(jobProgramStart - programStart.getTime()) < 60000 &&
      Math.abs(jobProgramStop - programStop.getTime()) < 60000
    );
  });
}

export interface ScheduleDvrBody {
  channelId: string;
  channelName: string;
  programTitle: string;
  programStart: string;
  programStop: string;
}

export function useScheduleDvrJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ScheduleDvrBody) =>
      apiFetch<{ success: true; job: DvrJob }>('/api/dvr/schedule', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['dvr', 'jobs'] }),
  });
}

export function useCancelDvrJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiFetch<{ success: true }>(`/api/dvr/jobs/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['dvr', 'jobs'] }),
  });
}

