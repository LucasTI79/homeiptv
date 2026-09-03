import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { queryClient } from './lib/queryClient';
import { useAuthStatus, useNeedsSetup, useHealth } from './api/auth';
import { useUiStore } from './store/uiStore';
import { useEffect } from 'react';
import { LoginPage } from './pages/LoginPage';
import { SetupPage } from './pages/SetupPage';

import { GuidePage } from './pages/GuidePage';
import { PlayerPage } from './pages/PlayerPage';
import { VodPage } from './pages/vod/VodPage';
import { DownloadsPage } from './pages/downloads/DownloadsPage';
import { DvrPage } from './pages/dvr/DvrPage';
import { AdminPage } from './pages/admin/AdminPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { NotificationPage } from './pages/notifications/NotificationPage';
import { MultiviewPage } from './pages/multiview/MultiviewPage';
import { AppShell } from './components/AppShell';
import { CastProvider } from './components/cast/CastProvider';
import { RemoteNowPlayingBar } from './components/remote/RemoteNowPlayingBar';
import { useRemoteStore } from './store/remoteStore';

function Gate() {
  const needsSetup = useNeedsSetup();
  const authStatus = useAuthStatus();
  const health = useHealth();
  const setAppName = useUiStore(state => state.setAppName);

  useEffect(() => {
    if (health.data?.appName) {
      setAppName(health.data.appName);
      document.title = health.data.appName;
    }
  }, [health.data?.appName, setAppName]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const remoteSession = params.get('remote_session');
    const pin = params.get('pin');

    if (remoteSession) {
      useRemoteStore.getState().connectAsClient(remoteSession, pin || undefined);
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, '', cleanUrl);
    } else {
      useRemoteStore.getState().checkAutoReconnect();
    }
  }, []);

  if (needsSetup.isLoading || authStatus.isLoading || health.isLoading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center text-gray-500">
        Loading...
      </div>
    );
  }

  if (needsSetup.data?.needsSetup) {
    return (
      <Routes>
        <Route path="*" element={<SetupPage />} />
      </Routes>
    );
  }

  if (!authStatus.data?.isLoggedIn) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    );
  }

  return (
    <>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/guide" element={<GuidePage />} />
          <Route path="/player" element={<PlayerPage />} />
          <Route path="/vod" element={<VodPage />} />
          <Route path="/downloads" element={<DownloadsPage />} />
          <Route path="/dvr" element={<DvrPage />} />
          <Route path="/notifications" element={<NotificationPage />} />
          <Route path="/multiview" element={<MultiviewPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/guide" replace />} />
        </Route>
      </Routes>
      <RemoteNowPlayingBar />
    </>
  );
}

import { TooltipProvider } from './components/ui/Tooltip';
import { Toaster } from 'react-hot-toast';

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <CastProvider>
        <TooltipProvider>
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                background: '#1f2937',
                color: '#f3f4f6',
                border: '1px solid #374151',
                borderRadius: '0.75rem',
                fontSize: '0.875rem',
              },
            }}
          />
          <BrowserRouter>
            <Gate />
          </BrowserRouter>
        </TooltipProvider>
      </CastProvider>
    </QueryClientProvider>
  );
}
