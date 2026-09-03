import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { Settings } from '@homeiptv/shared-types';

export type DeepPartial<T> = T extends object ? {
    [P in keyof T]?: DeepPartial<T[P]>;
} : T;

export function useSaveGlobalSettings() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (newSettings: DeepPartial<Settings>) =>
      apiFetch<{ success: true; message: string; settings: Settings }>('/api/save/settings', {
        method: 'POST',
        body: JSON.stringify(newSettings),
      }),
    onSuccess: () => {
      // Invalidate config so everything relying on guide settings updates
      queryClient.invalidateQueries({ queryKey: ['config'] });
    },
  });
}

export function usePublicIp() {
  return useQuery({
    queryKey: ['settings', 'public-ip'],
    queryFn: () => apiFetch<{ publicIp: string }>('/api/public-ip').catch(() => ({ publicIp: 'Unavailable' })),
    staleTime: 5 * 60 * 1000,
  });
}

export interface HardwareInfo {
  cpu?: string | null;
  nvidia?: string | null;
  intel_qsv?: string | null;
  intel_vaapi?: string | null;
  radeon_vaapi?: string | null;
  [key: string]: string | null | undefined;
}

export function useHardwareInfo() {
  return useQuery<HardwareInfo>({
    queryKey: ['settings', 'hardware'],
    queryFn: () => apiFetch<HardwareInfo>('/api/hardware').catch(() => ({})),
    staleTime: 60 * 60 * 1000,
  });
}
