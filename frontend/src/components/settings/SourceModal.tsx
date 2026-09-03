import { useState, useEffect } from 'react';
import type { M3uSource, EpgSource } from '@homeiptv/shared-types';
import { useSaveSource } from '../../api/sources';

interface SourceModalProps {
  sourceType: 'm3u' | 'epg';
  initialSource?: M3uSource | EpgSource | null;
  isOpen: boolean;
  onClose: () => void;
}

export function SourceModal({ sourceType, initialSource, isOpen, onClose }: SourceModalProps) {
  const saveMutation = useSaveSource();

  const [inputFormat, setInputFormat] = useState<'xc' | 'url' | 'file'>('url');
  const [name, setName] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [refreshHours, setRefreshHours] = useState(24);
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);

  // XC fields
  const [xcServer, setXcServer] = useState('');
  const [xcUsername, setXcUsername] = useState('');
  const [xcPassword, setXcPassword] = useState('');

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialSource) {
      setName(initialSource.name || '');
      setIsActive(initialSource.isActive ?? true);
      setRefreshHours(initialSource.refreshHours ?? 24);

      if (initialSource.type === 'xc' && (initialSource as M3uSource).xc_data) {
        setInputFormat('xc');
        try {
          const xcData = JSON.parse((initialSource as M3uSource).xc_data as string);
          setXcServer(xcData.server || '');
          setXcUsername(xcData.username || '');
          setXcPassword(xcData.password || '');
        } catch {
          // ignore parse error
        }
      } else if (initialSource.type === 'file') {
        setInputFormat('file');
        setUrl('');
      } else {
        setInputFormat('url');
        setUrl(initialSource.path || '');
      }
    } else {
      setName('');
      setIsActive(true);
      setRefreshHours(24);
      setUrl('');
      setFile(null);
      setXcServer('');
      setXcUsername('');
      setXcPassword('');
      setInputFormat(sourceType === 'm3u' ? 'xc' : 'url');
    }
    setError(null);
  }, [initialSource, sourceType, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError('Please provide a name for this source.');
      return;
    }

    if (inputFormat === 'xc') {
      if (!xcServer.trim() || !xcUsername.trim() || !xcPassword.trim()) {
        setError('Server URL, Username, and Password are all required for Xtream Codes.');
        return;
      }
    } else if (inputFormat === 'url') {
      if (!url.trim()) {
        setError('Please provide a valid URL.');
        return;
      }
    } else if (inputFormat === 'file' && !initialSource && !file) {
      setError('Please choose a file to upload.');
      return;
    }

    saveMutation.mutate(
      {
        sourceType,
        id: initialSource?.id,
        name: name.trim(),
        isActive,
        refreshHours,
        type: inputFormat,
        url: url.trim(),
        sourceFile: file,
        xcServer: xcServer.trim(),
        xcUsername: xcUsername.trim(),
        xcPassword: xcPassword.trim(),
      },
      {
        onSuccess: () => {
          onClose();
        },
        onError: (err: unknown) => {
          setError(err instanceof Error ? err.message : 'Failed to save source.');
        },
      }
    );
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-gray-800 border border-gray-700 rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-5 my-8">
        <div className="flex justify-between items-center border-b border-gray-700 pb-3">
          <h2 className="text-xl font-bold text-white">
            {initialSource ? 'Edit' : 'Add'}{' '}
            {sourceType === 'm3u' ? 'M3U / Xtream Playlist' : 'EPG (XMLTV) Source'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl leading-none"
          >
            &times;
          </button>
        </div>

        {error && (
          <div className="bg-red-500/20 border border-red-500 text-red-300 px-4 py-2 rounded text-sm">
            {error}
          </div>
        )}

        {/* Format Selector Tabs */}
        <div className="flex gap-2 bg-gray-900/60 p-1.5 rounded-lg border border-gray-700/60">
          {sourceType === 'm3u' && (
            <button
              type="button"
              onClick={() => setInputFormat('xc')}
              className={`flex-1 py-1.5 px-3 rounded-md text-sm font-semibold transition ${
                inputFormat === 'xc'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Xtream Codes (XC)
            </button>
          )}
          <button
            type="button"
            onClick={() => setInputFormat('url')}
            className={`flex-1 py-1.5 px-3 rounded-md text-sm font-semibold transition ${
              inputFormat === 'url'
                ? 'bg-blue-600 text-white shadow'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            {sourceType === 'm3u' ? 'M3U / M3U8 URL' : 'XMLTV URL'}
          </button>
          <button
            type="button"
            onClick={() => setInputFormat('file')}
            className={`flex-1 py-1.5 px-3 rounded-md text-sm font-semibold transition ${
              inputFormat === 'file'
                ? 'bg-blue-600 text-white shadow'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            File Upload
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Source Name / Label <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              placeholder="e.g. My Provider, Brasil TV, EPG Principal"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-md px-3 py-2 text-sm text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 outline-none"
              required
            />
          </div>

          {inputFormat === 'xc' && (
            <div className="space-y-3 bg-gray-900/40 p-4 rounded-lg border border-gray-700/50">
              <h3 className="text-xs font-semibold text-blue-400 uppercase tracking-wider">
                Xtream Codes Credentials
              </h3>
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">
                  Server URL (with port) <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  placeholder="http://example.com:8080"
                  value={xcServer}
                  onChange={(e) => setXcServer(e.target.value)}
                  className="w-full bg-gray-900 border border-gray-700 rounded-md px-3 py-2 text-sm text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">
                    Username <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Username"
                    value={xcUsername}
                    onChange={(e) => setXcUsername(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-700 rounded-md px-3 py-2 text-sm text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1">
                    Password <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="password"
                    placeholder="Password"
                    value={xcPassword}
                    onChange={(e) => setXcPassword(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-700 rounded-md px-3 py-2 text-sm text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500">
                Live streams and matching EPG will automatically be configured from this account.
              </p>
            </div>
          )}

          {inputFormat === 'url' && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Direct URL <span className="text-red-400">*</span>
              </label>
              <input
                type="url"
                placeholder={
                  sourceType === 'm3u'
                    ? 'https://example.com/playlist.m3u'
                    : 'https://example.com/epg.xml.gz'
                }
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-md px-3 py-2 text-sm text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <p className="text-xs text-gray-500 mt-1">
                {sourceType === 'm3u'
                  ? 'Supports standard .m3u, .m3u8 URLs.'
                  : 'Supports XMLTV .xml and compressed .xml.gz files.'}
              </p>
            </div>
          )}

          {inputFormat === 'file' && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Upload File {initialSource ? '(Leave empty to keep existing)' : <span className="text-red-400">*</span>}
              </label>
              <input
                type="file"
                accept={sourceType === 'm3u' ? '.m3u,.m3u8' : '.xml,.gz'}
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="w-full bg-gray-900 border border-gray-700 rounded-md px-3 py-2 text-sm text-gray-300 file:mr-3 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-500 cursor-pointer"
              />
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Auto-Refresh Interval
              </label>
              <select
                value={refreshHours}
                onChange={(e) => setRefreshHours(Number(e.target.value))}
                className="w-full bg-gray-900 border border-gray-700 rounded-md px-3 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500 outline-none"
              >
                <option value={0}>Manual Only (No Auto-Refresh)</option>
                <option value={6}>Every 6 Hours</option>
                <option value={12}>Every 12 Hours</option>
                <option value={24}>Every 24 Hours (Daily)</option>
                <option value={48}>Every 48 Hours</option>
              </select>
            </div>

            <div className="flex items-center gap-3 pt-6">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                <span className="ml-3 text-sm font-medium text-gray-300">
                  {isActive ? 'Source Enabled' : 'Disabled'}
                </span>
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-md text-sm font-semibold text-white transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saveMutation.isPending}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-md text-sm font-semibold text-white transition shadow"
            >
              {saveMutation.isPending ? 'Saving...' : initialSource ? 'Update Source' : 'Save Source'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
