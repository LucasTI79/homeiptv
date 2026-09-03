import React, { useEffect, useRef, useState } from 'react';
import mpegts from 'mpegts.js';
import { useConfig } from '../../api/guide';
import { FiPlay, FiPause, FiVolumeX, FiVolume2, FiMaximize, FiX } from 'react-icons/fi';
import { toast } from 'react-hot-toast';

interface MultiviewPlayerProps {
  id: string;
  channel: {
    id: string;
    name: string;
    url: string;
    logo?: string;
  } | null;
  isActive: boolean;
  onActivate: (id: string) => void;
  onRemove: (id: string) => void;
  onSelectChannel: (id: string) => void;
}

export const MultiviewPlayer: React.FC<MultiviewPlayerProps> = ({
  id,
  channel,
  isActive,
  onActivate,
  onRemove,
  onSelectChannel,
}) => {
  const { data: config } = useConfig();
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<mpegts.Player | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [volume, setVolume] = useState(0.5);

  useEffect(() => {
    // When isActive changes, update volume/mute state
    if (videoRef.current) {
      if (isActive) {
        videoRef.current.muted = isMuted;
        videoRef.current.volume = volume;
      } else {
        videoRef.current.muted = true;
      }
    }
  }, [isActive, isMuted, volume]);

  useEffect(() => {
    if (!channel || !config) return;

    const isVod = ['.mkv', '.mp4', '.avi', '.webm'].some((ext) => channel.url.toLowerCase().includes(ext));

    let streamUrlToPlay = channel.url;
    let useNativeVideo = false;

    if (isVod) {
      const profileId = 'ffmpeg-fmp4';
      streamUrlToPlay = `/stream?url=${encodeURIComponent(channel.url)}&profileId=${profileId}&userAgentId=${config.settings.activeUserAgentId}`;
      useNativeVideo = true;
    } else {
      const profileId = config.settings.activeStreamProfileId;
      const profile = (config.settings.streamProfiles || []).find((p: { id: string; command: string }) => p.id === profileId);
      if (profile && profile.command !== 'redirect') {
        streamUrlToPlay = `/stream?url=${encodeURIComponent(channel.url)}&profileId=${profileId}&userAgentId=${config.settings.activeUserAgentId}`;
      }
    }

    if (useNativeVideo) {
      if (videoRef.current) {
        videoRef.current.src = streamUrlToPlay;
        videoRef.current.play().catch(() => toast.error(`Failed to play ${channel.name}`));
        setIsPlaying(true);
      }
    } else {
      if (mpegts.isSupported() && videoRef.current) {
        const player = mpegts.createPlayer(
          {
            type: 'mse',
            isLive: true,
            url: streamUrlToPlay,
          },
          {
            enableStashBuffer: true,
            stashInitialSize: 4096,
          }
        );

        playerRef.current = player;
        player.attachMediaElement(videoRef.current);
        player.load();
        Promise.resolve(player.play()).catch(() => toast.error(`Failed to play ${channel.name}`));
        setIsPlaying(true);
      }
    }

    return () => {
      if (playerRef.current) {
        playerRef.current.pause();
        playerRef.current.unload();
        playerRef.current.detachMediaElement();
        playerRef.current.destroy();
        playerRef.current = null;
      } else if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.src = '';
        videoRef.current.load();
      }
    };
  }, [channel, config]);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play();
      setIsPlaying(true);
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    setIsMuted(!isMuted);
  };

  return (
    <div
      onClick={() => onActivate(id)}
      className={`w-full h-full flex flex-col bg-gray-900 border-2 rounded overflow-hidden ${
        isActive ? 'border-blue-500' : 'border-transparent hover:border-gray-600'
      }`}
    >
      <div className="flex items-center justify-between p-2 bg-black text-white text-sm">
        <span className="font-semibold truncate pr-2">{channel?.name || 'No Channel'}</span>
        <div className="flex items-center gap-2">
          {channel && (
            <>
              <button onClick={(e) => { e.stopPropagation(); togglePlay(); }} className="hover:text-blue-400">
                {isPlaying ? <FiPause /> : <FiPlay />}
              </button>
              <button onClick={(e) => { e.stopPropagation(); toggleMute(); }} className="hover:text-blue-400">
                {isMuted ? <FiVolumeX /> : <FiVolume2 />}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={volume}
                onChange={(e) => {
                  setVolume(parseFloat(e.target.value));
                  setIsMuted(false);
                }}
                className="w-16 accent-blue-500 hidden md:block"
                onClick={(e) => e.stopPropagation()}
              />
              <button onClick={(e) => { e.stopPropagation(); videoRef.current?.requestFullscreen(); }} className="hover:text-blue-400">
                <FiMaximize />
              </button>
            </>
          )}
          <button onClick={(e) => { e.stopPropagation(); onRemove(id); }} className="hover:text-red-500 text-gray-400">
            <FiX />
          </button>
        </div>
      </div>
      <div className="flex-1 relative bg-black flex items-center justify-center">
        {channel ? (
          <video ref={videoRef} className="w-full h-full object-contain" onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} />
        ) : (
          <button
            onClick={() => onSelectChannel(id)}
            className="flex flex-col items-center justify-center text-gray-500 hover:text-white transition-colors"
          >
            <FiPlay className="w-12 h-12 mb-2" />
            <span>Click to Select Channel</span>
          </button>
        )}
      </div>
    </div>
  );
};
