import { NavLink, Outlet } from 'react-router-dom';
import { useLogout } from '../api/auth';

const NAV_ITEMS = [
  { to: '/guide', label: 'TV Guide' },
  { to: '/player', label: 'Player' },
  { to: '/vod', label: 'VODs' },
  { to: '/dvr', label: 'DVR' },
  { to: '/notifications', label: 'Notifications' },
  { to: '/admin', label: 'Activity' },
  { to: '/settings', label: 'Settings' },
];

export function AppShell() {
  const logout = useLogout();

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col">
      <header className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
        <span className="font-bold">ViniPlay</span>
        <nav className="hidden sm:flex items-center gap-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-md text-sm ${isActive ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`
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
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}
