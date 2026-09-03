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
import { DvrPage } from './pages/dvr/DvrPage';
import { AdminPage } from './pages/admin/AdminPage';
import { SettingsPage } from './pages/settings/SettingsPage';
import { NotificationPage } from './pages/notifications/NotificationPage';
import { MultiviewPage } from './pages/multiview/MultiviewPage';
import { AppShell } from './components/AppShell';
import { CastProvider } from './components/cast/CastProvider';

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
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/guide" element={<GuidePage />} />
        <Route path="/player" element={<PlayerPage />} />
        <Route path="/vod" element={<VodPage />} />
        <Route path="/dvr" element={<DvrPage />} />
        <Route path="/notifications" element={<NotificationPage />} />
        <Route path="/multiview" element={<MultiviewPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/guide" replace />} />
      </Route>
    </Routes>
  );
}

import { TooltipProvider } from './components/ui/Tooltip';

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <CastProvider>
        <TooltipProvider>
          <BrowserRouter>
            <Gate />
          </BrowserRouter>
        </TooltipProvider>
      </CastProvider>
    </QueryClientProvider>
  );
}
