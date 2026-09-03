import React from 'react';
import type { Channel, EpgProgram } from '@homeiptv/shared-types';
import type { DvrJob } from '@homeiptv/shared-types';
import { findDvrJobForProgram } from '../../api/dvr';
import { findNotificationForProgram, type ProgramNotification } from '../../api/notifications';
import { ProgramBlock, type GuideProgram } from './ProgramBlock';

export const ROW_HEIGHT = 60;
export const PLACEHOLDER_LOGO = 'https://placehold.co/48x48/1f2937/d1d5db?text=?';

export function proxiedLogoUrl(logo: string | undefined): string {
  if (!logo) return PLACEHOLDER_LOGO;
  return `/api/image-proxy?url=${encodeURIComponent(logo)}`;
}

interface ChannelRowProps {
  channel: Channel;
  programs: EpgProgram[];
  guideStartUtc: Date;
  guideEnd: Date;
  hourWidthPixels: number;
  timelineWidth: number;
  offsetHours: number;
  now: Date;
  showSourceBadge: boolean;
  sourceBadgeColor: string;
  notifications: ProgramNotification[] | undefined;
  dvrJobs: DvrJob[] | undefined;
  onToggleFavorite: (channelId: string) => void;
  onSelectChannel: (channel: Channel) => void;
  onOpenProgram: (program: GuideProgram) => void;
}

export const ChannelRow = React.memo(function ChannelRow({
  channel,
  programs,
  guideStartUtc,
  guideEnd,
  hourWidthPixels,
  timelineWidth,
  offsetHours,
  now,
  showSourceBadge,
  sourceBadgeColor,
  notifications,
  dvrJobs,
  onToggleFavorite,
  onSelectChannel,
  onOpenProgram,
}: ChannelRowProps) {
  const channelName = channel.displayName || channel.name;
  const visiblePrograms = programs.filter((prog) => {
    const progStop = new Date(prog.stop);
    const progStart = new Date(prog.start);
    return !(progStop < guideStartUtc || progStart > guideEnd);
  });

  return (
    <div className="flex border-b border-gray-800/80 hover:bg-gray-900/30 transition-colors" style={{ height: ROW_HEIGHT }}>
      {/* Left Channel Info Column */}
      <div
        className="sticky left-0 z-10 bg-gray-900/95 backdrop-blur border-r border-gray-800 flex items-center justify-between px-3 py-1.5 flex-shrink-0"
        style={{ width: 'var(--channel-col-width, 180px)', height: ROW_HEIGHT }}
      >
        <button
          type="button"
          onClick={() => onSelectChannel(channel)}
          className="flex items-center overflow-hidden flex-grow min-w-0 text-left gap-2"
        >
          <img
            src={proxiedLogoUrl(channel.logo)}
            loading="lazy"
            decoding="async"
            onError={(e) => {
              e.currentTarget.onerror = null;
              e.currentTarget.src = PLACEHOLDER_LOGO;
            }}
            alt=""
            className="w-9 h-9 object-contain flex-shrink-0 rounded bg-gray-800 p-0.5 border border-gray-700/50"
          />
          <div className="flex-grow min-w-0">
            <span className="font-semibold text-xs truncate block text-gray-100">{channelName}</span>
            <div className="flex items-center gap-1.5 mt-0.5">
              {channel.chno && (
                <span className="text-[10px] px-1 py-0.2 rounded bg-gray-800 text-gray-400 font-mono">{channel.chno}</span>
              )}
              {showSourceBadge && (
                <span className={`text-[10px] px-1 py-0.2 rounded text-white ${sourceBadgeColor}`}>
                  {channel.source}
                </span>
              )}
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(channel.id);
          }}
          aria-label={channel.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          className={`hidden md:flex items-center justify-center ml-1 flex-shrink-0 w-5 h-5 ${
            channel.isFavorite ? 'text-yellow-400' : 'text-gray-600 hover:text-yellow-400'
          }`}
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.958a1 1 0 00.95.69h4.162c.969 0 1.371 1.24.588 1.81l-3.368 2.446a1 1 0 00-.363 1.118l1.287 3.957c.3.922-.755 1.688-1.538 1.118l-3.367-2.446a1 1 0 00-1.176 0l-3.367 2.446c-.783.57-1.838-.196-1.538-1.118l1.287-3.957a1 1 0 00-.363-1.118L2.063 9.385c-.783-.57-.38-1.81.588-1.81h4.163a1 1 0 00.95-.69l1.285-3.958z" />
          </svg>
        </button>
      </div>

      {/* Right Timeline Grid Column */}
      <div className="relative flex-shrink-0 bg-gray-950/40" style={{ width: timelineWidth, height: ROW_HEIGHT }}>
        {/* Hour Column Grid Dividers */}
        {Array.from({ length: 24 }).map((_, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 border-l border-gray-800/30 pointer-events-none"
            style={{ left: i * hourWidthPixels, width: hourWidthPixels }}
          />
        ))}

        {visiblePrograms.length === 0 ? (
          <div className="absolute inset-y-1.5 left-2 right-2 rounded border border-dashed border-gray-800/60 bg-gray-900/20 flex items-center px-4 text-gray-500 text-xs italic pointer-events-none">
            No EPG program schedule available
          </div>
        ) : (
          visiblePrograms.map((prog, idx) => {
            const progStart = new Date(prog.start);
            const progStop = new Date(prog.stop);
            const programId = `${channel.id}-${progStart.getTime()}-${progStop.getTime()}-${idx}`;
            const guideProgram: GuideProgram = { ...prog, channel, programId };
            const hasNotification = !!findNotificationForProgram(notifications, channel.id, programId);
            const hasRecording = !!findDvrJobForProgram(dvrJobs, channel.id, progStart, progStop);
            return (
              <ProgramBlock
                key={programId}
                program={guideProgram}
                guideStartUtc={guideStartUtc}
                hourWidthPixels={hourWidthPixels}
                offsetHours={offsetHours}
                now={now}
                hasNotification={hasNotification}
                hasRecording={hasRecording}
                onClick={onOpenProgram}
              />
            );
          })
        )}
      </div>
    </div>
  );
});
