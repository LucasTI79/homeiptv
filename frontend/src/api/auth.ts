import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';
import type { AuthStatus, SessionUser, HealthStatus } from '@homeiptv/shared-types';

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => apiFetch<HealthStatus>('/api/health'),
  });
}

export function useAuthStatus() {
  return useQuery({
    queryKey: ['auth', 'status'],
    queryFn: () => apiFetch<AuthStatus>('/api/auth/status'),
  });
}

export function useNeedsSetup() {
  return useQuery({
    queryKey: ['auth', 'needs-setup'],
    queryFn: () => apiFetch<{ needsSetup: boolean }>('/api/auth/needs-setup'),
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (creds: { username: string; password: string }) =>
      apiFetch<{ success: true; user: SessionUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(creds),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth'] });
    },
  });
}

export function useSetupAdmin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (creds: { username: string; password: string }) =>
      apiFetch<{ success: true; user: SessionUser }>('/api/auth/setup-admin', {
        method: 'POST',
        body: JSON.stringify(creds),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth'] });
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ success: true }>('/api/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      queryClient.setQueryData(['auth', 'status'], { isLoggedIn: false });
      queryClient.invalidateQueries();
    },
  });
}
