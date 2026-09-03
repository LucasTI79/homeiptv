import React, { useState } from 'react';
import { useUsers, useCreateUser, useUpdateUser, useDeleteUser, type AppUser } from '../../api/users';
import { useAuthStatus } from '../../api/auth';
import { toast } from 'react-hot-toast';
import { FiUserPlus, FiShield, FiTrash2, FiEdit2, FiX, FiCheck } from 'react-icons/fi';

export const UsersTab: React.FC = () => {
  const { data: users, isLoading, error } = useUsers();
  const { data: authStatus } = useAuthStatus();
  const currentUserId = authStatus?.isLoggedIn ? authStatus.user.id : undefined;

  const createMutation = useCreateUser();
  const updateMutation = useUpdateUser();
  const deleteMutation = useDeleteUser();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AppUser | null>(null);

  // Form State
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [canUseDvr, setCanUseDvr] = useState(true);

  const openCreateModal = () => {
    setEditingUser(null);
    setUsername('');
    setPassword('');
    setIsAdmin(false);
    setCanUseDvr(true);
    setIsModalOpen(true);
  };

  const openEditModal = (user: AppUser) => {
    setEditingUser(user);
    setUsername(user.username);
    setPassword(''); // blank means keep unchanged
    setIsAdmin(Boolean(user.isAdmin));
    setCanUseDvr(Boolean(user.canUseDvr));
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingUser(null);
    setUsername('');
    setPassword('');
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      toast.error('Username is required.');
      return;
    }

    if (editingUser) {
      updateMutation.mutate(
        {
          id: editingUser.id,
          username: username.trim(),
          password: password ? password : undefined,
          isAdmin,
          canUseDvr,
        },
        {
          onSuccess: () => {
            toast.success('User updated successfully!');
            closeModal();
          },
          onError: (err: any) => {
            toast.error(err.message || 'Failed to update user.');
          },
        }
      );
    } else {
      if (!password) {
        toast.error('Password is required for new users.');
        return;
      }
      createMutation.mutate(
        {
          username: username.trim(),
          password,
          isAdmin,
          canUseDvr,
        },
        {
          onSuccess: () => {
            toast.success('User created successfully!');
            closeModal();
          },
          onError: (err: any) => {
            toast.error(err.message || 'Failed to create user.');
          },
        }
      );
    }
  };

  const handleDeleteUser = (user: AppUser) => {
    if (user.id === currentUserId) {
      toast.error('You cannot delete your own account.');
      return;
    }

    if (window.confirm(`Are you sure you want to permanently delete user "${user.username}"?`)) {
      deleteMutation.mutate(user.id, {
        onSuccess: () => {
          toast.success(`User "${user.username}" removed.`);
        },
        onError: (err: any) => {
          toast.error(err.message || 'Could not delete user.');
        },
      });
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gray-800 border border-gray-700/80 p-5 rounded-xl shadow-lg">
        <div>
          <h2 className="text-base font-bold text-white">User Accounts &amp; Permissions</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Manage who has access to ViniPlay, administrator rights, and DVR capabilities.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreateModal}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow transition flex items-center justify-center gap-2 shrink-0"
        >
          <FiUserPlus className="w-4 h-4" /> Add User
        </button>
      </div>

      {/* Users Table */}
      <div className="bg-gray-800 border border-gray-700/80 rounded-xl overflow-hidden shadow-lg">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Loading users...</div>
        ) : error ? (
          <div className="p-8 text-center text-red-400 text-sm">
            Failed to load users. Only administrators can access user management.
          </div>
        ) : !users || users.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">No users found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-gray-300">
              <thead className="bg-gray-900/60 text-xs uppercase font-semibold text-gray-400 border-b border-gray-700">
                <tr>
                  <th className="px-5 py-3">Username</th>
                  <th className="px-5 py-3">Role</th>
                  <th className="px-5 py-3">DVR Access</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/60">
                {users.map((user) => {
                  const isCurrent = user.id === currentUserId;
                  const userIsAdmin = Boolean(user.isAdmin);
                  const userCanDvr = Boolean(user.canUseDvr);

                  return (
                    <tr key={user.id} className="hover:bg-gray-700/30 transition">
                      <td className="px-5 py-3.5 font-medium text-white flex items-center gap-2">
                        {user.username}
                        {isCurrent && (
                          <span className="text-[10px] bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full font-bold border border-blue-500/30">
                            YOU
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        {userIsAdmin ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                            <FiShield className="w-3.5 h-3.5" /> Administrator
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-gray-700/60 text-gray-300">
                            Standard User
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5">
                        {userCanDvr ? (
                          <span className="inline-flex items-center gap-1 text-emerald-400 text-xs font-medium">
                            <FiCheck className="w-4 h-4" /> Enabled
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-gray-500 text-xs">
                            <FiX className="w-4 h-4" /> Disabled
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openEditModal(user)}
                            className="p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-gray-700 transition"
                            title="Edit User"
                          >
                            <FiEdit2 className="w-4 h-4" />
                          </button>
                          {!isCurrent && (
                            <button
                              type="button"
                              onClick={() => handleDeleteUser(user)}
                              className="p-1.5 text-gray-400 hover:text-red-400 rounded-lg hover:bg-gray-700 transition"
                              title="Delete User"
                            >
                              <FiTrash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create / Edit User Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 border border-gray-700 rounded-2xl max-w-md w-full p-6 shadow-2xl animate-fade-in">
            <div className="flex justify-between items-center pb-3 mb-4 border-b border-gray-700">
              <h3 className="text-lg font-bold text-white">
                {editingUser ? `Edit User: ${editingUser.username}` : 'Add New User'}
              </h3>
              <button
                type="button"
                onClick={closeModal}
                className="text-gray-400 hover:text-white text-xl p-1"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-300 mb-1.5">
                  Username
                </label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3.5 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="e.g. john_doe"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-gray-300 mb-1.5">
                  {editingUser ? 'New Password (leave empty to keep current)' : 'Password'}
                </label>
                <input
                  type="password"
                  required={!editingUser}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3.5 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="••••••••"
                />
              </div>

              <div className="space-y-3 pt-2">
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={isAdmin}
                    onChange={(e) => setIsAdmin(e.target.checked)}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 bg-gray-900 border-gray-700"
                  />
                  <div>
                    <p className="text-sm font-semibold text-white">Administrator Access</p>
                    <p className="text-xs text-gray-400">Can manage playlists, hardware profiles, users and settings</p>
                  </div>
                </label>

                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={canUseDvr}
                    onChange={(e) => setCanUseDvr(e.target.checked)}
                    className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 bg-gray-900 border-gray-700"
                  />
                  <div>
                    <p className="text-sm font-semibold text-white">Allow DVR Recording</p>
                    <p className="text-xs text-gray-400">Can schedule and download television recordings</p>
                  </div>
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
                <button
                  type="button"
                  onClick={closeModal}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg text-xs font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow transition disabled:opacity-50"
                >
                  {createMutation.isPending || updateMutation.isPending
                    ? 'Saving...'
                    : editingUser
                    ? 'Save Changes'
                    : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
