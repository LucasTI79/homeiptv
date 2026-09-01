import { useEffect, useRef } from 'react';
import type { Channel, DvrJob } from '@viniplay/shared-types';
import type { GuideProgram } from './ProgramBlock';
import { formatTimeWithOffset } from '../../lib/formatTime';
import { useAuthStatus } from '../../api/auth';
import {
  useCreateNotification,
  useDeleteNotification,
  type ProgramNotification,
} from '../../api/notifications';
import {
  useScheduleDvrJob,
  useCancelDvrJob,
} from '../../api/dvr';

interface ProgramDetailsModalProps {
  program: GuideProgram;
  offsetHours: number;
  now: Date;
  onClose: () => void;
  onPlay: (channel: Channel) => void;
  onToggleFavorite: (channelId: string) => void;
  notification?: ProgramNotification;
  dvrJob?: DvrJob;
}

export function ProgramDetailsModal({
  program,
  offsetHours,
  now,
  onClose,
  onPlay,
  onToggleFavorite,
  notification,
  dvrJob,
}: ProgramDetailsModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const auth = useAuthStatus();
  
  const createNotif = useCreateNotification();
  const deleteNotif = useDeleteNotification();
  const scheduleDvr = useScheduleDvrJob();
  const cancelDvr = useCancelDvrJob();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const progStart = new Date(program.start);
  const progStop = new Date(program.stop);
  const isPast = now >= progStop;

  const canUseDvr = auth.data?.isLoggedIn && (auth.data.user.isAdmin || auth.data.user.canUseDvr);

  const handleNotifyToggle = () => {
    if (notification) {
      deleteNotif.mutate(notification.id);
    } else {
      createNotif.mutate({
        channelId: program.channel.id,
        channelName: program.channel.name,
        channelLogo: program.channel.logo || '',
        programTitle: program.title,
        programDesc: program.desc || '',
        programStart: program.start,
        programStop: program.stop,
        scheduledTime: program.start, // Notification triggers at start time
        programId: program.programId,
      });
    }
  };

  const handleDvrToggle = () => {
    if (dvrJob) {
      cancelDvr.mutate(dvrJob.id);
    } else {
      scheduleDvr.mutate({
        channelId: program.channel.id,
        channelName: program.channel.name,
        programTitle: program.title,
        programStart: program.start,
        programStop: program.stop,
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={modalRef}
        className="bg-gray-900 border border-gray-700 rounded-xl max-w-lg w-full overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b border-gray-800 flex justify-between items-start">
          <div className="pr-4">
            <h2 className="text-xl font-bold text-white mb-1">{program.title}</h2>
            <div className="flex items-center gap-3 text-sm text-gray-400">
              <span className="font-medium text-gray-300">{program.channel.displayName || program.channel.name}</span>
              <span>•</span>
              <span>
                {formatTimeWithOffset(progStart, offsetHours)} - {formatTimeWithOffset(progStop, offsetHours)}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white shrink-0 p-1">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <div className="p-5 text-gray-300 text-sm leading-relaxed max-h-60 overflow-y-auto">
          {program.desc || 'No description available for this program.'}
        </div>

        <div className="p-4 bg-gray-950 border-t border-gray-800 flex flex-wrap gap-2 items-center justify-between">
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => onPlay(program.channel)}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md font-medium transition-colors flex items-center gap-2 text-sm"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
              </svg>
              Play Channel
            </button>
            
            <button
              onClick={() => onToggleFavorite(program.channel.id)}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-md font-medium transition-colors flex items-center gap-2 text-sm border border-gray-700"
            >
              <svg className={`w-4 h-4 ${program.channel.isFavorite ? 'text-yellow-400' : 'text-gray-400'}`} fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.958a1 1 0 00.95.69h4.162c.969 0 1.371 1.24.588 1.81l-3.368 2.446a1 1 0 00-.363 1.118l1.287 3.957c.3.922-.755 1.688-1.538 1.118l-3.367-2.446a1 1 0 00-1.176 0l-3.367 2.446c-.783.57-1.838-.196-1.538-1.118l1.287-3.957a1 1 0 00-.363-1.118L2.063 9.385c-.783-.57-.38-1.81.588-1.81h4.163a1 1 0 00.95-.69l1.285-3.958z" />
              </svg>
              {program.channel.isFavorite ? 'Unfavorite' : 'Favorite'}
            </button>
          </div>

          <div className="flex gap-2 flex-wrap">
            {!isPast && (
              <button
                onClick={handleNotifyToggle}
                disabled={createNotif.isPending || deleteNotif.isPending}
                className={`px-4 py-2 rounded-md font-medium transition-colors flex items-center gap-2 text-sm border ${
                  notification 
                    ? 'bg-yellow-900/30 text-yellow-500 border-yellow-700 hover:bg-yellow-900/50' 
                    : 'bg-gray-800 text-gray-200 border-gray-700 hover:bg-gray-700'
                } disabled:opacity-50`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                {notification ? 'Notification Set' : 'Notify Me'}
              </button>
            )}

            {canUseDvr && (
              <button
                onClick={handleDvrToggle}
                disabled={scheduleDvr.isPending || cancelDvr.isPending}
                className={`px-4 py-2 rounded-md font-medium transition-colors flex items-center gap-2 text-sm border ${
                  dvrJob?.status === 'completed' || dvrJob?.status === 'recording'
                    ? 'bg-red-900/30 text-red-500 border-red-700 hover:bg-red-900/50 cursor-not-allowed'
                    : dvrJob 
                      ? 'bg-red-900/30 text-red-500 border-red-700 hover:bg-red-900/50' 
                      : 'bg-gray-800 text-gray-200 border-gray-700 hover:bg-gray-700'
                } disabled:opacity-50`}
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
                </svg>
                {dvrJob?.status === 'completed' ? 'Recorded' : dvrJob?.status === 'recording' ? 'Recording...' : dvrJob ? 'Cancel Recording' : 'Record'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
