import React, { useState } from 'react';
import type { Settings, StreamProfile, CastProfile } from '@homeiptv/shared-types';
import { useSaveGlobalSettings, useHardwareInfo } from '../../api/settings';
import { toast } from 'react-hot-toast';
import { FiCpu, FiTv, FiCast, FiCheck, FiRefreshCw, FiZap } from 'react-icons/fi';
import { SiAmd, SiNvidia, SiIntel } from 'react-icons/si';

interface ProfilesTabProps {
  settings?: Settings;
}

export const ProfilesTab: React.FC<ProfilesTabProps> = ({ settings }) => {
  const { data: hardware, refetch: refetchHw, isFetching: isHwLoading } = useHardwareInfo();
  const saveMutation = useSaveGlobalSettings();

  const [activeStreamProfileId, setActiveStreamProfileId] = useState<string>(
    settings?.activeStreamProfileId || 'redirect'
  );
  const [activeCastProfileId, setActiveCastProfileId] = useState<string>(
    settings?.activeCastProfileId || 'cast-default'
  );

  const handleSaveActiveProfiles = () => {
    saveMutation.mutate(
      {
        activeStreamProfileId,
        activeCastProfileId,
      },
      {
        onSuccess: () => {
          toast.success('Hardware profiles updated successfully!');
        },
        onError: () => {
          toast.error('Failed to save profile settings.');
        },
      }
    );
  };

  const streamProfiles: StreamProfile[] = settings?.streamProfiles || [];
  const castProfiles: CastProfile[] = settings?.castProfiles || [];

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Hardware Detection Card */}
      <div className="bg-gray-800 border border-gray-700/80 p-5 rounded-xl shadow-lg">
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-gray-700/60">
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-lg bg-blue-500/20 text-blue-400">
              <FiZap className="w-5 h-5" />
            </span>
            <div>
              <h2 className="text-base font-bold text-white">Detected Hardware &amp; Acceleration</h2>
              <p className="text-xs text-gray-400">Hardware capabilities detected by the host system and FFmpeg</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => refetchHw()}
            disabled={isHwLoading}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg text-xs font-semibold transition flex items-center gap-1.5"
          >
            <FiRefreshCw className={`w-3.5 h-3.5 ${isHwLoading ? 'animate-spin' : ''}`} />
            Re-scan
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {/* CPU Card */}
          <div className="bg-gray-900/70 border border-gray-700/50 rounded-xl p-3.5 flex items-start gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400 shrink-0">
              <FiCpu className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Host Processor</span>
              <p className="text-sm font-bold text-white truncate mt-0.5" title={hardware?.cpu || 'Detecting...'}>
                {hardware?.cpu || 'Generic CPU'}
              </p>
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 mt-1 font-medium">
                <FiCheck className="w-3 h-3" /> Software Transcoding (CPU) Ready
              </span>
            </div>
          </div>

          {/* AMD Radeon Card */}
          <div className={`border rounded-xl p-3.5 flex items-start gap-3 transition ${
            hardware?.radeon_vaapi
              ? 'bg-rose-950/20 border-rose-500/40'
              : 'bg-gray-900/40 border-gray-800'
          }`}>
            <div className={`p-2 rounded-lg shrink-0 ${hardware?.radeon_vaapi ? 'bg-rose-500/20 text-rose-400' : 'bg-gray-800 text-gray-500'}`}>
              <SiAmd className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">AMD Radeon VA-API</span>
              <p className="text-sm font-bold text-white truncate mt-0.5">
                {hardware?.radeon_vaapi || 'Not detected'}
              </p>
              {hardware?.radeon_vaapi ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-rose-400 mt-1 font-semibold">
                  <FiCheck className="w-3 h-3" /> Hardware Acceleration (VAAPI) Active
                </span>
              ) : (
                <span className="text-[11px] text-gray-500 mt-1 block">VAAPI device node not available</span>
              )}
            </div>
          </div>

          {/* NVIDIA Card */}
          <div className={`border rounded-xl p-3.5 flex items-start gap-3 transition ${
            hardware?.nvidia
              ? 'bg-green-950/20 border-green-500/40'
              : 'bg-gray-900/40 border-gray-800'
          }`}>
            <div className={`p-2 rounded-lg shrink-0 ${hardware?.nvidia ? 'bg-green-500/20 text-green-400' : 'bg-gray-800 text-gray-500'}`}>
              <SiNvidia className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">NVIDIA NVENC</span>
              <p className="text-sm font-bold text-white truncate mt-0.5">
                {hardware?.nvidia || 'Not detected'}
              </p>
              {hardware?.nvidia ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-green-400 mt-1 font-semibold">
                  <FiCheck className="w-3 h-3" /> NVENC Ready
                </span>
              ) : (
                <span className="text-[11px] text-gray-500 mt-1 block">No NVIDIA driver detected</span>
              )}
            </div>
          </div>

          {/* Intel Card */}
          <div className={`border rounded-xl p-3.5 flex items-start gap-3 transition ${
            hardware?.intel_qsv || hardware?.intel_vaapi
              ? 'bg-blue-950/20 border-blue-500/40'
              : 'bg-gray-900/40 border-gray-800'
          }`}>
            <div className={`p-2 rounded-lg shrink-0 ${hardware?.intel_qsv || hardware?.intel_vaapi ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-800 text-gray-500'}`}>
              <SiIntel className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Intel QSV / VA-API</span>
              <p className="text-sm font-bold text-white truncate mt-0.5">
                {hardware?.intel_qsv || hardware?.intel_vaapi || 'Not detected'}
              </p>
              {hardware?.intel_qsv || hardware?.intel_vaapi ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-blue-400 mt-1 font-semibold">
                  <FiCheck className="w-3 h-3" /> QuickSync Ready
                </span>
              ) : (
                <span className="text-[11px] text-gray-500 mt-1 block">No Intel iGPU detected</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Active Profiles Selector Card */}
      <div className="bg-gray-800 border border-gray-700/80 p-5 rounded-xl shadow-lg space-y-5">
        <h2 className="text-base font-bold text-white pb-2 border-b border-gray-700/60">
          Active Streaming &amp; Cast Configuration
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Active Player Profile */}
          <div>
            <label className="text-sm font-semibold text-gray-200 flex items-center gap-2 mb-1.5">
              <FiTv className="text-blue-400 w-4 h-4" /> Web / Player Profile
            </label>
            <p className="text-xs text-gray-400 mb-2">
              Determines how streams are handled when watching directly in the browser.
            </p>
            <select
              value={activeStreamProfileId}
              onChange={(e) => setActiveStreamProfileId(e.target.value)}
              className="bg-gray-900 border border-gray-700 rounded-lg px-3.5 py-2.5 text-sm text-white w-full focus:ring-2 focus:ring-blue-500 outline-none"
            >
              {streamProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.id === 'redirect' ? '(Recommended - Direct)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Active Cast Profile */}
          <div>
            <label className="text-sm font-semibold text-gray-200 flex items-center gap-2 mb-1.5">
              <FiCast className="text-blue-400 w-4 h-4" /> Chromecast / TV Profile
            </label>
            <p className="text-xs text-gray-400 mb-2">
              Used when casting to Chromecast/Smart TVs (fMP4 container with auto-reconnect).
            </p>
            <select
              value={activeCastProfileId}
              onChange={(e) => setActiveCastProfileId(e.target.value)}
              className="bg-gray-900 border border-gray-700 rounded-lg px-3.5 py-2.5 text-sm text-white w-full focus:ring-2 focus:ring-blue-500 outline-none"
            >
              {castProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} {p.id.includes('vaapi-amd') && hardware?.radeon_vaapi ? '★ (Matches your RX 7600 GPU)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="pt-3 border-t border-gray-700/60 flex justify-end">
          <button
            type="button"
            onClick={handleSaveActiveProfiles}
            disabled={saveMutation.isPending}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg shadow transition flex items-center gap-2 disabled:opacity-50"
          >
            {saveMutation.isPending ? 'Saving Profiles...' : 'Save Profiles Selection'}
          </button>
        </div>
      </div>

      {/* Profiles Reference List */}
      <div className="bg-gray-800 border border-gray-700/80 p-5 rounded-xl shadow-lg space-y-4">
        <h2 className="text-base font-bold text-white pb-2 border-b border-gray-700/60">
          Available FFmpeg Command Templates
        </h2>

        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Cast Profiles (Chromecast)</h3>
          <div className="space-y-2">
            {castProfiles.map((p) => {
              const isActive = activeCastProfileId === p.id;
              return (
                <div
                  key={p.id}
                  className={`p-3 rounded-lg border text-xs transition ${
                    isActive
                      ? 'bg-blue-950/25 border-blue-500/50'
                      : 'bg-gray-900/60 border-gray-700/50'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-white flex items-center gap-1.5">
                      {p.name}
                      {isActive && <span className="text-[10px] bg-blue-600 text-white px-1.5 py-0.5 rounded font-bold">ACTIVE FOR CAST</span>}
                    </span>
                    <span className="text-gray-500 font-mono text-[11px]">{p.id}</span>
                  </div>
                  <code className="text-gray-300 font-mono block bg-black/40 p-2 rounded text-[11px] overflow-x-auto whitespace-pre-wrap">
                    ffmpeg {p.command}
                  </code>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
