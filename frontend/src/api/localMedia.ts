import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { LocalMediaFolder } from '@homeiptv/shared-types';

export interface FolderScanPreview {
  isValid: boolean;
  exists: boolean;
  path: string;
  totalFiles: number;
  videoFilesCount: number;
  moviesFound: Array<{ name: string; year: number | null; category: string; relativePath: string }>;
  seriesFound: Array<{ name: string; seasons: number; episodes: number; category: string }>;
  warnings: string[];
  recommendations: string[];
}

export function useLocalMediaFolders() {
  return useQuery({
    queryKey: ['localMedia', 'folders'],
    queryFn: async () => {
      const data = await apiFetch<{ folders: LocalMediaFolder[] }>('/api/local-media/folders');
      return data.folders;
    },
  });
}

export function useValidateLocalPath() {
  return useMutation({
    mutationFn: (folderPath: string) =>
      apiFetch<FolderScanPreview>('/api/local-media/validate-path', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderPath }),
      }),
  });
}

export function usePrepareFolderStructure() {
  return useMutation({
    mutationFn: (folderPath: string) =>
      apiFetch<{ success: boolean; createdPaths: string[]; message: string }>(
        '/api/local-media/prepare-structure',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folderPath }),
        }
      ),
  });
}

export function useSaveLocalFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (folder: Partial<LocalMediaFolder>) =>
      apiFetch<{ success: boolean; folder: LocalMediaFolder }>('/api/local-media/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(folder),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['localMedia', 'folders'] });
      queryClient.invalidateQueries({ queryKey: ['vod', 'library'] });
    },
  });
}

export function useDeleteLocalFolder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ success: boolean }>(`/api/local-media/folders/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['localMedia', 'folders'] });
      queryClient.invalidateQueries({ queryKey: ['vod', 'library'] });
    },
  });
}

export function useScanLocalMedia() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ success: boolean; moviesCount: number; seriesCount: number; episodesCount: number }>(
        '/api/local-media/scan',
        { method: 'POST' }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['localMedia', 'folders'] });
      queryClient.invalidateQueries({ queryKey: ['vod', 'library'] });
    },
  });
}
