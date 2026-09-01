import type { Channel, EpgProgram } from '@viniplay/shared-types';
import type { DvrJob } from '@viniplay/shared-types';
import { findDvrJobForProgram } from '../../api/dvr';
import { findNotificationForProgram, type ProgramNotification } from '../../api/notifications';
import { ProgramBlock, type GuideProgram } from './ProgramBlock';

export const ROW_HEIGHT = 96;
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

export function ChannelRow({
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
    <div className="flex" style={{ height: ROW_HEIGHT }}>
      <div
        className="sticky left-0 z-10 bg-gray-900 border-r border-b border-gray-800 flex items-center justify-between p-2 flex-shrink-0"
        style={{ width: 'var(--channel-col-width, 180px)' }}
      >
        <button
          type="button"
          onClick={() => onSelectChannel(channel)}
          className="flex items-center overflow-hidden flex-grow min-w-0 text-left"
        >
          <img
            src={proxiedLogoUrl(channel.logo)}
            onError={(e) => {
              e.currentTarget.onerror = null;
              e.currentTarget.src = PLACEHOLDER_LOGO;
            }}
            alt=""
            className="w-12 h-12 object-contain mr-3 flex-shrink-0 rounded-md bg-gray-700"
          />
          <div className="flex-grow min-w-0">
            <span className="font-semibold text-sm truncate block text-gray-100">{channelName}</span>
            <div className="flex items-center gap-2 mt-1">
              {channel.chno && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-gray-700 text-gray-300">{channel.chno}</span>
              )}
              {showSourceBadge && (
                <span className={`text-xs px-1.5 py-0.5 rounded text-white ${sourceBadgeColor}`}>
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
          className={`hidden md:flex items-center justify-center ml-2 flex-shrink-0 w-6 h-6 ${
            channel.isFavorite ? 'text-yellow-400' : 'text-gray-500 hover:text-yellow-400'
          }`}
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.958a1 1 0 00.95.69h4.162c.969 0 1.371 1.24.588 1.81l-3.368 2.446a1 1 0 00-.363 1.118l1.287 3.957c.3.922-.755 1.688-1.538 1.118l-3.367-2.446a1 1 0 00-1.176 0l-3.367 2.446c-.783.57-1.838-.196-1.538-1.118l1.287-3.957a1 1 0 00-.363-1.118L2.063 9.385c-.783-.57-.38-1.81.588-1.81h4.163a1 1 0 00.95-.69l1.285-3.958z" />
          </svg>
        </button>
      </div>
      <div className="relative flex-shrink-0" style={{ width: timelineWidth, height: ROW_HEIGHT }}>
        {visiblePrograms.map((prog) => {
          const progStart = new Date(prog.start);
          const progStop = new Date(prog.stop);
          const programId = `${channel.id}-${progStart.toISOString()}-${progStop.toISOString()}`;
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
        })}
      </div>
    </div>
  );
}
