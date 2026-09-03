import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiFetch } from '../../api/client';

interface DiagnosticsData {
  timestamp: string;
  uptimeSeconds: number;
  process: {
    pid: number;
    nodeVersion: string;
    memory: {
      rssMb: number;
      heapTotalMb: number;
      heapUsedMb: number;
      externalMb: number;
    };
  };
  system: {
    platform: string;
    arch: string;
    cpus: number;
    loadAverage: number[];
    totalMemoryMb: number;
    freeMemoryMb: number;
    memoryUsagePercent: number;
  };
  streaming: {
    activeFfmpegProcesses: number;
    activeRedirectStreams: number;
    streams: Array<{
      key: string;
      pid: number;
      startTime: string;
      references: number;
      lastAccess: string;
    }>;
  };
  storage: {
    liveM3uSizeFormatted: string;
    liveEpgSizeFormatted: string;
    databaseSizeFormatted: string;
  };
  databaseStats?: {
    moviesInDb: number;
    seriesInDb: number;
  };
}

export function DiagnosticsTab() {
  const [browserMem, setBrowserMem] = useState<string | null>(null);

  const { data: diag, isLoading, refetch, isFetching } = useQuery<DiagnosticsData>({
    queryKey: ['diagnostics'],
    queryFn: () => apiFetch<DiagnosticsData>('/api/diagnostics'),
    refetchInterval: 5000,
  });

  const dumpMutation = useMutation({
    mutationFn: () => apiFetch<{ success: true; filename: string; report: unknown }>('/api/diagnostics/dump', { method: 'POST' }),
    onSuccess: (res) => {
      // Trigger download of the JSON report in browser
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(res.report, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', dataStr);
      downloadAnchor.setAttribute('download', res.filename || 'diagnostic-report.json');
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    },
  });

  const checkBrowserMemory = () => {
    const perf = window.performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } };
    if (perf?.memory) {
      const usedMb = (perf.memory.usedJSHeapSize / 1024 / 1024).toFixed(1);
      const totalMb = (perf.memory.totalJSHeapSize / 1024 / 1024).toFixed(1);
      const limitMb = (perf.memory.jsHeapSizeLimit / 1024 / 1024).toFixed(1);
      setBrowserMem(`${usedMb} MB used / ${totalMb} MB allocated (Limit: ${limitMb} MB)`);
    } else {
      setBrowserMem('Browser performance.memory API not available in this browser.');
    }
  };

  const formatUptime = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${h}h ${m}m ${s}s`;
  };

  return (
    <div className="space-y-6">
      {/* Header with actions */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <span>System Diagnostics &amp; Resource Monitor</span>
            {isFetching && <span className="text-xs text-blue-400 animate-pulse">(Updating...)</span>}
          </h2>
          <p className="text-xs text-gray-400">
            Real-time memory, CPU load, and active FFmpeg stream metrics. Generates diagnostic reports for troubleshooting.
          </p>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => refetch()}
            className="px-3.5 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-xs font-semibold text-white transition"
          >
            Refresh Now
          </button>
          <button
            type="button"
            onClick={() => dumpMutation.mutate()}
            disabled={dumpMutation.isPending}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-xs font-semibold text-white transition shadow flex items-center gap-2"
          >
            {dumpMutation.isPending ? 'Generating Dump...' : 'Export Diagnostics (.json)'}
          </button>
        </div>
      </div>

      {isLoading || !diag ? (
        <div className="p-8 text-center text-gray-400">Loading system metrics...</div>
      ) : (
        <div className="space-y-6">
          {/* Top KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-gray-800/80 border border-gray-700/70 rounded-xl p-4 space-y-1">
              <span className="text-xs text-gray-400">Backend Heap Memory</span>
              <p className="text-xl font-bold text-emerald-400">{diag.process.memory.heapUsedMb} MB</p>
              <p className="text-xs text-gray-500">RSS: {diag.process.memory.rssMb} MB</p>
            </div>

            <div className="bg-gray-800/80 border border-gray-700/70 rounded-xl p-4 space-y-1">
              <span className="text-xs text-gray-400">Server RAM Usage</span>
              <p className="text-xl font-bold text-blue-400">{diag.system.memoryUsagePercent}%</p>
              <p className="text-xs text-gray-500">{diag.system.freeMemoryMb} MB free of {diag.system.totalMemoryMb} MB</p>
            </div>

            <div className="bg-gray-800/80 border border-gray-700/70 rounded-xl p-4 space-y-1">
              <span className="text-xs text-gray-400">Active Live Streams</span>
              <p className="text-xl font-bold text-amber-400">{diag.streaming.activeFfmpegProcesses}</p>
              <p className="text-xs text-gray-500">FFmpeg Transcoding</p>
            </div>

            <div className="bg-gray-800/80 border border-gray-700/70 rounded-xl p-4 space-y-1">
              <span className="text-xs text-gray-400">Process Uptime</span>
              <p className="text-xl font-bold text-purple-400">{formatUptime(diag.uptimeSeconds)}</p>
              <p className="text-xs text-gray-500">PID: {diag.process.pid} (Node {diag.process.nodeVersion})</p>
            </div>
          </div>

          {/* Browser Tab Memory Profiler */}
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-white">Browser Tab Memory (Chromium Renderer)</h3>
              <button
                type="button"
                onClick={checkBrowserMemory}
                className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs font-semibold text-white transition"
              >
                Inspect Browser Memory
              </button>
            </div>
            {browserMem ? (
              <p className="text-xs font-mono text-cyan-300 bg-gray-900/60 p-2.5 rounded border border-gray-800">
                {browserMem}
              </p>
            ) : (
              <p className="text-xs text-gray-500">
                Click &quot;Inspect Browser Memory&quot; to check the active memory heap of this tab in Edge / Chrome.
              </p>
            )}
          </div>

          {/* Storage & DB Stats */}
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-bold text-white">Storage &amp; Data Assets</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div className="bg-gray-900/50 p-3 rounded-lg border border-gray-800">
                <span className="text-gray-400">Live Channels M3U</span>
                <p className="text-sm font-bold text-white mt-1">{diag.storage.liveM3uSizeFormatted}</p>
              </div>
              <div className="bg-gray-900/50 p-3 rounded-lg border border-gray-800">
                <span className="text-gray-400">EPG Guide JSON</span>
                <p className="text-sm font-bold text-white mt-1">{diag.storage.liveEpgSizeFormatted}</p>
              </div>
              <div className="bg-gray-900/50 p-3 rounded-lg border border-gray-800">
                <span className="text-gray-400">Database (SQLite)</span>
                <p className="text-sm font-bold text-white mt-1">{diag.storage.databaseSizeFormatted}</p>
                {diag.databaseStats && (
                  <p className="text-gray-500 mt-0.5">{diag.databaseStats.moviesInDb} movies, {diag.databaseStats.seriesInDb} series</p>
                )}
              </div>
            </div>
          </div>

          {/* Active Streams Table */}
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-bold text-white">Active Transcoding Streams</h3>
            {diag.streaming.streams.length === 0 ? (
              <p className="text-xs text-gray-500 py-3">No active FFmpeg transcode processes currently running.</p>
            ) : (
              <div className="space-y-2">
                {diag.streaming.streams.map((s) => (
                  <div key={s.key} className="bg-gray-900/60 p-3 rounded-lg border border-gray-800 flex justify-between items-center text-xs">
                    <div className="space-y-1 min-w-0 flex-1 pr-4">
                      <p className="font-semibold text-white truncate">{s.key}</p>
                      <p className="text-gray-500">Started: {new Date(s.startTime).toLocaleTimeString()} | References: {s.references}</p>
                    </div>
                    <span className="px-2 py-0.5 rounded bg-blue-600/30 text-blue-300 font-mono text-[11px]">
                      PID: {s.pid}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
