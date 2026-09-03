import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

export interface AppUser {
  id: number;
  username: string;
  isAdmin: number | boolean;
  canUseDvr: number | boolean;
  allowed_sources?: string | null;
}

export function useUsers() {
  return useQuery<AppUser[]>({
    queryKey: ['users'],
    queryFn: () => apiFetch<AppUser[]>('/api/users'),
    staleTime: 60 * 1000,
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { username: string; password: string; isAdmin: boolean; canUseDvr: boolean }) =>
      apiFetch<{ success: true; id: number }>('/api/users', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: number; username?: string; password?: string; isAdmin?: boolean; canUseDvr?: boolean }) =>
      apiFetch<{ success: true }>(`/api/users/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch<{ success: true }>(`/api/users/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}
