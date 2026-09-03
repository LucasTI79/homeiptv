import { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useConfig, useSaveUserSetting } from '../api/guide';
import { useNotifications } from '../api/notifications';
import { useDvrJobs } from '../api/dvr';
import { useUiStore } from '../store/uiStore';
import { parseM3U } from '../lib/parseM3U';
import { ChannelRow, ROW_HEIGHT } from '../components/guide/ChannelRow';
import { GuideFilters } from '../components/guide/GuideFilters';
import { GuideSearch } from '../components/guide/GuideSearch';
import { ProgramDetailsModal } from '../components/guide/ProgramDetailsModal';
import type { Channel, EpgProgram } from '@homeiptv/shared-types';
import type { GuideProgram } from '../components/guide/ProgramBlock';
import { GuideSkeleton } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { findNotificationForProgram } from '../api/notifications';
import { findDvrJobForProgram } from '../api/dvr';
import { useRemoteStore } from '../store/remoteStore';
import { toast } from 'react-hot-toast';

// Timeline constants
const HOUR_WIDTH = 240;
const GUIDE_DURATION_HOURS = 24;

export function GuidePage() {
  const navigate = useNavigate();
  const setSelectedChannel = useUiStore((s) => s.setSelectedChannel);
  
  const { data: config, isLoading: configLoading } = useConfig();
  const { data: notifications } = useNotifications();
  const { data: dvrJobs } = useDvrJobs();
  const saveSetting = useSaveUserSetting();

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProgram, setSelectedProgram] = useState<GuideProgram | null>(null);
  
  // Date selection state
  const [selectedDateStr, setSelectedDateStr] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });

  const [now, setNow] = useState(new Date());

  // Resizable channel column state
  const [colWidth, setColWidth] = useState<number>(() => {
    const saved = localStorage.getItem('guideChannelColWidth');
    return saved ? Math.max(140, Math.min(500, parseInt(saved, 10))) : 220;
  });
  const [isResizing, setIsResizing] = useState(false);

  const handleMouseDownResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    const startX = e.clientX;
    const startWidth = colWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const nextWidth = Math.max(140, Math.min(500, startWidth + delta));
      setColWidth(nextWidth);
    };

    const handleMouseUp = (upEvent: MouseEvent) => {
      setIsResizing(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      const finalDelta = upEvent.clientX - startX;
      const finalWidth = Math.max(140, Math.min(500, startWidth + finalDelta));
      localStorage.setItem('guideChannelColWidth', String(finalWidth));
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Scroll container ref for TanStack Virtual
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-refresh "now" line and live progress
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');

  // Debounce search input to prevent expensive re-filtering on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 200);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Compute channels and programs
  const { channels, epgData, groups, sources, minDate, maxDate } = useMemo(() => {
    if (!config) return { channels: [], epgData: {}, groups: [], sources: [], minDate: '', maxDate: '' };
    
    const parsedChannels = parseM3U(config.m3uContent);
    const epg = (config.epgContent as Record<string, EpgProgram[]>) || {};
    const favorites = new Set(config.settings.favorites || []);
    
    const groupSet = new Set<string>();
    const sourceSet = new Set<string>();

    for (let i = 0; i < parsedChannels.length; i++) {
      const c = parsedChannels[i];
      c.isFavorite = favorites.has(c.id);
      if (c.group) groupSet.add(c.group);
      if (c.source) sourceSet.add(c.source);
    }

    // Fast O(1) sampling of EPG date bounds
    let minTime = Infinity;
    let maxTime = -Infinity;
    const sampleKeys = Object.keys(epg).slice(0, 15);
    for (let i = 0; i < sampleKeys.length; i++) {
      const progs = epg[sampleKeys[i]];
      if (progs && progs.length > 0) {
        const firstStart = new Date(progs[0].start).getTime();
        const lastStop = new Date(progs[progs.length - 1].stop).getTime();
        if (firstStart < minTime) minTime = firstStart;
        if (lastStop > maxTime) maxTime = lastStop;
      }
    }

    const minDateObj = Number.isFinite(minTime) ? new Date(minTime) : new Date();
    const maxDateObj = Number.isFinite(maxTime) ? new Date(maxTime) : new Date(Date.now() + 86400000 * 2);
    
    const fmtDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    return {
      channels: parsedChannels,
      epgData: epg,
      groups: Array.from(groupSet).sort(),
      sources: Array.from(sourceSet).sort(),
      minDate: fmtDate(minDateObj),
      maxDate: fmtDate(maxDateObj),
    };
  }, [config]);

  // Apply filters and debounced search
  const filteredChannels = useMemo(() => {
    if (!config) return [];
    let result = channels;

    const activeGroup = config.settings.activeGroupFilter || 'all';
    const activeSource = config.settings.activeSourceFilter || 'all';

    if (activeGroup === 'favorites') {
      result = result.filter((c) => c.isFavorite);
    } else if (activeGroup === 'recents') {
      const recents = new Set(config.settings.recentChannels || []);
      result = result.filter((c) => recents.has(c.id));
    } else if (activeGroup !== 'all') {
      result = result.filter((c) => c.group === activeGroup);
    }

    if (activeSource !== 'all') {
      result = result.filter((c) => c.source === activeSource);
    }

    if (debouncedSearchTerm) {
      const q = debouncedSearchTerm.toLowerCase().trim();
      const searchScope = (config.settings.searchScope as unknown as string[]) || ['channels'];
      const includePrograms = Array.isArray(searchScope) && searchScope.includes('programs');

      result = result.filter((c) => {
        const chNameMatch = 
          c.name.toLowerCase().includes(q) || 
          c.displayName?.toLowerCase().includes(q) || 
          c.source?.toLowerCase().includes(q) || 
          (c.chno && c.chno.includes(q));
          
        if (chNameMatch) return true;
        
        if (includePrograms) {
          const progs = epgData[c.tvgId || c.id] || [];
          for (let i = 0; i < progs.length; i++) {
            if (progs[i].title.toLowerCase().includes(q)) return true;
          }
        }
        return false;
      });
    }

    return result;
  }, [channels, config, epgData, debouncedSearchTerm]);

  // Compute guide time window
  const offsetHours = config?.settings.timezoneOffset || 0;
  const guideStartUtc = useMemo(() => {
    const parts = selectedDateStr.split('-');
    if (parts.length === 3) {
      // Midnight local time according to offset?
      // Since we formatTime with offset applied to raw Date,
      // the guideStartUtc should just be a Date object such that
      // its getUTCHours() + offsetHours = 00:00.
      // Easiest is to create a date in local time for the selected string,
      // and subtract offset if we want absolute UTC alignment.
      // But actually, just parsing the local date string (e.g. "2024-05-10T00:00:00")
      // gives us a local midnight.
      const d = new Date(`${selectedDateStr}T00:00:00`);
      return d;
    }
    return new Date();
  }, [selectedDateStr]);

  const guideEnd = new Date(guideStartUtc.getTime() + GUIDE_DURATION_HOURS * 3600000);
  const timelineWidth = GUIDE_DURATION_HOURS * HOUR_WIDTH;

  // TanStack Virtualizer for TV Guide rows
  const rowVirtualizer = useVirtualizer({
    count: filteredChannels.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 4,
  });

  // Time headers
  const timeHeaders = useMemo(() => {
    const headers = [];
    for (let i = 0; i < GUIDE_DURATION_HOURS; i++) {
      const d = new Date(guideStartUtc.getTime() + i * 3600000);
      const adjusted = new Date(d.getTime() + offsetHours * 3600000);
      const h = adjusted.getUTCHours().toString().padStart(2, '0');
      headers.push(
        <div key={i} className="absolute text-gray-400 text-xs font-semibold pl-2 pt-2 border-l border-gray-700/50 h-full" style={{ left: i * HOUR_WIDTH, width: HOUR_WIDTH }}>
          {h}:00
        </div>
      );
    }
    return headers;
  }, [guideStartUtc, offsetHours]);

  const nowLineLeft = ((now.getTime() - guideStartUtc.getTime()) / 3600000) * HOUR_WIDTH;
  const showNowLine = nowLineLeft >= 0 && nowLineLeft <= timelineWidth;

  const handlePlayChannel = (channel: Channel) => {
    const { isPaired, role, sendCommand } = useRemoteStore.getState();
    if (isPaired && role === 'client') {
      const channelName = channel.displayName || channel.name;
      sendCommand({
        type: 'COMMAND_PLAY_MEDIA',
        payload: {
          id: channel.id,
          name: channelName,
          url: channel.url,
          logo: channel.logo,
          isVod: false,
        },
      });
      toast.success(`Transmitindo "${channelName}" na TV!`, { icon: '📺' });
      return;
    }
    setSelectedChannel({ url: channel.url, name: channel.displayName || channel.name, id: channel.id });
    navigate('/player');
  };

  const handleToggleFavorite = (channelId: string) => {
    if (!config) return;
    const current = new Set(config.settings.favorites || []);
    if (current.has(channelId)) current.delete(channelId);
    else current.add(channelId);
    saveSetting.mutate({ key: 'favorites', value: Array.from(current) });
  };

  if (configLoading) {
    return <GuideSkeleton />;
  }

  const activeGroup = config?.settings.activeGroupFilter || 'all';
  const activeSource = config?.settings.activeSourceFilter || 'all';

  return (
    <div className="flex flex-col h-full h-[calc(100vh-60px)]">
      {/* Toolbar */}
      <div className="bg-gray-900 border-b border-gray-800 p-4 flex flex-col md:flex-row gap-4 justify-between items-start md:items-center shrink-0">
        <GuideFilters
          groups={groups}
          sources={sources}
          activeGroupFilter={activeGroup}
          activeSourceFilter={activeSource}
          onChangeGroup={(val) => saveSetting.mutate({ key: 'activeGroupFilter', value: val })}
          onChangeSource={(val) => saveSetting.mutate({ key: 'activeSourceFilter', value: val })}
        />
        <div className="flex gap-4 w-full md:w-auto">
          <input
            type="date"
            value={selectedDateStr}
            min={minDate}
            max={maxDate}
            onChange={(e) => {
              if (e.target.value) setSelectedDateStr(e.target.value);
            }}
            className="bg-gray-800 text-white border border-gray-700 rounded-md px-3 py-1.5 text-sm outline-none focus:border-blue-500"
          />
          <GuideSearch onSearchDebounced={setSearchTerm} />
        </div>
      </div>

      {/* Guide Grid */}
      <div className="flex-1 overflow-auto bg-gray-950 relative" ref={scrollRef}>
        <div
          style={{
            ['--channel-col-width' as string]: `${colWidth}px`,
            height: `${rowVirtualizer.getTotalSize() + 40}px`,
            width: `${colWidth + timelineWidth}px`,
            position: 'relative',
          }}
        >
          {/* Header Row */}
          <div className="sticky top-0 z-30 flex bg-gray-900/95 backdrop-blur border-b border-gray-800 h-10 shadow-sm select-none">
            <div
              className="sticky left-0 z-40 bg-gray-900/95 border-r border-gray-800 flex items-center justify-between px-3 font-semibold text-xs text-gray-400 shrink-0 relative group"
              style={{ width: `${colWidth}px` }}
            >
              <span className="truncate">{filteredChannels.length} Channels</span>
              
              {/* Draggable Resize Handle */}
              <div
                onMouseDown={handleMouseDownResize}
                onDoubleClick={() => {
                  const next = colWidth > 220 ? 180 : 320;
                  setColWidth(next);
                  localStorage.setItem('guideChannelColWidth', String(next));
                }}
                className={`absolute right-0 top-0 bottom-0 w-2.5 cursor-col-resize hover:bg-blue-500/60 transition-colors z-50 flex items-center justify-center ${
                  isResizing ? 'bg-blue-500' : ''
                }`}
                title="Drag to resize channel column (Double click to toggle 180px / 320px)"
              >
                <div className="w-0.5 h-4 bg-gray-600 group-hover:bg-white rounded-full pointer-events-none" />
              </div>
            </div>
            <div className="relative shrink-0" style={{ width: timelineWidth }}>
              {timeHeaders}
              {showNowLine && (
                <div 
                  className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-50 pointer-events-none" 
                  style={{ left: nowLineLeft, height: '1000vh' }}
                >
                  <div className="absolute -top-1 -left-1.5 w-3.5 h-3.5 bg-red-500 rounded-full" />
                </div>
              )}
            </div>
          </div>

          {/* Virtualized Rows */}
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const channel = filteredChannels[virtualRow.index];
            if (!channel) return null;
            return (
              <div
                key={channel.id}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start + 40}px)`,
                }}
              >
                <ChannelRow
                  channel={channel}
                  programs={epgData[channel.tvgId || channel.id] || []}
                  guideStartUtc={guideStartUtc}
                  guideEnd={guideEnd}
                  hourWidthPixels={HOUR_WIDTH}
                  timelineWidth={timelineWidth}
                  offsetHours={offsetHours}
                  now={now}
                  showSourceBadge={sources.length > 1}
                  sourceBadgeColor="bg-blue-600"
                  notifications={notifications}
                  dvrJobs={dvrJobs}
                  onToggleFavorite={handleToggleFavorite}
                  onSelectChannel={handlePlayChannel}
                  onOpenProgram={setSelectedProgram}
                />
              </div>
            );
          })}

          {filteredChannels.length === 0 && (
            <div className="absolute w-full left-0 top-16 px-4 z-20">
              <EmptyState
                icon="📺"
                title={channels.length === 0 ? "No IPTV Channels Configured" : "No Channels Found"}
                description={
                  channels.length === 0
                    ? "You haven't configured any M3U playlists or Xtream Codes accounts yet."
                    : "No channels match your current search query or group filter."
                }
                instructions={
                  channels.length === 0
                    ? [
                        "Go to Settings > Playlists & Sources.",
                        "Add an Xtream Codes server or upload an M3U playlist.",
                        "Click 'Save & Sync' to load your live channels."
                      ]
                    : [
                        "Try searching for a different channel name or number.",
                        "Change or clear the active category filter.",
                        "Check if the channel is active in your source playlist."
                      ]
                }
                primaryAction={
                  channels.length === 0
                    ? { label: "Go to Settings > Sources", onClick: () => navigate('/settings') }
                    : { label: "Clear Filters", onClick: () => {
                        setSearchTerm('');
                        saveSetting.mutate({ key: 'activeGroupFilter', value: 'all' });
                        saveSetting.mutate({ key: 'activeSourceFilter', value: 'all' });
                      }}
                }
              />
            </div>
          )}
        </div>
      </div>

      {selectedProgram && (
        <ProgramDetailsModal
          program={selectedProgram}
          offsetHours={offsetHours}
          now={now}
          onClose={() => setSelectedProgram(null)}
          onPlay={handlePlayChannel}
          onToggleFavorite={handleToggleFavorite}
          notification={findNotificationForProgram(notifications, selectedProgram.channel.id, selectedProgram.programId)}
          dvrJob={findDvrJobForProgram(dvrJobs, selectedProgram.channel.id, new Date(selectedProgram.start), new Date(selectedProgram.stop))}
        />
      )}
    </div>
  );
}
