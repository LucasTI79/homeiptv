import React, { useState } from 'react';
import { useSeriesDetails, type SeriesEpisode } from '../../api/vod';
import { proxiedLogoUrl, PLACEHOLDER_LOGO } from '../guide/ChannelRow';

import { usePlaybackStore } from '../../store/playbackStore';
import { useDownloadStore } from '../../store/downloadStore';
import { FiHeart, FiDownload, FiCheckCircle, FiLoader } from 'react-icons/fi';
import { FaHeart } from 'react-icons/fa';

export interface PlayEpisodeOptions {
  url: string;
  title: string;
  season: string;
  episodeIndex: number;
  episodes: SeriesEpisode[];
  nextEpisode?: { url: string; name: string; season: string; episodeIndex: number };
}

interface SeriesModalProps {
  seriesId: string;
  seriesName: string;
  seriesLogo: string;
  onClose: () => void;
  onPlayEpisode: (options: PlayEpisodeOptions) => void;
}

export const SeriesModal: React.FC<SeriesModalProps> = ({
  seriesId,
  seriesName,
  seriesLogo,
  onClose,
  onPlayEpisode,
}) => {
  const { data: details, isLoading, error } = useSeriesDetails(seriesId);
  const [activeSeason, setActiveSeason] = useState<string>('1');

  const isFavorite = usePlaybackStore((s) => s.isFavorite(seriesId));
  const toggleFavorite = usePlaybackStore((s) => s.toggleFavorite);
  const progress = usePlaybackStore((s) => s.progress);

  const isDownloaded = useDownloadStore((s) => s.isDownloaded);
  const isDownloadingOrQueued = useDownloadStore((s) => s.isDownloadingOrQueued);
  const enqueueEpisode = useDownloadStore((s) => s.enqueueEpisode);
  const enqueueSeason = useDownloadStore((s) => s.enqueueSeason);

  const seasons = details?.seasons || {};
  const seasonKeys = Object.keys(seasons).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  const currentEpisodes: SeriesEpisode[] = seasons[activeSeason] || (seasonKeys.length > 0 ? seasons[seasonKeys[0]] || [] : []);

  const handleEpisodeClick = (ep: SeriesEpisode, idx: number) => {
    let nextEpisode: { url: string; name: string; season: string; episodeIndex: number } | undefined;

    if (idx + 1 < currentEpisodes.length) {
      const nextEp = currentEpisodes[idx + 1];
      nextEpisode = {
        url: nextEp.url,
        name: `${seriesName} - ${nextEp.name || `Ep ${idx + 2}`}`,
        season: activeSeason,
        episodeIndex: idx + 1,
      };
    } else {
      // Check if there is a next season
      const currentSeasonIdx = seasonKeys.indexOf(activeSeason);
      if (currentSeasonIdx !== -1 && currentSeasonIdx + 1 < seasonKeys.length) {
        const nextSeasonKey = seasonKeys[currentSeasonIdx + 1];
        const nextSeasonEps = seasons[nextSeasonKey] || [];
        if (nextSeasonEps.length > 0) {
          nextEpisode = {
            url: nextSeasonEps[0].url,
            name: `${seriesName} - ${nextSeasonEps[0].name || 'Ep 1'} (S${nextSeasonKey})`,
            season: nextSeasonKey,
            episodeIndex: 0,
          };
        }
      }
    }

    onPlayEpisode({
      url: ep.url,
      title: `${seriesName} - ${ep.name || `Ep ${idx + 1}`}`,
      season: activeSeason,
      episodeIndex: idx,
      episodes: currentEpisodes,
      nextEpisode,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 border border-gray-700 rounded-2xl max-w-2xl w-full p-6 shadow-2xl flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex justify-between items-start pb-4 border-b border-gray-700">
          <div className="flex gap-4 items-center min-w-0">
            <img
              src={proxiedLogoUrl(seriesLogo)}
              alt={seriesName}
              onError={(e) => { e.currentTarget.src = PLACEHOLDER_LOGO; }}
              className="w-14 h-20 object-cover rounded-lg bg-gray-900 border border-gray-700 shrink-0"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-white truncate">{seriesName}</h2>
                <button
                  type="button"
                  onClick={() => toggleFavorite(seriesId)}
                  className={`p-1.5 rounded-lg border transition ${
                    isFavorite
                      ? 'bg-rose-500/20 text-rose-400 border-rose-500/30 hover:bg-rose-500/30'
                      : 'bg-gray-700/50 text-gray-400 border-gray-600 hover:text-white hover:bg-gray-700'
                  }`}
                  title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                >
                  {isFavorite ? <FaHeart className="w-4 h-4 text-rose-500" /> : <FiHeart className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-blue-400 mt-0.5">Series Details</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-2xl leading-none p-1"
          >
            &times;
          </button>
        </div>

        {/* Modal Body */}
        {isLoading ? (
          <div className="p-12 text-center text-gray-400 space-y-2">
            <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full mx-auto" />
            <p className="text-sm">Fetching series episodes &amp; seasons...</p>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-red-400 space-y-2">
            <p className="text-sm font-semibold">Failed to load episode details for this series.</p>
            <p className="text-xs text-gray-500">The provider might not have episode data available.</p>
          </div>
        ) : seasonKeys.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            No episodes found for this series.
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0 pt-4 space-y-4">
            {/* Season Selector Tabs & Batch Download */}
            <div className="flex justify-between items-center pb-2 border-b border-gray-700/60 shrink-0 gap-2 flex-wrap">
              <div className="flex gap-2 overflow-x-auto">
                {seasonKeys.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setActiveSeason(s)}
                    className={`px-4 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition ${
                      activeSeason === s || (!seasons[activeSeason] && s === seasonKeys[0])
                        ? 'bg-blue-600 text-white shadow'
                        : 'bg-gray-900/60 text-gray-400 hover:text-white'
                    }`}
                  >
                    Season {s} ({seasons[s]?.length || 0})
                  </button>
                ))}
              </div>

              {currentEpisodes.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    enqueueSeason(
                      { id: seriesId, name: seriesName, logo: seriesLogo },
                      activeSeason,
                      currentEpisodes
                    );
                  }}
                  className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 hover:text-white rounded-lg text-xs font-semibold whitespace-nowrap transition flex items-center gap-1.5 shrink-0 shadow border border-gray-600"
                  title="Baixar todos os episódios desta temporada para assistir offline"
                >
                  <FiDownload className="w-3.5 h-3.5" />
                  <span>Baixar Temporada ({currentEpisodes.length})</span>
                </button>
              )}
            </div>

            {/* Episode List */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {currentEpisodes.map((ep, idx) => {
                const epKey = `${seriesId}_s${activeSeason}_e${idx}`;
                const epProgress = progress[epKey];
                const progressPct = epProgress && epProgress.duration > 0
                  ? Math.min(100, Math.round((epProgress.currentTime / epProgress.duration) * 100))
                  : 0;

                const isEpDownloaded = isDownloaded(epKey);
                const isEpDownloading = isDownloadingOrQueued(epKey);

                return (
                  <div
                    key={ep.url || idx}
                    className="bg-gray-900/60 border border-gray-700/50 hover:border-blue-500/50 rounded-xl p-3 flex justify-between items-center transition group relative overflow-hidden"
                  >
                    {progressPct > 0 && (
                      <div
                        className="absolute bottom-0 left-0 h-1 bg-blue-500 transition-all"
                        style={{ width: `${progressPct}%` }}
                        title={`${progressPct}% watched`}
                      />
                    )}
                    <div className="min-w-0 pr-3">
                      <p className="text-sm font-semibold text-white truncate">{ep.name || `Episode ${idx + 1}`}</p>
                      {progressPct > 0 && (
                        <p className="text-[11px] text-blue-400 mt-0.5">{progressPct}% watched</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Episode Download Button */}
                      <button
                        type="button"
                        onClick={() => {
                          if (!isEpDownloaded && !isEpDownloading) {
                            enqueueEpisode({
                              seriesId,
                              seriesName,
                              season: activeSeason,
                              episodeIndex: idx,
                              title: ep.name || `Episode ${idx + 1}`,
                              url: ep.url,
                              logo: seriesLogo,
                            });
                          }
                        }}
                        className={`p-2 rounded-lg border transition text-xs font-medium flex items-center justify-center ${
                          isEpDownloaded
                            ? 'bg-emerald-600/20 text-emerald-400 border-emerald-500/40 hover:bg-emerald-600/30'
                            : isEpDownloading
                            ? 'bg-blue-600/20 text-blue-400 border-blue-500/40 animate-pulse'
                            : 'bg-gray-800/80 text-gray-400 border-gray-700 hover:text-white hover:bg-gray-700'
                        }`}
                        title={
                          isEpDownloaded
                            ? 'Episódio baixado para reprodução offline'
                            : isEpDownloading
                            ? 'Baixando episódio...'
                            : 'Baixar episódio offline'
                        }
                      >
                        {isEpDownloaded ? (
                          <FiCheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                        ) : isEpDownloading ? (
                          <FiLoader className="w-3.5 h-3.5 animate-spin text-blue-400" />
                        ) : (
                          <FiDownload className="w-3.5 h-3.5" />
                        )}
                      </button>

                      {/* Play Button */}
                      <button
                        type="button"
                        onClick={() => handleEpisodeClick(ep, idx)}
                        className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold transition shrink-0 flex items-center gap-1.5 shadow"
                      >
                        <span>▶</span> {progressPct > 0 ? 'Resume' : 'Play'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
