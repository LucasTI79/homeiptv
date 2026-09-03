import { useState } from 'react';
import type { M3uSource, EpgSource, Settings } from '@homeiptv/shared-types';
import { useToggleSourceActive, useDeleteSource, useProcessSources } from '../../api/sources';
import { SourceModal } from './SourceModal';

interface SourcesTabProps {
  settings?: Settings;
}

export function SourcesTab({ settings }: SourcesTabProps) {
  const toggleActiveMutation = useToggleSourceActive();
  const deleteMutation = useDeleteSource();
  const processMutation = useProcessSources();

  const [modalConfig, setModalConfig] = useState<{
    isOpen: boolean;
    sourceType: 'm3u' | 'epg';
    initialSource?: M3uSource | EpgSource | null;
  }>({
    isOpen: false,
    sourceType: 'm3u',
    initialSource: null,
  });

  const [deleteConfirm, setDeleteConfirm] = useState<{
    isOpen: boolean;
    sourceType: 'm3u' | 'epg';
    source: M3uSource | EpgSource | null;
  }>({
    isOpen: false,
    sourceType: 'm3u',
    source: null,
  });

  const m3uSources = settings?.m3uSources || [];
  const epgSources = settings?.epgSources || [];

  const handleToggle = (sourceType: 'm3u' | 'epg', source: M3uSource | EpgSource) => {
    toggleActiveMutation.mutate({
      sourceType,
      id: source.id,
      isActive: !source.isActive,
    });
  };

  const handleDelete = () => {
    if (!deleteConfirm.source) return;
    deleteMutation.mutate(
      {
        sourceType: deleteConfirm.sourceType,
        id: deleteConfirm.source.id,
      },
      {
        onSuccess: () => {
          setDeleteConfirm({ isOpen: false, sourceType: 'm3u', source: null });
        },
      }
    );
  };

  const formatSourceTypeBadge = (source: M3uSource | EpgSource) => {
    if (source.type === 'xc') {
      return <span className="px-2 py-0.5 text-xs font-semibold rounded bg-purple-600/30 text-purple-300 border border-purple-500/40">Xtream Codes</span>;
    }
    if (source.type === 'file') {
      return <span className="px-2 py-0.5 text-xs font-semibold rounded bg-amber-600/30 text-amber-300 border border-amber-500/40">Local File</span>;
    }
    return <span className="px-2 py-0.5 text-xs font-semibold rounded bg-blue-600/30 text-blue-300 border border-blue-500/40">URL Link</span>;
  };

  const formatStatusBadge = (status?: string) => {
    const s = (status || 'Pending').toLowerCase();
    if (s === 'success' || s === 'active') {
      return <span className="px-2 py-0.5 text-xs font-semibold rounded bg-emerald-600/30 text-emerald-300">Ready</span>;
    }
    if (s === 'error') {
      return <span className="px-2 py-0.5 text-xs font-semibold rounded bg-red-600/30 text-red-300">Error</span>;
    }
    return <span className="px-2 py-0.5 text-xs font-semibold rounded bg-gray-600/30 text-gray-400">Pending</span>;
  };

  return (
    <div className="space-y-8">
      {/* Top Banner & Sync Controls */}
      <div className="bg-gray-800/80 border border-gray-700/80 rounded-xl p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-white">Source Manager</h2>
          <p className="text-sm text-gray-400">
            Configure your IPTV playlists (M3U / Xtream Codes) and EPG XMLTV guides. Click &quot;Sync &amp; Process&quot; to fetch and reload all channels.
          </p>
          {settings?.sourcesLastUpdated && (
            <p className="text-xs text-gray-500 mt-1">
              Last synced: {new Date(settings.sourcesLastUpdated).toLocaleString()}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setModalConfig({ isOpen: true, sourceType: 'm3u', initialSource: null })}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-semibold text-white transition shadow flex items-center gap-2"
          >
            <span>+</span> Add Playlist / Xtream
          </button>
          <button
            type="button"
            onClick={() => setModalConfig({ isOpen: true, sourceType: 'epg', initialSource: null })}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-semibold text-white transition border border-gray-600 flex items-center gap-2"
          >
            <span>+</span> Add EPG Guide
          </button>
          <button
            type="button"
            onClick={() => processMutation.mutate()}
            disabled={processMutation.isPending}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-lg text-sm font-semibold text-white transition shadow flex items-center gap-2"
          >
            {processMutation.isPending ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                </svg>
                <span>Processing...</span>
              </>
            ) : (
              <>
                <span>⟳</span> Sync &amp; Process All
              </>
            )}
          </button>
        </div>
      </div>

      {/* M3U & Xtream Codes Playlists */}
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 space-y-4">
        <div className="flex justify-between items-center border-b border-gray-700 pb-3">
          <div className="flex items-center gap-3">
            <h3 className="text-md font-bold text-white">M3U &amp; Xtream Codes Playlists</h3>
            <span className="text-xs bg-gray-700 px-2 py-0.5 rounded-full text-gray-300 font-medium">
              {m3uSources.length}
            </span>
          </div>
        </div>

        {m3uSources.length === 0 ? (
          <div className="py-8 text-center text-gray-500 space-y-3">
            <p>No IPTV playlist sources configured yet.</p>
            <button
              type="button"
              onClick={() => setModalConfig({ isOpen: true, sourceType: 'm3u', initialSource: null })}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-xs font-semibold text-white transition"
            >
              Add your first playlist
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {m3uSources.map((source) => (
              <div
                key={source.id}
                className="bg-gray-900/60 border border-gray-700/60 hover:border-gray-600 rounded-lg p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 transition"
              >
                <div className="space-y-1.5 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="font-semibold text-white text-base truncate">{source.name}</h4>
                    {formatSourceTypeBadge(source)}
                    {formatStatusBadge(source.status)}
                    {!source.isActive && (
                      <span className="px-2 py-0.5 text-xs font-medium rounded bg-gray-700 text-gray-400">
                        Disabled
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 font-mono truncate max-w-xl">
                    {source.type === 'xc' ? (
                      `Server: ${source.path}`
                    ) : (
                      source.path
                    )}
                  </p>
                  {source.statusMessage && (
                    <p className="text-xs text-gray-500 italic truncate">{source.statusMessage}</p>
                  )}
                </div>

                <div className="flex items-center gap-3 shrink-0 self-end md:self-center">
                  <label className="relative inline-flex items-center cursor-pointer" title="Enable/Disable">
                    <input
                      type="checkbox"
                      checked={source.isActive}
                      onChange={() => handleToggle('m3u', source)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>

                  <button
                    type="button"
                    onClick={() => setModalConfig({ isOpen: true, sourceType: 'm3u', initialSource: source })}
                    className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-xs font-medium text-white rounded transition"
                  >
                    Edit
                  </button>

                  <button
                    type="button"
                    onClick={() => setDeleteConfirm({ isOpen: true, sourceType: 'm3u', source })}
                    className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/40 text-red-300 text-xs font-medium rounded border border-red-500/30 transition"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* EPG Sources */}
      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 space-y-4">
        <div className="flex justify-between items-center border-b border-gray-700 pb-3">
          <div className="flex items-center gap-3">
            <h3 className="text-md font-bold text-white">EPG (XMLTV) Program Guides</h3>
            <span className="text-xs bg-gray-700 px-2 py-0.5 rounded-full text-gray-300 font-medium">
              {epgSources.length}
            </span>
          </div>
        </div>

        {epgSources.length === 0 ? (
          <div className="py-8 text-center text-gray-500 space-y-3">
            <p>No external EPG guides configured.</p>
            <button
              type="button"
              onClick={() => setModalConfig({ isOpen: true, sourceType: 'epg', initialSource: null })}
              className="px-4 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-xs font-semibold text-white transition"
            >
              Add an EPG Guide
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {epgSources.map((source) => (
              <div
                key={source.id}
                className="bg-gray-900/60 border border-gray-700/60 hover:border-gray-600 rounded-lg p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 transition"
              >
                <div className="space-y-1.5 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="font-semibold text-white text-base truncate">{source.name}</h4>
                    {formatSourceTypeBadge(source)}
                    {formatStatusBadge(source.status)}
                    {source.isXcEpg && (
                      <span className="px-2 py-0.5 text-xs font-medium rounded bg-purple-900/40 text-purple-300 border border-purple-700/40">
                        Auto-Managed by XC
                      </span>
                    )}
                    {!source.isActive && (
                      <span className="px-2 py-0.5 text-xs font-medium rounded bg-gray-700 text-gray-400">
                        Disabled
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 font-mono truncate max-w-xl">{source.path}</p>
                  {source.statusMessage && (
                    <p className="text-xs text-gray-500 italic truncate">{source.statusMessage}</p>
                  )}
                </div>

                <div className="flex items-center gap-3 shrink-0 self-end md:self-center">
                  <label className="relative inline-flex items-center cursor-pointer" title="Enable/Disable">
                    <input
                      type="checkbox"
                      checked={source.isActive}
                      onChange={() => handleToggle('epg', source)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>

                  <button
                    type="button"
                    onClick={() => setModalConfig({ isOpen: true, sourceType: 'epg', initialSource: source })}
                    className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-xs font-medium text-white rounded transition"
                  >
                    Edit
                  </button>

                  <button
                    type="button"
                    onClick={() => setDeleteConfirm({ isOpen: true, sourceType: 'epg', source })}
                    className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/40 text-red-300 text-xs font-medium rounded border border-red-500/30 transition"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add / Edit Source Modal */}
      <SourceModal
        isOpen={modalConfig.isOpen}
        sourceType={modalConfig.sourceType}
        initialSource={modalConfig.initialSource}
        onClose={() => setModalConfig({ isOpen: false, sourceType: 'm3u', initialSource: null })}
      />

      {/* Delete Confirmation Modal */}
      {deleteConfirm.isOpen && deleteConfirm.source && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 border border-gray-700 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-lg font-bold text-white">Delete Source</h3>
            <p className="text-sm text-gray-300">
              Are you sure you want to delete <span className="font-semibold text-white">&quot;{deleteConfirm.source.name}&quot;</span>?
              {deleteConfirm.source.type === 'xc' && (
                <span className="block text-xs text-amber-400 mt-2">
                  Note: Associated automatic EPG and synced VOD records for this Xtream Codes provider will also be removed.
                </span>
              )}
            </p>
            <div className="flex justify-end gap-3 pt-3 border-t border-gray-700">
              <button
                type="button"
                onClick={() => setDeleteConfirm({ isOpen: false, sourceType: 'm3u', source: null })}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-md text-sm font-semibold text-white transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 rounded-md text-sm font-semibold text-white transition shadow"
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
