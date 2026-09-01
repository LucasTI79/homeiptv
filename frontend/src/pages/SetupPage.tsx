import { useState, type FormEvent } from 'react';
import { useSetupAdmin } from '../api/auth';
import { ApiError } from '../api/client';

export function SetupPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const setup = useSetupAdmin();

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setup.mutate({ username, password });
  };

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm bg-gray-800 rounded-xl p-8 shadow-lg space-y-4">
        <h1 className="text-xl font-bold text-center">Welcome to ViniPlay</h1>
        <p className="text-sm text-gray-400 text-center">Create the first admin account to get started.</p>

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
            autoComplete="new-password"
            required
          />
        </div>

        {setup.isError && (
          <p className="text-sm text-red-400">
            {setup.error instanceof ApiError ? setup.error.message : 'Setup failed.'}
          </p>
        )}

        <button
          type="submit"
          disabled={setup.isPending}
          className="w-full rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-60 py-2 text-sm font-semibold"
        >
          {setup.isPending ? 'Creating account...' : 'Create Admin Account'}
        </button>
      </form>
    </div>
  );
}
