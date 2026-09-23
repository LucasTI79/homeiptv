import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FiPlay, FiTrash2, FiStopCircle, FiX, FiCheck, FiClock
} from 'react-icons/fi';
import {
  useDvrJobs,
  useDvrRecordings,
  useDvrStorage,
  useCancelDvrJob,
  useStopDvrJob,
  useDeleteDvrHistory,
  useDeleteDvrRecording,
  useClearAllDvrJobs,
  useClearAllDvrRecordings,
} from '../../api/dvr';
import { useAuthStatus } from '../../api/auth';

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDuration(totalSeconds: number): string {
  if (!totalSeconds) return '0m';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  let result = '';
  if (hours > 0) result += `${hours}h `;
  if (minutes > 0) result += `${minutes}m`;
  return result.trim() || '0m';
}

export function DvrPage() {
  const [activeTab, setActiveTab] = useState<'scheduled' | 'completed'>('scheduled');
  const navigate = useNavigate();

  const { data: authStatus } = useAuthStatus();
  const isAdmin = authStatus?.isLoggedIn ? authStatus.user.isAdmin : false;
  const hasDvrPermission = isAdmin || (authStatus?.isLoggedIn ? authStatus.user.canUseDvr : false);

  const { data: jobs = [] } = useDvrJobs();
  const { data: recordings = [] } = useDvrRecordings();
  const { data: storage } = useDvrStorage();

  const cancelJob = useCancelDvrJob();
  const stopJob = useStopDvrJob();
  const deleteHistory = useDeleteDvrHistory();
  const deleteRecording = useDeleteDvrRecording();
  const clearJobs = useClearAllDvrJobs();
  const clearRecordings = useClearAllDvrRecordings();

  const handlePlayTimeshift = (jobId: number, title: string) => {
    const url = `/api/dvr/timeshift/${jobId}`;
    navigate(`/player?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title + ' (Recording...)')}&type=dvr`);
  };

  const handlePlayCompleted = (filename: string, title: string) => {
    const url = `/dvr/${filename}`;
    navigate(`/player?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}&type=dvr`);
  };

  const handleClearJobs = () => {
    if (window.confirm('Clear all jobs from history? (Files will not be deleted)')) {
      clearJobs.mutate();
    }
  };

  const handleClearRecordings = () => {
    if (window.confirm('Permanently delete all completed recordings?')) {
      clearRecordings.mutate();
    }
  };

  if (!hasDvrPermission) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        <h2 className="text-xl font-bold text-gray-400">DVR Access Denied</h2>
        <p className="text-gray-500 mt-2">You do not have permission to use the DVR features.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 bg-gray-900 overflow-y-auto">
      <div className="p-4 sm:p-6 max-w-7xl mx-auto w-full space-y-6">
        
        <div className="flex items-center justify-between border-b border-gray-700/50 pb-4">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            DVR
            {storage && (
              <span className="text-sm font-normal text-gray-400 mt-1">
                Storage Used
              </span>
            )}
          </h1>
        </div>

        {/* Storage Bar */}
        {storage && storage.total > 0 && (
          <div className="bg-gray-800/50 p-4 rounded-xl border border-gray-700/50">
            <div className="flex justify-between items-end mb-2">
              <span className="text-xs text-gray-400">
                {formatBytes(storage.used)} of {formatBytes(storage.total)} used
              </span>
              <span className="text-xs font-semibold text-gray-300">{storage.percentage}%</span>
            </div>
            <div className="h-2 w-full bg-gray-700 rounded-full overflow-hidden">
              <div 
                className={`h-full transition-all duration-500 ${
                  storage.percentage > 90 ? 'bg-rose-500' :
                  storage.percentage > 75 ? 'bg-yellow-500' : 'bg-blue-500'
                }`}
                style={{ width: `${Math.min(100, Math.max(0, storage.percentage))}%` }}
              />
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex space-x-1 border-b border-gray-700/50">
          <button
            onClick={() => setActiveTab('scheduled')}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
              activeTab === 'scheduled'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
            }`}
          >
            Scheduled ({jobs.length})
          </button>
          <button
            onClick={() => setActiveTab('completed')}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
              activeTab === 'completed'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
            }`}
          >
            Completed ({recordings.length})
          </button>
        </div>

        {/* Scheduled Tab Content */}
        {activeTab === 'scheduled' && (
          <div className="space-y-4">
            {jobs.length === 0 ? (
              <div className="bg-gray-800/40 border border-gray-700/50 rounded-xl p-10 flex flex-col items-center justify-center text-center max-w-xl mx-auto mt-8">
                <div className="w-12 h-12 bg-gray-700/50 rounded-lg flex items-center justify-center mb-4">
                  <FiClock className="w-6 h-6 text-gray-400" />
                </div>
                <h3 className="text-lg font-bold text-white mb-2">No Scheduled Recordings</h3>
                <p className="text-sm text-gray-400 mb-6 leading-relaxed">
                  You haven't scheduled any TV programs to record. Go to the TV Guide to schedule recordings.
                </p>
                <button
                  onClick={() => navigate('/')}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-semibold transition"
                >
                  Go to TV Guide
                </button>
              </div>
            ) : (
              <>
                <div className="flex justify-end">
                  <button
                    onClick={handleClearJobs}
                    className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-rose-500/20 text-gray-400 hover:text-rose-400 rounded-lg transition border border-gray-700 hover:border-rose-500/30"
                  >
                    Clear All
                  </button>
                </div>
                <div className="overflow-x-auto rounded-xl border border-gray-700/50 bg-gray-800/40">
                  <table className="w-full text-left text-sm text-gray-300">
                    <thead className="text-xs uppercase bg-gray-800/60 text-gray-400">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Program</th>
                        <th className="px-4 py-3 font-semibold">Channel</th>
                        {isAdmin && <th className="px-4 py-3 font-semibold">User</th>}
                        <th className="px-4 py-3 font-semibold">Start Time</th>
                        <th className="px-4 py-3 font-semibold">End Time</th>
                        <th className="px-4 py-3 font-semibold">Status</th>
                        <th className="px-4 py-3 font-semibold text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700/50">
                      {jobs.map((job) => (
                        <tr key={job.id} className="hover:bg-gray-700/20 transition-colors">
                          <td className="px-4 py-3 font-medium text-white max-w-[200px] truncate" title={job.programTitle}>
                            {job.programTitle}
                          </td>
                          <td className="px-4 py-3 text-gray-400 max-w-[150px] truncate" title={job.channelName}>
                            {job.channelName}
                          </td>
                          {isAdmin && (
                            <td className="px-4 py-3 text-gray-400 max-w-[120px] truncate" title={(job as any).username}>
                              {(job as any).username || 'N/A'}
                            </td>
                          )}
                          <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                            {new Date(job.startTime).toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                            {new Date(job.endTime).toLocaleString()}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                              job.status === 'recording' ? 'bg-red-500/20 text-red-400 border border-red-500/30' :
                              job.status === 'error' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' :
                              job.status === 'cancelled' ? 'bg-gray-600/30 text-gray-400 border border-gray-600/50' :
                              job.status === 'completed' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                              'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                            }`}>
                              {job.status}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-2">
                              {job.status === 'recording' && job.filePath?.endsWith('.ts') && (
                                <button
                                  onClick={() => handlePlayTimeshift(job.id, job.programTitle)}
                                  className="p-1.5 bg-blue-600/10 hover:bg-blue-600 text-blue-400 hover:text-white rounded transition"
                                  title="Play Recording (Timeshift)"
                                >
                                  <FiPlay className="w-4 h-4" />
                                </button>
                              )}
                              
                              {job.status === 'recording' && (
                                <button
                                  onClick={() => {
                                    if(window.confirm('Stop Recording?')) stopJob.mutate(job.id);
                                  }}
                                  className="p-1.5 bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white rounded transition"
                                  title="Stop Recording"
                                >
                                  <FiStopCircle className="w-4 h-4" />
                                </button>
                              )}
                              
                              {['error', 'cancelled', 'completed'].includes(job.status) ? (
                                <button
                                  onClick={() => {
                                    if(window.confirm('Remove from history?')) deleteHistory.mutate(job.id);
                                  }}
                                  className="p-1.5 bg-gray-700/50 hover:bg-rose-500/20 text-gray-400 hover:text-rose-400 rounded transition"
                                  title="Remove From History"
                                >
                                  <FiX className="w-4 h-4" />
                                </button>
                              ) : (
                                <button
                                  onClick={() => {
                                    if(window.confirm('Cancel Recording?')) cancelJob.mutate(job.id);
                                  }}
                                  className="p-1.5 bg-gray-700/50 hover:bg-rose-500/20 text-gray-400 hover:text-rose-400 rounded transition"
                                  title="Cancel Recording"
                                  disabled={job.status === 'recording'}
                                >
                                  <FiX className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {/* Completed Tab Content */}
        {activeTab === 'completed' && (
          <div className="space-y-4">
            {recordings.length === 0 ? (
              <div className="bg-gray-800/40 border border-gray-700/50 rounded-xl p-10 flex flex-col items-center justify-center text-center max-w-xl mx-auto mt-8">
                <div className="w-12 h-12 bg-gray-700/50 rounded-lg flex items-center justify-center mb-4">
                  <FiCheck className="w-6 h-6 text-gray-400" />
                </div>
                <h3 className="text-lg font-bold text-white mb-2">No Completed Recordings</h3>
                <p className="text-sm text-gray-400 mb-6 leading-relaxed">
                  Recordings that have finished successfully will appear here.
                </p>
              </div>
            ) : (
              <>
                <div className="flex justify-end">
                  <button
                    onClick={handleClearRecordings}
                    className="text-xs px-3 py-1.5 bg-gray-800 hover:bg-rose-500/20 text-gray-400 hover:text-rose-400 rounded-lg transition border border-gray-700 hover:border-rose-500/30"
                  >
                    Clear All
                  </button>
                </div>
                <div className="overflow-x-auto rounded-xl border border-gray-700/50 bg-gray-800/40">
                  <table className="w-full text-left text-sm text-gray-300">
                    <thead className="text-xs uppercase bg-gray-800/60 text-gray-400">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Program</th>
                        <th className="px-4 py-3 font-semibold">Channel</th>
                        {isAdmin && <th className="px-4 py-3 font-semibold">User</th>}
                        <th className="px-4 py-3 font-semibold">Recorded On</th>
                        <th className="px-4 py-3 font-semibold">Duration</th>
                        <th className="px-4 py-3 font-semibold">Size</th>
                        <th className="px-4 py-3 font-semibold text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700/50">
                      {recordings.map((rec) => (
                        <tr key={rec.id} className="hover:bg-gray-700/20 transition-colors">
                          <td className="px-4 py-3 font-medium text-white max-w-[200px] truncate" title={rec.programTitle}>
                            {rec.programTitle}
                          </td>
                          <td className="px-4 py-3 text-gray-400 max-w-[150px] truncate" title={rec.channelName}>
                            {rec.channelName}
                          </td>
                          {isAdmin && (
                            <td className="px-4 py-3 text-gray-400 max-w-[120px] truncate" title={rec.username}>
                              {rec.username || 'N/A'}
                            </td>
                          )}
                          <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                            {new Date(rec.startTime).toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-gray-400">
                            {formatDuration(rec.durationSeconds)}
                          </td>
                          <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                            {formatBytes(rec.fileSizeBytes)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => handlePlayCompleted(rec.filename, rec.programTitle)}
                                className="p-1.5 bg-blue-600/10 hover:bg-blue-600 text-blue-400 hover:text-white rounded transition"
                                title="Play Recording"
                              >
                                <FiPlay className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => {
                                  if(window.confirm('Permanently delete this recording?')) deleteRecording.mutate(rec.id);
                                }}
                                className="p-1.5 bg-gray-700/50 hover:bg-rose-500/20 text-gray-400 hover:text-rose-400 rounded transition"
                                title="Delete Recording"
                              >
                                <FiTrash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
