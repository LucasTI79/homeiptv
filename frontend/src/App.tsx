import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { queryClient } from './lib/queryClient';
import { useAuthStatus, useNeedsSetup } from './api/auth';
import { LoginPage } from './pages/LoginPage';
import { SetupPage } from './pages/SetupPage';
import { ComingSoonPage } from './pages/ComingSoonPage';
import { AppShell } from './components/AppShell';

function Gate() {
  const needsSetup = useNeedsSetup();
  const authStatus = useAuthStatus();

  if (needsSetup.isLoading || authStatus.isLoading) {
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
        <Route path="/guide" element={<ComingSoonPage title="TV Guide" />} />
        <Route path="/player" element={<ComingSoonPage title="Player" />} />
        <Route path="/vod" element={<ComingSoonPage title="VODs" />} />
        <Route path="/dvr" element={<ComingSoonPage title="DVR" />} />
        <Route path="/notifications" element={<ComingSoonPage title="Notifications" />} />
        <Route path="/admin" element={<ComingSoonPage title="Activity" />} />
        <Route path="/settings" element={<ComingSoonPage title="Settings" />} />
        <Route path="*" element={<Navigate to="/guide" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Gate />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
