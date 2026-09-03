import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { Settings } from '@homeiptv/shared-types';

export interface SaveSourcePayload {
  sourceType: 'm3u' | 'epg';
  id?: string;
  name: string;
  isActive: boolean;
  refreshHours?: number;
  type: 'url' | 'file' | 'xc';
  url?: string;
  sourceFile?: File | null;
  xcServer?: string;
  xcUsername?: string;
  xcPassword?: string;
  selectedGroups?: string[];
}

export function useSaveSource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: SaveSourcePayload) => {
      const formData = new FormData();
      formData.append('sourceType', payload.sourceType);
      formData.append('name', payload.name);
      formData.append('isActive', payload.isActive ? 'true' : 'false');
      formData.append('refreshHours', String(payload.refreshHours ?? 0));

      if (payload.id) {
        formData.append('id', payload.id);
      }

      if (payload.selectedGroups && payload.selectedGroups.length > 0) {
        formData.append('selectedGroups', JSON.stringify(payload.selectedGroups));
      }

      if (payload.type === 'xc') {
        const xcData = {
          server: (payload.xcServer || '').replace(/\/+$/, ''),
          username: payload.xcUsername || '',
          password: payload.xcPassword || '',
        };
        formData.append('xc', JSON.stringify(xcData));
      } else if (payload.type === 'file' && payload.sourceFile) {
        formData.append('sourceFile', payload.sourceFile);
      } else if (payload.type === 'url' && payload.url) {
        formData.append('url', payload.url);
      }

      return apiFetch<{ success: true; message: string; settings: Settings }>('/api/sources', {
        method: 'POST',
        body: formData,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
    },
  });
}

export function useToggleSourceActive() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ sourceType, id, isActive }: { sourceType: 'm3u' | 'epg'; id: string; isActive: boolean }) => {
      return apiFetch<{ success: true; message: string; settings: Settings }>(`/api/sources/${sourceType}/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ isActive }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
    },
  });
}

export function useDeleteSource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ sourceType, id }: { sourceType: 'm3u' | 'epg'; id: string }) => {
      return apiFetch<{ success: true; message: string; settings: Settings }>(`/api/sources/${sourceType}/${id}`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
    },
  });
}

export function useProcessSources() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      return apiFetch<{ success: boolean; message?: string }>('/api/process-sources', {
        method: 'POST',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['config'] });
    },
  });
}
