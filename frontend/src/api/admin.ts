import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

export interface LiveActivity {
  streamKey: string;
  userId: string;
  username: string;
  clientIp: string;
  channelName: string;
  channelLogo: string;
  streamProfileName: string;
  isTranscoded: boolean;
  startTime: string;
}

export interface WatchHistoryEntry {
  id?: number;
  username: string;
  client_ip: string;
  channel_name: string;
  channel_logo: string;
  stream_profile_name: string;
  start_time: string;
  end_time: string | null;
  duration_seconds: number;
}

export interface PaginatedHistory {
  items: WatchHistoryEntry[];
  totalItems: number;
  totalPages: number;
  currentPage: number;
}

export interface SystemHealth {
  cpu: { load: number };
  memory: { percent: number; used: number; total: number };
  disks: { dvr: { percent: number; used: number; total: number } };
}

export interface Analytics {
  topChannels: Array<{ channel_name: string; total_duration: number }>;
  topUsers: Array<{ username: string; total_duration: number }>;
}

export function useSystemHealth() {
  return useQuery({
    queryKey: ['admin', 'health'],
    queryFn: () => apiFetch<SystemHealth>('/api/admin/system-health'),
    refetchInterval: 5000,
  });
}

export function useAnalytics() {
  return useQuery({
    queryKey: ['admin', 'analytics'],
    queryFn: () => apiFetch<Analytics>('/api/admin/analytics'),
  });
}

interface ActivityParams {
  page: number;
  pageSize: number;
  search?: string;
  dateFilter?: string;
  startDate?: string;
  endDate?: string;
}

export function useActivityData(params: ActivityParams) {
  return useQuery({
    queryKey: ['admin', 'activity', params],
    queryFn: async () => {
      const cleanParams: Record<string, string> = {};
      Object.entries(params).forEach(([key, val]) => {
        if (val !== undefined && val !== null && val !== '') {
          cleanParams[key] = String(val);
        }
      });
      const query = new URLSearchParams(cleanParams).toString();
      const data = await apiFetch<{ live: LiveActivity[]; history: PaginatedHistory }>(`/api/admin/activity?${query}`);
      return data;
    },
  });
}

export function useStopStream() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (streamKey: string) => apiFetch('/api/admin/stop-stream', {
      method: 'POST',
      body: JSON.stringify({ streamKey }),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'activity'] }),
  });
}

export function useClearHistory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (olderThanDays?: number) => {
      const query = olderThanDays ? `?olderThanDays=${olderThanDays}` : '';
      return apiFetch<{ success: true; message: string }>(`/api/admin/history${query}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'activity'] });
    },
  });
}

export function useDeleteHistoryEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiFetch<{ success: true; message: string }>(`/api/admin/history/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'activity'] });
    },
  });
}
