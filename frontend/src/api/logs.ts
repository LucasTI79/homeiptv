import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

export interface LogFileInfo {
  name: string;
  size: number;
  mtime: string;
}

export interface LogSummaryInfo {
  fileCount: number;
  totalSize: number;
  oldestDate: string | null;
  files: LogFileInfo[];
}

export function useLogInfo() {
  return useQuery<LogSummaryInfo>({
    queryKey: ['logs', 'info'],
    queryFn: () => apiFetch<LogSummaryInfo>('/api/logs/info'),
    staleTime: 10 * 1000,
  });
}

export function useCleanupLogs() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ success: true; deletedCount: number }>('/api/logs/cleanup', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['logs', 'info'] });
    },
  });
}
