import { useState, type FormEvent } from 'react';
import { useLogin } from '../api/auth';
import { ApiError } from '../api/client';
import { useUiStore } from '../store/uiStore';

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const login = useLogin();
  const appName = useUiStore(state => state.appName);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ username, password });
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-gray-800 rounded-xl p-8 shadow-lg space-y-4">
        <h1 className="text-xl font-bold text-center">{appName}</h1>

        <div>
          <label htmlFor="username" className="block text-sm text-gray-400 mb-1">Username</label>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full rounded-md bg-gray-700 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            autoComplete="username"
            required
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm text-gray-400 mb-1">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md bg-gray-700 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            autoComplete="current-password"
            required
          />
        </div>

        {login.isError && (
          <p className="text-sm text-red-400">
            {login.error instanceof ApiError ? login.error.message : 'Login failed.'}
          </p>
        )}

        <button
          type="submit"
          disabled={login.isPending}
          className="w-full rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-60 py-2 text-sm font-semibold"
        >
          {login.isPending ? 'Logging in...' : 'Login'}
        </button>
      </form>
    </div>
  );
}
