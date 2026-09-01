import type { Channel, EpgProgram } from '@viniplay/shared-types';
import { formatTimeWithOffset } from '../../lib/formatTime';

export interface GuideProgram extends EpgProgram {
  channel: Channel;
  programId: string;
}

interface ProgramBlockProps {
  program: GuideProgram;
  guideStartUtc: Date;
  hourWidthPixels: number;
  offsetHours: number;
  now: Date;
  hasNotification: boolean;
  hasRecording: boolean;
  onClick: (program: GuideProgram) => void;
}

// A single program's block in a channel's timeline row. Position/size are
// computed from the program's start/stop relative to the visible guide
// window, clipped to the left edge if the program started before the window.
export function ProgramBlock({
  program,
  guideStartUtc,
  hourWidthPixels,
  offsetHours,
  now,
  hasNotification,
  hasRecording,
  onClick,
}: ProgramBlockProps) {
  const progStart = new Date(program.start);
  const progStop = new Date(program.stop);
  const durationMs = progStop.getTime() - progStart.getTime();
  if (durationMs <= 0) return null;

  let left = ((progStart.getTime() - guideStartUtc.getTime()) / 3600000) * hourWidthPixels;
  let width = (durationMs / 3600000) * hourWidthPixels;
  if (left < 0) {
    width += left;
    left = 0;
  }
  if (width <= 0) return null;

  const isLive = now >= progStart && now < progStop;
  const isPast = now >= progStop;
  const progressWidth = isLive ? ((now.getTime() - progStart.getTime()) / durationMs) * 100 : 0;

  return (
    <button
      type="button"
      onClick={() => onClick(program)}
      className={`absolute top-1 bottom-1 rounded-md p-2 overflow-hidden flex flex-col justify-center text-left z-[5] border ${
        isLive ? 'bg-blue-950 border-blue-600' : 'bg-gray-800 border-gray-700/50'
      } ${isPast ? 'opacity-60' : ''} ${hasNotification ? 'ring-1 ring-yellow-500' : ''} ${
        hasRecording ? 'ring-1 ring-red-500' : ''
      } hover:brightness-125`}
      style={{ left: `${left}px`, width: `${Math.max(0, width - 2)}px` }}
      title={program.title}
    >
      {isLive && (
        <div className="absolute inset-0 bg-blue-600/20" style={{ width: `${progressWidth}%` }} />
      )}
      <p className="relative z-10 text-white font-semibold text-xs truncate">{program.title}</p>
      <p className="relative z-10 text-gray-400 text-xs truncate">
        {formatTimeWithOffset(progStart, offsetHours)} - {formatTimeWithOffset(progStop, offsetHours)}
      </p>
    </button>
  );
}
