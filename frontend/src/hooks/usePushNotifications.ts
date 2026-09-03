import { useEffect, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getVapidKey, subscribeToPush, unsubscribeFromPush } from '../api/notifications';
import { toast } from 'react-hot-toast';

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function usePushNotifications() {
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    // Setup Service Worker
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          setRegistration(reg);
          reg.pushManager.getSubscription().then((sub) => {
            setIsSubscribed(sub !== null);
          });
        })
        .catch((err) => {
          console.error('Service Worker registration failed:', err);
        });

      // Listen for push events triggering refreshes
      const channel = new BroadcastChannel('viniplay-notifications');
      channel.onmessage = (event) => {
        if (event.data?.type === 'refresh-notifications') {
          queryClient.invalidateQueries({ queryKey: ['notifications'] });
        }
      };
      return () => {
        channel.close();
      };
    }
  }, [queryClient]);

  const unsubscribe = useCallback(async () => {
    if (!registration) return false;
    try {
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await unsubscribeFromPush(subscription);
        await subscription.unsubscribe();
      }
      setIsSubscribed(false);
      return true;
    } catch (error) {
      console.error('Error during unsubscription:', error);
      return false;
    }
  }, [registration]);

  const subscribe = useCallback(
    async (force = false) => {
      if (!registration) {
        toast.error('Service worker not registered.');
        return false;
      }

      if (force) {
        toast('Refreshing subscription...', { icon: '🔄' });
        await unsubscribe();
      }

      try {
        const existingSub = await registration.pushManager.getSubscription();
        if (existingSub && !force) {
          setIsSubscribed(true);
          return true;
        }

        const vapidPublicKey = await getVapidKey();
        if (!vapidPublicKey) {
          toast.error('Missing server key for notifications.');
          return false;
        }

        const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
        const newSubscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey,
        });

        await subscribeToPush(newSubscription);
        setIsSubscribed(true);
        toast.success(force ? 'Re-subscribed successfully!' : 'Notifications enabled successfully!');
        return true;
      } catch (error) {
        console.error('Failed to subscribe user:', error);
        if (Notification.permission === 'denied') {
          toast.error('Notifications are blocked by your browser.');
        } else {
          toast.error('Failed to set up notifications.');
        }
        setIsSubscribed(false);
        return false;
      }
    },
    [registration, unsubscribe]
  );

  return { isSubscribed, subscribe, unsubscribe };
}
