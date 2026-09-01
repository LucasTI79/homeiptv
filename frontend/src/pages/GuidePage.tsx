import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConfig, useSaveUserSetting } from '../api/guide';
import { useNotifications } from '../api/notifications';
import { useDvrJobs } from '../api/dvr';
import { useUiStore } from '../store/uiStore';
import { parseM3U } from '../lib/parseM3U';
import { ChannelRow, ROW_HEIGHT } from '../components/guide/ChannelRow';
import { GuideFilters } from '../components/guide/GuideFilters';
import { GuideSearch } from '../components/guide/GuideSearch';
import { ProgramDetailsModal } from '../components/guide/ProgramDetailsModal';
import type { Channel } from '@viniplay/shared-types';
import type { GuideProgram } from '../components/guide/ProgramBlock';
import { findNotificationForProgram } from '../api/notifications';
import { findDvrJobForProgram } from '../api/dvr';

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

  // Virtualization state
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [clientHeight, setClientHeight] = useState(800);

  // Auto-refresh "now" line and live progress
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  // Update client height for virtualization
  useEffect(() => {
    const updateHeight = () => {
      if (scrollRef.current) {
        setClientHeight(scrollRef.current.clientHeight);
      }
    };
    window.addEventListener('resize', updateHeight);
    updateHeight();
    return () => window.removeEventListener('resize', updateHeight);
  }, []);

  const handleScroll = useCallback(() => {
    if (scrollRef.current) {
      setScrollTop(scrollRef.current.scrollTop);
    }
  }, []);

  // Compute channels and programs
  const { channels, epgData, groups, sources, minDate, maxDate } = useMemo(() => {
    if (!config) return { channels: [], epgData: {}, groups: [], sources: [], minDate: '', maxDate: '' };
    
    const parsedChannels = parseM3U(config.m3uContent);
    const epg = config.epgContent || {};
    const favorites = new Set(config.settings.favorites || []);
    
    const groupSet = new Set<string>();
    const sourceSet = new Set<string>();
    let minTime = Infinity;
    let maxTime = -Infinity;

    parsedChannels.forEach((c) => {
      c.isFavorite = favorites.has(c.id);
      if (c.group) groupSet.add(c.group);
      if (c.source) sourceSet.add(c.source);
      
      const progs = epg[c.id] || [];
      progs.forEach((p) => {
        const start = new Date(p.start).getTime();
        const stop = new Date(p.stop).getTime();
        if (start < minTime) minTime = start;
        if (stop > maxTime) maxTime = stop;
      });
    });

    const minDateObj = minTime !== Infinity ? new Date(minTime) : new Date();
    const maxDateObj = maxTime !== -Infinity ? new Date(maxTime) : new Date();
    
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

  // Apply filters and search
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

    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      const searchScope = config.settings.searchScope || ['channels'];
      const includePrograms = searchScope.includes('programs');

      result = result.filter((c) => {
        const chNameMatch = 
          c.name.toLowerCase().includes(q) || 
          c.displayName?.toLowerCase().includes(q) || 
          c.source?.toLowerCase().includes(q) || 
          (c.chno && c.chno.includes(q));
          
        if (chNameMatch) return true;
        
        if (includePrograms) {
          const progs = epgData[c.id] || [];
          return progs.some(p => p.title.toLowerCase().includes(q));
        }
        return false;
      });
    }

    return result;
  }, [channels, config, epgData, searchTerm]);

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

  // Render virtualization
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 2);
  const endIndex = Math.min(filteredChannels.length, Math.ceil((scrollTop + clientHeight) / ROW_HEIGHT) + 2);
  const visibleChannels = filteredChannels.slice(startIndex, endIndex);

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
    return <div className="p-8 text-gray-500">Loading guide data...</div>;
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
      <div className="flex-1 overflow-auto bg-gray-950 relative" onScroll={handleScroll} ref={scrollRef}>
        <div style={{ height: filteredChannels.length * ROW_HEIGHT + 40, width: `calc(var(--channel-col-width, 180px) + ${timelineWidth}px)` }}>
          
          {/* Header Row */}
          <div className="sticky top-0 z-30 flex bg-gray-900/95 backdrop-blur border-b border-gray-800 h-10 shadow-sm">
            <div className="sticky left-0 z-40 bg-gray-900/95 border-r border-gray-800 flex items-center px-4 font-semibold text-sm text-gray-400 shrink-0" style={{ width: 'var(--channel-col-width, 180px)' }}>
              {filteredChannels.length} Channels
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
          <div className="relative" style={{ transform: `translateY(${startIndex * ROW_HEIGHT}px)` }}>
            {visibleChannels.map((channel) => (
              <ChannelRow
                key={channel.id}
                channel={channel}
                programs={epgData[channel.id] || []}
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
            ))}
            {filteredChannels.length === 0 && (
              <div className="p-8 text-center text-gray-500 col-span-full absolute w-full left-0">
                No channels match your filters or search.
              </div>
            )}
          </div>
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
