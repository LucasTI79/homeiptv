import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useLogout } from '../api/auth';
import { useUiStore } from '../store/uiStore';
import { useConfig } from '../api/guide';
import { useRemoteStore } from '../store/remoteStore';
import { useDownloadStore } from '../store/downloadStore';
import { useEffect } from 'react';
import { FiMenu, FiX, FiLogOut } from 'react-icons/fi';

const NAV_ITEMS = [
  { to: '/guide', label: 'TV Guide' },
  { to: '/player', label: 'Player' },
  { to: '/multiview', label: 'Multiview' },
  { to: '/vod', label: 'VODs' },
  { to: '/downloads', label: 'Downloads' },
  { to: '/dvr', label: 'DVR' },
  { to: '/notifications', label: 'Notifications' },
  { to: '/admin', label: 'Activity' },
  { to: '/settings', label: 'Settings' },
];

export function AppShell() {
  const navigate = useNavigate();
  const logout = useLogout();
  const appName = useUiStore((state) => state.appName);
  const isMobileNavOpen = useUiStore((state) => state.isMobileNavOpen);
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);

  // Keep guide config warm in memory
  useConfig();

  useEffect(() => {
    useRemoteStore.getState().setHostNavigateCallback((path) => {
      navigate(path);
    });
    useDownloadStore.getState().initDownloads().catch(() => {});
    return () => {
      useRemoteStore.getState().setHostNavigateCallback(null);
    };
  }, [navigate]);

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col">
      <header className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="sm:hidden text-gray-300 hover:text-white p-1.5 -ml-1.5 rounded-lg hover:bg-gray-800 transition"
            aria-label="Open menu"
          >
            <FiMenu className="w-6 h-6" />
          </button>
          <span className="font-bold text-lg">{appName}</span>
        </div>

        <nav className="hidden sm:flex items-center gap-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-md text-sm transition-colors ${
                  isActive ? 'bg-gray-700 text-white font-medium' : 'text-gray-400 hover:text-white'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <button
          onClick={() => logout.mutate()}
          className="text-sm text-gray-400 hover:text-white"
        >
          Logout
        </button>
      </header>

      {/* Mobile Drawer Overlay */}
      {isMobileNavOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 sm:hidden transition-opacity"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* Mobile Sidebar */}
      <aside
        className={`fixed top-0 left-0 bottom-0 w-72 bg-gray-900 border-r border-gray-800 z-50 sm:hidden flex flex-col transition-transform duration-300 ease-in-out ${
          isMobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <span className="font-bold text-lg text-white">{appName}</span>
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-800 transition"
            aria-label="Close menu"
          >
            <FiX className="w-6 h-6" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-4 space-y-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setMobileNavOpen(false)}
              className={({ isActive }) =>
                `flex items-center px-4 py-3 rounded-lg text-base transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white font-semibold'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-gray-800">
          <button
            type="button"
            onClick={() => {
              setMobileNavOpen(false);
              logout.mutate();
            }}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 hover:text-red-300 font-medium rounded-lg transition"
          >
            <FiLogOut className="w-5 h-5" /> Logout
          </button>
        </div>
      </aside>

      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
