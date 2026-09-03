import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useSystemHealth, useAnalytics, useActivityData, useStopStream, useClearHistory, useDeleteHistoryEntry } from '../../api/admin';
import { GuideTour } from '../../components/ui/GuideTour';
import { Tooltip } from '../../components/ui/Tooltip';
import { EmptyState } from '../../components/ui/EmptyState';

// Form schema for filtering
const filterSchema = z.object({
  search: z.string().optional(),
  dateFilter: z.enum(['today', 'yesterday', 'last7days', 'last30days', 'custom']).default('today'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  pageSize: z.coerce.number().default(25),
}).refine(data => {
  if (data.dateFilter === 'custom' && (!data.startDate || !data.endDate)) {
    return false;
  }
  return true;
}, {
  message: "Start and end dates are required for custom filter",
  path: ["startDate"]
});

type FilterValues = z.infer<typeof filterSchema>;

export function AdminPage() {
  const [page, setPage] = useState(1);
  const { data: health } = useSystemHealth();
  const { data: analytics } = useAnalytics();
  
  const { register, watch } = useForm<FilterValues>({
    resolver: zodResolver(filterSchema) as Resolver<FilterValues>,
    defaultValues: {
      search: '',
      dateFilter: 'today',
      pageSize: 25,
    }
  });

  const filters = watch();
  
  const { data: activityData, isLoading: isLoadingActivity } = useActivityData({
    page,
    pageSize: filters.pageSize,
    search: filters.search,
    dateFilter: filters.dateFilter,
    startDate: filters.startDate,
    endDate: filters.endDate,
  });

  const stopStream = useStopStream();
  const clearHistoryMutation = useClearHistory();
  const deleteHistoryMutation = useDeleteHistoryEntry();
  const [showClearMenu, setShowClearMenu] = useState(false);

  const handleClearHistory = (days?: number) => {
    const msg = days
      ? `Are you sure you want to clear stream history older than ${days} days?`
      : 'Are you sure you want to clear ALL stream history? This cannot be undone.';
    if (window.confirm(msg)) {
      clearHistoryMutation.mutate(days);
      setShowClearMenu(false);
    }
  };

  return (
    <div className="p-4 md:p-6 h-[calc(100vh-60px)] overflow-y-auto">
      <GuideTour
        tourKey="admin-tour"
        steps={[
          { element: '#health-widgets', popover: { title: 'System Health', description: 'Monitor CPU, RAM, and Disk usage.' } },
          { element: '#live-activity', popover: { title: 'Live Streams', description: 'See who is currently watching.' } },
          { element: '#history-filters', popover: { title: 'Filters', description: 'Use these to search the watch history.' } },
        ]}
      />

      <h1 className="text-2xl font-bold mb-6">Activity &amp; Health</h1>

      {/* Health Widgets */}
      <div id="health-widgets" className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-gray-800 p-4 rounded-lg">
          <h3 className="text-gray-400 text-sm mb-2">CPU Load</h3>
          <p className="text-2xl font-mono">{health?.cpu.load || 0}%</p>
        </div>
        <div className="bg-gray-800 p-4 rounded-lg">
          <h3 className="text-gray-400 text-sm mb-2">RAM Usage</h3>
          <p className="text-2xl font-mono">{health?.memory.percent || 0}%</p>
        </div>
        <div className="bg-gray-800 p-4 rounded-lg">
          <h3 className="text-gray-400 text-sm mb-2">DVR Disk</h3>
          <p className="text-2xl font-mono">{health?.disks.dvr.percent || 0}%</p>
        </div>
      </div>

      {/* Analytics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <div className="bg-gray-800 p-4 rounded-lg">
          <h3 className="text-lg font-semibold mb-4 border-b border-gray-700 pb-2">Top Channels</h3>
          <ul className="space-y-2">
            {analytics?.topChannels.slice(0, 5).map(c => (
              <li key={c.channel_name} className="flex justify-between">
                <span>{c.channel_name}</span>
                <span className="text-gray-400">{Math.round(c.total_duration / 60)}m</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-gray-800 p-4 rounded-lg">
          <h3 className="text-lg font-semibold mb-4 border-b border-gray-700 pb-2">Top Users</h3>
          <ul className="space-y-2">
            {analytics?.topUsers.slice(0, 5).map(u => (
              <li key={u.username} className="flex justify-between">
                <span>{u.username}</span>
                <span className="text-gray-400">{Math.round(u.total_duration / 60)}m</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Live Activity */}
      <div id="live-activity" className="mb-8">
        <h3 className="text-xl font-semibold mb-4">Live Streams ({activityData?.live.length || 0})</h3>
        <div className="bg-gray-800 rounded-lg overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-700 text-gray-200">
              <tr>
                <th className="px-4 py-2">User</th>
                <th className="px-4 py-2">Channel</th>
                <th className="px-4 py-2">Started</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(!activityData?.live || activityData.live.length === 0) ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-500">No active streams</td></tr>
              ) : (
                activityData.live.map(stream => (
                  <tr key={stream.streamKey} className="border-b border-gray-700">
                    <td className="px-4 py-2">{stream.username}</td>
                    <td className="px-4 py-2">{stream.channelName}</td>
                    <td className="px-4 py-2">{new Date(stream.startTime).toLocaleTimeString()}</td>
                    <td className="px-4 py-2 text-right">
                      <Tooltip content="Stop Stream">
                        <button 
                          onClick={() => stopStream.mutate(stream.streamKey)}
                          className="text-red-400 hover:text-red-300"
                        >
                          Stop
                        </button>
                      </Tooltip>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Watch History */}
      <div>
        <div id="history-filters" className="flex flex-col md:flex-row gap-4 mb-4 items-end">
          <div>
            <h3 className="text-xl font-semibold">Watch History</h3>
            <p className="text-xs text-gray-400">Total records: {activityData?.history.totalItems || 0}</p>
          </div>
          <div className="flex-grow"></div>
          
          <input 
            type="text" 
            placeholder="Search User or Channel..." 
            {...register('search')}
            className="bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm"
          />
          
          <select {...register('dateFilter')} className="bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm">
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="last7days">Last 7 Days</option>
            <option value="last30days">Last 30 Days</option>
            <option value="all">All Time</option>
          </select>

          <select {...register('pageSize')} className="bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm">
            <option value="10">10 / page</option>
            <option value="25">25 / page</option>
            <option value="50">50 / page</option>
          </select>

          {/* Clear History Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowClearMenu(!showClearMenu)}
              className="px-3.5 py-1.5 bg-red-600/80 hover:bg-red-600 text-white rounded text-sm font-semibold transition"
            >
              Clear History ▾
            </button>
            {showClearMenu && (
              <div className="absolute right-0 mt-2 w-52 bg-gray-800 border border-gray-700 rounded-lg shadow-2xl py-1 z-30">
                <button
                  type="button"
                  onClick={() => handleClearHistory(30)}
                  className="w-full px-4 py-2 text-left text-xs text-gray-200 hover:bg-gray-700"
                >
                  Clear older than 30 days
                </button>
                <button
                  type="button"
                  onClick={() => handleClearHistory(7)}
                  className="w-full px-4 py-2 text-left text-xs text-gray-200 hover:bg-gray-700"
                >
                  Clear older than 7 days
                </button>
                <div className="border-t border-gray-700 my-1"></div>
                <button
                  type="button"
                  onClick={() => handleClearHistory()}
                  className="w-full px-4 py-2 text-left text-xs text-red-400 hover:bg-red-950 font-semibold"
                >
                  Clear ALL History
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="bg-gray-800 rounded-lg overflow-x-auto">
          {isLoadingActivity ? (
            <div className="p-8 text-center text-gray-400">Loading history...</div>
          ) : (!activityData?.history.items || activityData.history.items.length === 0) ? (
            <EmptyState
              icon="📜"
              title="No Watch History Found"
              description="No stream activity matches your search or date filter."
              instructions={[
                "Watch live streams in the Player or Multiview to generate activity history.",
                "Change or reset your filter above to 'All Time'."
              ]}
            />
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-700 text-gray-200">
                <tr>
                  <th className="px-4 py-2">User</th>
                  <th className="px-4 py-2">Channel</th>
                  <th className="px-4 py-2">IP Address</th>
                  <th className="px-4 py-2">Profile</th>
                  <th className="px-4 py-2">Start Time</th>
                  <th className="px-4 py-2">Duration</th>
                  <th className="px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {activityData.history.items.map((entry, idx) => (
                  <tr key={entry.id || idx} className="border-b border-gray-700 hover:bg-gray-750">
                    <td className="px-4 py-2 font-medium">{entry.username}</td>
                    <td className="px-4 py-2">{entry.channel_name}</td>
                    <td className="px-4 py-2 font-mono text-xs text-gray-400">{entry.client_ip || '-'}</td>
                    <td className="px-4 py-2 text-xs text-gray-400">{entry.stream_profile_name || '-'}</td>
                    <td className="px-4 py-2">{new Date(entry.start_time).toLocaleString()}</td>
                    <td className="px-4 py-2">{Math.round(entry.duration_seconds / 60)}m</td>
                    <td className="px-4 py-2 text-right">
                      {entry.id && (
                        <button
                          type="button"
                          onClick={() => deleteHistoryMutation.mutate(entry.id!)}
                          className="text-gray-500 hover:text-red-400 text-xs px-2 py-1 rounded transition"
                          title="Delete entry"
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        
        {/* Simple Pagination */}
        {activityData?.history && activityData.history.totalPages > 1 && (
          <div className="mt-4 flex justify-end gap-2">
            <button 
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
              className="px-3 py-1 bg-gray-800 rounded disabled:opacity-50"
            >
              Prev
            </button>
            <span className="px-3 py-1 text-sm">Page {page} of {activityData.history.totalPages}</span>
            <button 
              disabled={page === activityData.history.totalPages}
              onClick={() => setPage(p => p + 1)}
              className="px-3 py-1 bg-gray-800 rounded disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}
      </div>

    </div>
  );
}
