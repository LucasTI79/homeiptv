import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

export interface VodItem {
  id: string;
  name: string;
  type: 'movie' | 'series';
  group: string;
  logo: string;
  url?: string; // Movies only
  description?: string;
  year?: string;
}

export interface VodLibrary {
  movies: VodItem[];
  series: VodItem[];
  categories: string[];
}

export interface SeriesEpisode {
  name: string;
  url: string;
}

export interface SeriesDetails {
  id: string;
  name: string;
  logo: string;
  seasons: Record<string, SeriesEpisode[]>;
}

export function useVodLibrary() {
  return useQuery({
    queryKey: ['vod', 'library'],
    queryFn: async (): Promise<VodLibrary> => {
      const data = await apiFetch<VodLibrary>('/api/vod/library');
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useRefreshVod() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ success: true; message: string }>('/api/vod/refresh', { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vod', 'library'] });
    },
  });
}

export function useSeriesDetails(seriesId: string) {
  return useQuery({
    queryKey: ['vod', 'series', seriesId],
    queryFn: async (): Promise<SeriesDetails> => {
      const data = await apiFetch<SeriesDetails>(`/api/vod/series/${seriesId}`);
      return data;
    },
    enabled: !!seriesId,
  });
}

export async function probeVodDuration(sourceUrl: string, userAgentId?: string): Promise<number | null> {
  try {
    const params = new URLSearchParams({ url: sourceUrl });
    if (userAgentId) params.set('userAgentId', userAgentId);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    
    // We use standard fetch here to easily pass the abort signal
    const response = await fetch(`/api/vod/duration?${params}`, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!response.ok) return null;
    const { duration } = await response.json();
    return typeof duration === 'number' && duration > 0 ? duration : null;
  } catch (error) {
    console.warn('[CAST] Duration probe failed, proceeding without it:', error);
    return null;
  }
}
