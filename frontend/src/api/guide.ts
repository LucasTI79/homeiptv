import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { EpgProgram, Settings } from '@homeiptv/shared-types';
import type { VodItem } from './vod';

export type JSONValue = string | number | boolean | null | { [key: string]: JSONValue } | JSONValue[];

// User-specific fields that ride along on top of the global Settings object
// once /api/config or /api/user/settings merge in the per-user rows from the
// user_settings table (see backend/src/routes/config.ts and settings.ts).
export interface UserGuideSettings {
  favorites?: string[];
  recentChannels?: string[];
  activeGroupFilter?: string;
  activeSourceFilter?: string;
  channelColumnWidth?: number;
}

export type MergedSettings = Settings & UserGuideSettings;

export interface GuideConfig {
  m3uContent: string | null;
  epgContent: Record<string, EpgProgram[]>;
  settings: MergedSettings;
  vodMovies: VodItem[];
  vodSeries: VodItem[];
}

export function useConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: () => apiFetch<GuideConfig>('/api/config'),
    staleTime: 10 * 60 * 1000, // 10 minutes cache - instant tab switching!
    gcTime: 30 * 60 * 1000,
  });
}

// Persists one user-specific setting (favorites, activeGroupFilter,
// activeSourceFilter, recentChannels, ...) via POST /api/user/settings, with
// an optimistic update to the cached ['config'] query so the UI reflects the
// change immediately instead of waiting on the round trip.
export function useSaveUserSetting() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: JSONValue }) =>
      apiFetch<{ success: true; settings: MergedSettings }>('/api/user/settings', {
        method: 'POST',
        body: JSON.stringify({ key, value }),
      }),
    onMutate: async ({ key, value }) => {
      await queryClient.cancelQueries({ queryKey: ['config'] });
      const previous = queryClient.getQueryData<GuideConfig>(['config']);
      if (previous) {
        queryClient.setQueryData<GuideConfig>(['config'], {
          ...previous,
          settings: { ...previous.settings, [key]: value },
        });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['config'], context.previous);
      }
    },
    onSuccess: (data) => {
      queryClient.setQueryData<GuideConfig | undefined>(['config'], (old) =>
        old ? { ...old, settings: data.settings } : old,
      );
    },
  });
}
