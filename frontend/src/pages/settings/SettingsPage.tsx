import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import type { Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useConfig } from '../../api/guide';
import { useSaveGlobalSettings, usePublicIp, useHardwareInfo } from '../../api/settings';
import { GuideTour } from '../../components/ui/GuideTour';
import { SourcesTab } from '../../components/settings/SourcesTab';
import { DiagnosticsTab } from '../../components/settings/DiagnosticsTab';
import { ProfilesTab } from '../../components/settings/ProfilesTab';
import { UsersTab } from '../../components/settings/UsersTab';
import { LogsTab } from '../../components/settings/LogsTab';
import { LocalFoldersTab } from '../../components/settings/LocalFoldersTab';

const settingsSchema = z.object({
  timezoneOffset: z.coerce.number(),
  playerLogLevel: z.enum(['debug', 'info', 'warning', 'error']).default('warning'),
  dvrLogLevel: z.enum(['debug', 'info', 'warning', 'error']).default('warning'),
  notificationLeadTime: z.coerce.number().min(0).max(60).default(10),
  dvr: z.object({
    preBufferMinutes: z.coerce.number().min(0).default(1),
    postBufferMinutes: z.coerce.number().min(0).default(2),
    maxConcurrentRecordings: z.coerce.number().min(1).max(10).default(1),
    autoDeleteDays: z.coerce.number().min(0).default(0),
  }),
  logs: z.object({
    maxFiles: z.coerce.number().min(1).default(5),
    maxFileSizeBytes: z.coerce.number().min(1048576).default(5242880), // Store as bytes
    autoDeleteDays: z.coerce.number().min(0).default(7),
  }),
  vodPlaybackEngine: z.enum(['native', 'mpegts']).default('native'),
});

type SettingsFormValues = z.infer<typeof settingsSchema>;

