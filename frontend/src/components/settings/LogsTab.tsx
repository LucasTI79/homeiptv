import React from 'react';
import type { UseFormRegister } from 'react-hook-form';
import { useLogInfo, useCleanupLogs } from '../../api/logs';
import { toast } from 'react-hot-toast';
import { FiDownload, FiTrash2, FiFileText, FiHardDrive } from 'react-icons/fi';

interface LogsTabProps {
  register: UseFormRegister<any>;
}

export const LogsTab: React.FC<LogsTabProps> = ({ register }) => {
  const { data: logInfo, isLoading, refetch } = useLogInfo();
  const cleanupMutation = useCleanupLogs();

  const handleCleanup = () => {
    if (window.confirm('Are you sure you want to clear all server log files? This cannot be undone.')) {
      cleanupMutation.mutate(undefined, {
        onSuccess: (res) => {
          toast.success(`Cleared ${res.deletedCount} log file(s).`);
          refetch();
        },
        onError: () => {
          toast.error('Failed to clear log files.');
        },
      });
    }
  };

  const formattedTotalSize = logInfo?.totalSize
    ? `${(logInfo.totalSize / (1024 * 1024)).toFixed(2)} MB`
    : '0 MB';

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Log Stats & Actions Card */}
      <div className="bg-gray-800 border border-gray-700/80 p-5 rounded-xl shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 mb-4 border-b border-gray-700/60 gap-3">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <FiFileText className="text-blue-400 w-5 h-5" /> Server Logs &amp; Audit
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Monitor active system output, download diagnostic reports or wipe historical logs.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href="/api/logs/download"
              download
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow transition flex items-center gap-1.5"
            >
              <FiDownload className="w-3.5 h-3.5" /> Download All Logs
            </a>
            <button
              type="button"
              onClick={handleCleanup}
              disabled={cleanupMutation.isPending || !logInfo?.fileCount}
              className="px-3 py-1.5 bg-gray-700 hover:bg-red-600/80 text-gray-300 hover:text-white rounded-lg text-xs font-semibold transition flex items-center gap-1.5 disabled:opacity-50"
            >
              <FiTrash2 className="w-3.5 h-3.5" /> Clear Logs
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-gray-900/60 border border-gray-700/50 rounded-xl p-3">
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Log Files</span>
            <p className="text-lg font-bold text-white mt-0.5">
              {isLoading ? '...' : logInfo?.fileCount || 0}
            </p>
          </div>
          <div className="bg-gray-900/60 border border-gray-700/50 rounded-xl p-3">
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1">
              <FiHardDrive className="w-3 h-3 text-blue-400" /> Disk Usage
            </span>
            <p className="text-lg font-bold text-white mt-0.5">
              {isLoading ? '...' : formattedTotalSize}
            </p>
          </div>
          <div className="bg-gray-900/60 border border-gray-700/50 rounded-xl p-3">
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Oldest Record</span>
            <p className="text-xs font-medium text-gray-300 mt-1.5 truncate" title={logInfo?.oldestDate ? new Date(logInfo.oldestDate).toLocaleString() : 'None'}>
              {logInfo?.oldestDate ? new Date(logInfo.oldestDate).toLocaleDateString() : 'N/A'}
            </p>
          </div>
        </div>
      </div>

      {/* Log Configuration Preferences Form */}
      <div className="bg-gray-800 border border-gray-700/80 p-5 rounded-xl shadow-lg space-y-4">
        <h2 className="text-base font-bold text-white pb-2 border-b border-gray-700/60">
          Logging Verbosity &amp; Retention Rules
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Player Log Level</label>
            <select
              {...register('playerLogLevel')}
              className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white w-full focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="debug">Debug (Extensive)</option>
              <option value="info">Info (Standard)</option>
              <option value="warning">Warning (Recommended)</option>
              <option value="error">Error (Minimal)</option>
            </select>
            <p className="text-[11px] text-gray-500 mt-1">Controls verbosity of FFmpeg transcoding output.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">DVR Log Level</label>
            <select
              {...register('dvrLogLevel')}
              className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white w-full focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="debug">Debug (Extensive)</option>
              <option value="info">Info (Standard)</option>
              <option value="warning">Warning (Recommended)</option>
              <option value="error">Error (Minimal)</option>
            </select>
            <p className="text-[11px] text-gray-500 mt-1">Controls output level for background recordings.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Max Log Files Rotated</label>
            <input
              type="number"
              min="1"
              max="50"
              {...register('logs.maxFiles')}
              className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white w-full focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Auto-Delete Logs (Days, 0 = keep forever)</label>
            <input
              type="number"
              min="0"
              max="365"
              {...register('logs.autoDeleteDays')}
              className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white w-full focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
