import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from './client';

export type NotificationStatus = 'pending' | 'sent' | 'expired';

export interface ProgramNotification {
  id: number;
  channelId: string;
  channelName: string;
  channelLogo: string;
  programTitle: string;
  programDesc: string;
  programStart: string;
  programStop: string;
  scheduledTime: string;
  programId: string;
  status: NotificationStatus;
  triggeredAt: string | null;
}

export interface CreateNotificationBody {
  channelId: string;
  channelName: string;
  channelLogo: string;
  programTitle: string;
  programDesc: string;
  programStart: string;
  programStop: string;
  scheduledTime: string;
  programId: string;
}

export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => apiFetch<ProgramNotification[]>('/api/notifications'),
  });
}

// Finds an existing notification for a program, mirroring the legacy
// findNotificationForProgram (matches on channelId + programId).
export function findNotificationForProgram(
  notifications: ProgramNotification[] | undefined,
  channelId: string,
  programId: string,
): ProgramNotification | undefined {
  return notifications?.find((n) => n.channelId === channelId && n.programId === programId);
}

export function useCreateNotification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateNotificationBody) =>
      apiFetch<{ success: true; id: number }>('/api/notifications', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

export function useDeleteNotification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiFetch<{ success: true }>(`/api/notifications/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

export async function getVapidKey(): Promise<string> {
  const res = await apiFetch<{ publicKey: string }>('/api/notifications/vapid-public-key');
  return res.publicKey;
}

export function subscribeToPush(subscription: PushSubscription): Promise<{ success: true }> {
  return apiFetch<{ success: true }>('/api/notifications/subscribe', {
    method: 'POST',
    body: JSON.stringify(subscription.toJSON()),
  });
}

export function unsubscribeFromPush(subscription: PushSubscription): Promise<{ success: true }> {
  return apiFetch<{ success: true }>('/api/notifications/unsubscribe', {
    method: 'POST',
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
}

export function useClearPastNotifications() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ success: true; deletedCount: number }>('/api/notifications/past', { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
}
