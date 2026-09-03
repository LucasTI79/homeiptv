import { apiFetch } from './client';

export function generateCastToken(streamUrl: string): Promise<{ token: string }> {
  return apiFetch<{ token: string }>('/api/cast/generate-token', {
    method: 'POST',
    body: JSON.stringify({ streamUrl }),
  });
}

export function stopCastStreamOnServer(url: string, profileId: string): Promise<{ success: true }> {
  return apiFetch<{ success: true }>('/api/stream/stop', {
    method: 'POST',
    body: JSON.stringify({ url, profileId }),
  });
}