export function SettingsPage() {
  const { data: config, isLoading: isConfigLoading } = useConfig();
  const { data: publicIp } = usePublicIp();
  const { data: hardware } = useHardwareInfo();
  
  const saveMutation = useSaveGlobalSettings();
  const [activeTab, setActiveTab] = useState<'general' | 'dvr' | 'logs' | 'profiles' | 'sources' | 'localMedia' | 'users' | 'diagnostics'>('sources');

  const { register, handleSubmit, reset, formState: { errors, isDirty } } = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema) as Resolver<SettingsFormValues>,
  });

  // Populate form when config loads
  useEffect(() => {
    if (config?.settings) {
      reset({
        timezoneOffset: config.settings.timezoneOffset ?? 0,
        playerLogLevel: (config.settings.playerLogLevel as 'debug' | 'info' | 'warning' | 'error') || 'warning',
        dvrLogLevel: (config.settings.dvrLogLevel as 'debug' | 'info' | 'warning' | 'error') || 'warning',
        notificationLeadTime: config.settings.notificationLeadTime ?? 10,
        dvr: {
          preBufferMinutes: config.settings.dvr?.preBufferMinutes ?? 1,
          postBufferMinutes: config.settings.dvr?.postBufferMinutes ?? 2,
          maxConcurrentRecordings: config.settings.dvr?.maxConcurrentRecordings ?? 1,
          autoDeleteDays: config.settings.dvr?.autoDeleteDays ?? 0,
        },
        logs: {
          maxFiles: config.settings.logs?.maxFiles ?? 5,
          maxFileSizeBytes: config.settings.logs?.maxFileSizeBytes ?? 5242880,
          autoDeleteDays: config.settings.logs?.autoDeleteDays ?? 7,
        },
        vodPlaybackEngine: config.settings.vodPlaybackEngine || 'native',
      });
    }
  }, [config, reset]);

  const onSubmit = (data: SettingsFormValues) => {
    saveMutation.mutate(data, {
      onSuccess: () => {
        reset(data); // reset isDirty state
      }
    });
  };

  if (isConfigLoading) {
    return <div className="p-8 text-center text-gray-400">Loading settings...</div>;
  }

  return (
    <div className="p-4 md:p-6 h-[calc(100vh-60px)] overflow-y-auto">
      <GuideTour
        tourKey="settings-tour"
        steps={[
          { element: '#settings-tabs', popover: { title: 'Settings Categories', description: 'Switch between General, DVR, and Logs settings.' } },
          { element: '#settings-form', popover: { title: 'Configuration', description: 'Modify your settings and click Save Changes.' } },
        ]}
      />

      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        {['general', 'dvr', 'logs'].includes(activeTab) && (
          <button
            onClick={handleSubmit(onSubmit)}
            disabled={!isDirty || saveMutation.isPending}
            className={`px-4 py-2 rounded font-semibold transition ${
              isDirty ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-gray-700 text-gray-500 cursor-not-allowed'
            }`}
          >
            {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        )}
      </div>
      
      <div id="settings-tabs" className="flex overflow-x-auto border-b border-gray-700 mb-6 pb-2">
        <button onClick={() => setActiveTab('sources')} className={`px-4 py-2 font-semibold whitespace-nowrap ${activeTab === 'sources' ? 'text-blue-500 border-b-2 border-blue-500' : 'text-gray-400'}`}>Playlists &amp; Sources</button>
        <button onClick={() => setActiveTab('localMedia')} className={`px-4 py-2 font-semibold whitespace-nowrap ${activeTab === 'localMedia' ? 'text-blue-500 border-b-2 border-blue-500' : 'text-gray-400'}`}>Pastas Locais de Vídeo</button>
        <button onClick={() => setActiveTab('general')} className={`px-4 py-2 font-semibold whitespace-nowrap ${activeTab === 'general' ? 'text-blue-500 border-b-2 border-blue-500' : 'text-gray-400'}`}>General</button>
        <button onClick={() => setActiveTab('profiles')} className={`px-4 py-2 font-semibold whitespace-nowrap ${activeTab === 'profiles' ? 'text-blue-500 border-b-2 border-blue-500' : 'text-gray-400'}`}>Profiles</button>
        <button onClick={() => setActiveTab('dvr')} className={`px-4 py-2 font-semibold whitespace-nowrap ${activeTab === 'dvr' ? 'text-blue-500 border-b-2 border-blue-500' : 'text-gray-400'}`}>DVR &amp; Storage</button>
        <button onClick={() => setActiveTab('users')} className={`px-4 py-2 font-semibold whitespace-nowrap ${activeTab === 'users' ? 'text-blue-500 border-b-2 border-blue-500' : 'text-gray-400'}`}>Users</button>
        <button onClick={() => setActiveTab('logs')} className={`px-4 py-2 font-semibold whitespace-nowrap ${activeTab === 'logs' ? 'text-blue-500 border-b-2 border-blue-500' : 'text-gray-400'}`}>Logs</button>
        <button onClick={() => setActiveTab('diagnostics')} className={`px-4 py-2 font-semibold whitespace-nowrap ${activeTab === 'diagnostics' ? 'text-blue-500 border-b-2 border-blue-500' : 'text-gray-400'}`}>Diagnostics &amp; Profiler</button>
      </div>

      {activeTab === 'sources' && (
        <SourcesTab settings={config?.settings} />
      )}

      {activeTab === 'localMedia' && (
        <LocalFoldersTab />
      )}

      {activeTab === 'diagnostics' && (
        <DiagnosticsTab />
      )}

      {activeTab === 'profiles' && (
        <ProfilesTab settings={config?.settings} />
      )}

      {activeTab === 'users' && (
        <UsersTab />
      )}

      {['general', 'dvr', 'logs'].includes(activeTab) && (
        <form id="settings-form" onSubmit={handleSubmit(onSubmit)} className="space-y-6 max-w-3xl">
          {activeTab === 'general' && (
            <div className="bg-gray-800 p-6 rounded-lg space-y-4">
              <h2 className="text-lg font-semibold mb-4 border-b border-gray-700 pb-2">General Preferences</h2>
              
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Timezone Offset</label>
                <select {...register('timezoneOffset')} className="bg-gray-700 border border-gray-600 rounded px-3 py-2 w-full max-w-xs">
                  {Array.from({ length: 27 }, (_, i) => 14 - i).map(offset => (
                    <option key={offset} value={offset}>
                      UTC{offset >= 0 ? '+' : ''}{offset}:00
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">Notification Lead Time (minutes)</label>
                <input type="number" {...register('notificationLeadTime')} className="bg-gray-700 border border-gray-600 rounded px-3 py-2 w-full max-w-xs" />
                {errors.notificationLeadTime && <p className="text-red-400 text-sm mt-1">{errors.notificationLeadTime.message}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">VOD Playback Engine (Movies &amp; Series)</label>
                <select {...register('vodPlaybackEngine')} className="bg-gray-700 border border-gray-600 rounded px-3 py-2 w-full max-w-xs">
                  <option value="native">Native Browser Player (Full Duration &amp; Fast Seeking - Recommended)</option>
                  <option value="mpegts">MPEG-TS Engine (MSE Compatibility Mode)</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  Native mode enables total episode duration, scrub bar and instant seek on movies/series. If you experience format incompatibility on older browsers, you can switch back to MPEG-TS.
                </p>
              </div>

              <div className="pt-4 mt-4 border-t border-gray-700">
                <h3 className="text-sm font-semibold text-gray-300 mb-2">System Info</h3>
                <p className="text-sm text-gray-400">Public IP: <span className="font-mono text-gray-200">{publicIp?.publicIp || '...'}</span></p>
                <p className="text-sm text-gray-400">Hardware: <span className="font-mono text-gray-200">{hardware ? Object.values(hardware).join(', ') || 'None' : '...'}</span></p>
              </div>
            </div>
          )}

          {activeTab === 'dvr' && (
            <div className="bg-gray-800 p-6 rounded-lg space-y-4">
              <h2 className="text-lg font-semibold mb-4 border-b border-gray-700 pb-2">DVR Configuration</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Pre-Buffer (minutes)</label>
                  <input type="number" {...register('dvr.preBufferMinutes')} className="bg-gray-700 border border-gray-600 rounded px-3 py-2 w-full" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Post-Buffer (minutes)</label>
                  <input type="number" {...register('dvr.postBufferMinutes')} className="bg-gray-700 border border-gray-600 rounded px-3 py-2 w-full" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Max Concurrent Recordings</label>
                  <input type="number" {...register('dvr.maxConcurrentRecordings')} className="bg-gray-700 border border-gray-600 rounded px-3 py-2 w-full" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-1">Auto-Delete Old Recordings (Days, 0 to disable)</label>
                  <input type="number" {...register('dvr.autoDeleteDays')} className="bg-gray-700 border border-gray-600 rounded px-3 py-2 w-full" />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'logs' && (
            <LogsTab register={register} />
          )}
        </form>
      )}
    </div>
  );
}
