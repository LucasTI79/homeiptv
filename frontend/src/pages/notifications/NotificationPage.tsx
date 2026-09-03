import React, { useMemo } from 'react';
import { useNotifications, useDeleteNotification, useClearPastNotifications } from '../../api/notifications';
import type { ProgramNotification } from '../../api/notifications';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { FiTrash2, FiBell } from 'react-icons/fi';

export const NotificationPage: React.FC = () => {
  const { data: notifications = [], isLoading } = useNotifications();
  const deleteNotification = useDeleteNotification();
  const clearPast = useClearPastNotifications();
  const { subscribe } = usePushNotifications();
  const navigate = useNavigate();

  const { upcoming, past } = useMemo(() => {
    const now = new Date().getTime();
    const upcoming: ProgramNotification[] = [];
    const past: ProgramNotification[] = [];

    notifications.forEach((n) => {
      if (n.status === 'pending' && new Date(n.scheduledTime).getTime() > now) {
        upcoming.push(n);
      } else {
        past.push(n);
      }
    });

    upcoming.sort((a, b) => new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime());
    past.sort((a, b) => new Date(b.scheduledTime).getTime() - new Date(a.scheduledTime).getTime());

    return { upcoming, past: past.slice(0, 20) };
  }, [notifications]);

  const handleDelete = async (id: number) => {
    if (window.confirm('Delete this notification?')) {
      await deleteNotification.mutateAsync(id);
      toast.success('Notification deleted');
    }
  };

  const handleClearPast = async () => {
    if (window.confirm('Clear all past notifications?')) {
      await clearPast.mutateAsync();
      toast.success('Past notifications cleared');
    }
  };

  const handleNavigateToGuide = (n: ProgramNotification) => {
    navigate('/tvguide', {
      state: {
        highlightProgram: {
          channelId: n.channelId,
          programId: n.programId,
          programStart: n.programStart,
        },
      },
    });
  };

  if (isLoading) {
    return (
      <div className="p-8 text-center text-gray-400">
        <p>Loading notifications...</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-8">
      <h1 className="text-3xl font-bold mb-8">Notifications</h1>

      <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-4 mb-8 flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <FiBell className="text-blue-500" /> Push Notifications
          </h2>
          <p className="text-gray-400 text-sm mt-1">
            If you're not receiving notifications on this device, you can re-subscribe.
          </p>
        </div>
        <button
          onClick={() => subscribe(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded font-semibold whitespace-nowrap"
        >
          Force Re-subscribe
        </button>
      </div>

      <div className="mb-8">
        <h2 className="text-2xl font-semibold mb-4">Upcoming</h2>
        {upcoming.length === 0 ? (
          <p className="text-gray-500 italic bg-gray-800/30 p-4 rounded text-center">No upcoming notifications.</p>
        ) : (
          <div className="space-y-4">
            {upcoming.map((n) => (
              <NotificationCard
                key={n.id}
                notification={n}
                onDelete={() => handleDelete(n.id)}
                onClick={() => handleNavigateToGuide(n)}
              />
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-semibold">Past</h2>
          {past.length > 0 && (
            <button onClick={handleClearPast} className="text-sm text-red-500 hover:text-red-400 underline">
              Clear All Past
            </button>
          )}
        </div>
        {past.length === 0 ? (
          <p className="text-gray-500 italic bg-gray-800/30 p-4 rounded text-center">No past notifications.</p>
        ) : (
          <div className="space-y-4">
            {past.map((n) => (
              <NotificationCard
                key={n.id}
                notification={n}
                onDelete={() => handleDelete(n.id)}
                onClick={() => handleNavigateToGuide(n)}
                isPast
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

interface NotificationCardProps {
  notification: ProgramNotification;
  onDelete: () => void;
  onClick: () => void;
  isPast?: boolean;
}

const NotificationCard: React.FC<NotificationCardProps> = ({ notification: n, onDelete, onClick, isPast }) => {
  const programTime = new Date(n.programStart).toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const triggerTime = new Date(n.triggeredAt || n.scheduledTime).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className={`flex items-center gap-4 bg-gray-800 border border-gray-700 rounded-lg p-4 transition-colors ${isPast ? 'opacity-70' : 'hover:bg-gray-700'}`}>
      <img
        src={n.channelLogo}
        alt={n.channelName}
        className="w-12 h-12 rounded object-contain bg-gray-900 flex-shrink-0"
        onError={(e) => (e.currentTarget.src = 'https://placehold.co/48x48/1f2937/d1d5db?text=?')}
      />
      <div className="flex-grow cursor-pointer" onClick={onClick}>
        <h3 className="font-semibold text-lg text-white">{n.programTitle}</h3>
        <p className="text-gray-400 text-sm">
          {n.channelName} &bull; {programTime}
        </p>
        <p className="text-xs text-blue-400 mt-1">
          {isPast ? (
            n.status === 'sent' ? `Notified at ${triggerTime}` : `Expired at ${triggerTime}`
          ) : (
            `Scheduled for ${triggerTime}`
          )}
        </p>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="p-2 text-gray-500 hover:text-red-500 hover:bg-red-500/10 rounded transition-colors"
        title="Delete"
      >
        <FiTrash2 size={20} />
      </button>
    </div>
  );
};
