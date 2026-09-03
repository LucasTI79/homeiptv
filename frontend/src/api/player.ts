import { useMutation } from '@tanstack/react-query';
import { apiFetch } from './client';

export function useStopStream() {
  return useMutation({
    mutationFn: async ({ url, profileId }: { url: string; profileId: string }) => {
      // Typically, this hit a /stream/stop or just /api/stream/stop endpoint
      // Adjust according to the actual backend route
      return apiFetch<{ success: true }>('/api/stream/stop', {
        method: 'POST',
        body: JSON.stringify({ url, profileId }),
      });
    },
  });
}

// Additional APIs for redirect streams, if they exist on the backend
export function useStartRedirectStream() {
  return useMutation({
    mutationFn: async (data: { url: string; channelId?: string | null; name?: string; logo?: string | null }) => {
      return apiFetch<{ success: true; historyId: number }>('/api/stream/redirect/start', {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
  });
}

export function useStopRedirectStream() {
  return useMutation({
    mutationFn: async (historyId: number) => {
      return apiFetch<{ success: true }>('/api/stream/redirect/stop', {
        method: 'POST',
        body: JSON.stringify({ historyId }),
      });
    },
  });
}
