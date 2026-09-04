import React, { useState, useEffect } from 'react';
import { useSeriesDetails, type SeriesEpisode } from '../../api/vod';
import { proxiedLogoUrl, PLACEHOLDER_LOGO } from '../guide/ChannelRow';

import { usePlaybackStore } from '../../store/playbackStore';
import { useDownloadStore } from '../../store/downloadStore';
import { useRemoteStore } from '../../store/remoteStore';
import { getWatchedEpisodesBySeries } from '../../services/db';
import { toast } from 'react-hot-toast';
import {
  FiHeart,
  FiDownload,
  FiCheckCircle,
  FiLoader,
  FiClock,
  FiCheck,
  FiRotateCcw,
  FiTrash2,
} from 'react-icons/fi';
import { FaHeart } from 'react-icons/fa';

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

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
  const markEpisodeWatched = usePlaybackStore((s) => s.markEpisodeWatched);
  const unmarkEpisodeWatched = usePlaybackStore((s) => s.unmarkEpisodeWatched);
  const markSeasonWatched = usePlaybackStore((s) => s.markSeasonWatched);
  const unmarkSeasonWatched = usePlaybackStore((s) => s.unmarkSeasonWatched);
  const clearSeriesProgress = usePlaybackStore((s) => s.clearSeriesProgress);

  const watchedSummary = usePlaybackStore((s) => s.watchedSummary);

  // Load watched status on-demand for this specific series only
  const [watchedKeys, setWatchedKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    getWatchedEpisodesBySeries(seriesId)
      .then((records) => {
        if (active) {
          const keys = new Set(records.map((r) => r.id));
          if (watchedSummary.watchedEpisodeIds) {
            for (const id of watchedSummary.watchedEpisodeIds) {
              if (id.startsWith(`${seriesId}_`)) {
                keys.add(id);
              }
            }
          }
          setWatchedKeys(keys);
        }
      })
      .catch(() => {
        if (active && watchedSummary.watchedEpisodeIds) {
          const keys = new Set<string>();
          for (const id of watchedSummary.watchedEpisodeIds) {
            if (id.startsWith(`${seriesId}_`)) {
              keys.add(id);
            }
          }
          setWatchedKeys(keys);
        }
      });
    return () => {
      active = false;
    };
  }, [seriesId, watchedSummary.watchedEpisodeIds]);

  const tasks = useDownloadStore((s) => s.tasks);
  const initDownloads = useDownloadStore((s) => s.initDownloads);
  const enqueueEpisode = useDownloadStore((s) => s.enqueueEpisode);
  const enqueueSeason = useDownloadStore((s) => s.enqueueSeason);
  const cancelDownload = useDownloadStore((s) => s.cancelDownload);

  const clientCompletedDownloads = useRemoteStore((s) => s.clientCompletedDownloads);
  const role = useRemoteStore((s) => s.role);
  const isRemoteClient = role === 'client';

  useEffect(() => {
    initDownloads();
  }, [initDownloads]);

  const seasons = details?.seasons || {};
  const seasonKeys = Object.keys(seasons).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  const currentEpisodes: SeriesEpisode[] = seasons[activeSeason] || (seasonKeys.length > 0 ? seasons[seasonKeys[0]] || [] : []);

  const seasonEpKeys = currentEpisodes.map((_, idx) => `${seriesId}_s${activeSeason}_e${idx}`);
  const downloadedCount = seasonEpKeys.filter((k) => tasks[k]?.status === 'completed' || clientCompletedDownloads.includes(k)).length;
  const downloadingCount = seasonEpKeys.filter((k) => tasks[k]?.status === 'downloading').length;
  const queuedCount = seasonEpKeys.filter((k) => tasks[k]?.status === 'queued').length;
  const allSeasonDownloaded = currentEpisodes.length > 0 && downloadedCount === currentEpisodes.length;

  // Watched statistics for current season
  const watchedSeasonCount = currentEpisodes.filter((_, idx) => {
    const k = `${seriesId}_s${activeSeason}_e${idx}`;
    return watchedKeys.has(k);
  }).length;
  const allSeasonWatched = currentEpisodes.length > 0 && watchedSeasonCount === currentEpisodes.length;

  const seasonWatchedDownloadedCount = seasonEpKeys.filter(
    (k) => (tasks[k]?.status === 'completed' || clientCompletedDownloads.includes(k)) && watchedKeys.has(k)
  ).length;

  // Check if series has in-progress episodes in Continue Watching
  const seriesHasProgress = Object.values(progress).some(
    (item) => item.seriesId === seriesId || item.id.startsWith(`${seriesId}_`)
  );

  const handleClearSeriesProgress = async () => {
    await clearSeriesProgress(seriesId);
    toast.success('Progresso da série limpo do Continuar Assistindo!');
  };

  const handleToggleSeasonWatched = async () => {
    if (allSeasonWatched) {
      setWatchedKeys((prev) => {
        const next = new Set(prev);
        for (let i = 0; i < currentEpisodes.length; i++) {
          next.delete(`${seriesId}_s${activeSeason}_e${i}`);
        }
        return next;
      });
      await unmarkSeasonWatched(seriesId, activeSeason, currentEpisodes);
      toast('Temporada desmarcada como assistida');
    } else {
      setWatchedKeys((prev) => {
        const next = new Set(prev);
        for (let i = 0; i < currentEpisodes.length; i++) {
          next.add(`${seriesId}_s${activeSeason}_e${i}`);
        }
        return next;
      });
      await markSeasonWatched(
        { id: seriesId, name: seriesName },
        activeSeason,
        currentEpisodes.map((ep, idx) => ({ name: ep.name || `Episódio ${idx + 1}`, url: ep.url }))
      );
      toast.success(`Temporada ${activeSeason} marcada como assistida!`);
    }
  };

  const handleToggleEpisodeWatched = async (ep: SeriesEpisode, idx: number) => {
    const epKey = `${seriesId}_s${activeSeason}_e${idx}`;
    const isWatched = watchedKeys.has(epKey);
    if (isWatched) {
      setWatchedKeys((prev) => {
        const next = new Set(prev);
        next.delete(epKey);
        return next;
      });
      await unmarkEpisodeWatched(epKey, seriesId);
      toast('Episódio desmarcado');
    } else {
      setWatchedKeys((prev) => {
        const next = new Set(prev);
        next.add(epKey);
        return next;
      });
      await markEpisodeWatched({
        id: epKey,
        seriesId,
        seriesName,
        season: activeSeason,
        episodeIndex: idx,
        title: ep.name || `Episode ${idx + 1}`,
        mediaType: 'series',
        autoMarked: false,
      });
      toast.success('Episódio marcado como assistido!');
    }
  };

  const handleDownloadSeason = async () => {
    const toDownload = currentEpisodes.filter((_, idx) => {
      const k = `${seriesId}_s${activeSeason}_e${idx}`;
      return tasks[k]?.status !== 'completed' && tasks[k]?.status !== 'downloading' && tasks[k]?.status !== 'queued';
    });

    if (toDownload.length === 0) {
      toast('Todos os episódios desta temporada já foram baixados ou estão na fila!');
      return;
    }

    toast.success(`${toDownload.length} episódios da Temporada ${activeSeason} adicionados à fila de downloads!`);
    await enqueueSeason(
      { id: seriesId, name: seriesName, logo: seriesLogo },
      activeSeason,
      currentEpisodes
    );
  };

  const handleDownloadEpisode = async (ep: SeriesEpisode, idx: number) => {
    const epKey = `${seriesId}_s${activeSeason}_e${idx}`;
    const epTask = tasks[epKey];
    if (epTask?.status === 'completed') {
      if (
        window.confirm(
          `Deseja remover o download offline do episódio "${ep.name || `Episódio ${idx + 1}`}" para liberar espaço?`
        )
      ) {
        await cancelDownload(epKey);
        toast.success('Download do episódio removido!');
      }
      return;
    }
    if (epTask?.status === 'downloading' || epTask?.status === 'queued') {
      toast('Este episódio já está na fila de downloads!');
      return;
    }

    toast.success(`Download de "${ep.name || `Episódio ${idx + 1}`}" adicionado à fila!`);
    await enqueueEpisode({
      seriesId,
      seriesName,
      season: activeSeason,
      episodeIndex: idx,
      title: ep.name || `Episode ${idx + 1}`,
      url: ep.url,
      logo: seriesLogo,
    });
  };

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
      title: `${seriesName} - ${ep.name || `Episode ${idx + 1}`}`,
      season: activeSeason,
      episodeIndex: idx,
      episodes: currentEpisodes,
      nextEpisode,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 sm:p-6 animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="bg-gray-800 border border-gray-700/80 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with Series Info & Close */}
        <div className="relative p-6 bg-gradient-to-b from-gray-700/40 to-transparent border-b border-gray-700/60 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="absolute top-4 right-4 text-gray-400 hover:text-white p-2 rounded-full hover:bg-gray-700/50 transition z-10"
            title="Close"
          >
            ✕
          </button>

          <div className="flex gap-4 items-center">
            <img
              src={proxiedLogoUrl(seriesLogo)}
              alt={seriesName}
              className="w-16 h-24 sm:w-20 sm:h-28 object-cover rounded-xl shadow-lg border border-gray-700/80 bg-gray-900 shrink-0"
              onError={(e) => {
                e.currentTarget.src = PLACEHOLDER_LOGO;
              }}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-3">
                <h2 className="text-xl sm:text-2xl font-bold text-white truncate" title={seriesName}>
                  {seriesName}
                </h2>
                <button
                  type="button"
                  onClick={() => toggleFavorite(seriesId)}
                  className={`p-1.5 rounded-lg transition ${
                    isFavorite
                      ? 'text-rose-500 hover:bg-gray-700/50'
                      : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
                  }`}
                  title={isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
                >
                  {isFavorite ? <FaHeart className="w-5 h-5" /> : <FiHeart className="w-5 h-5" />}
                </button>

                {seriesHasProgress && (
                  <button
                    type="button"
                    onClick={handleClearSeriesProgress}
                    className="px-2.5 py-1 text-xs bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 rounded-lg transition flex items-center gap-1.5 shadow ml-auto sm:ml-0"
                    title="Limpar episódios em andamento desta série no Continuar Assistindo"
                  >
                    <FiTrash2 className="w-3.5 h-3.5" />
                    <span>Limpar progresso da série</span>
                  </button>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-1">
                {seasonKeys.length} {seasonKeys.length === 1 ? 'Season' : 'Seasons'} Available
              </p>
            </div>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-hidden p-6 flex flex-col min-h-0">
          {isLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error || !details ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-gray-400">
              <p className="text-rose-400 font-semibold mb-2">Failed to load series details</p>
              <p className="text-xs max-w-sm">Please check your connection and try again.</p>
            </div>
          ) : seasonKeys.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
              No episodes found for this series.
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0 pt-1 space-y-4">
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
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Batch Watched Toggle */}
                    <button
                      type="button"
                      onClick={handleToggleSeasonWatched}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition flex items-center gap-1.5 shrink-0 shadow border ${
                        allSeasonWatched
                          ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-600/30'
                          : 'bg-gray-800/80 text-gray-300 border-gray-700 hover:text-white hover:bg-gray-700'
                      }`}
                      title={
                        allSeasonWatched
                          ? 'Desmarcar todos os episódios desta temporada'
                          : 'Marcar todos os episódios desta temporada como assistidos'
                      }
                    >
                      {allSeasonWatched ? (
                        <>
                          <FiRotateCcw className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Temporada Assistida ({watchedSeasonCount}/{currentEpisodes.length})</span>
                        </>
                      ) : (
                        <>
                          <FiCheck className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Marcar Temporada ({watchedSeasonCount}/{currentEpisodes.length})</span>
                        </>
                      )}
                    </button>

                    {allSeasonDownloaded ? (
                      <div className="px-3 py-1.5 bg-emerald-600/20 text-emerald-400 border border-emerald-500/40 rounded-lg text-xs font-semibold flex items-center gap-1.5 shrink-0 shadow">
                        <FiCheckCircle className="w-4 h-4 text-emerald-400" />
                        <span>Temporada Baixada ({downloadedCount}/{currentEpisodes.length})</span>
                      </div>
                    ) : downloadingCount > 0 || queuedCount > 0 ? (
                      <div className="flex items-center gap-2">
                        <div className="px-3 py-1.5 bg-blue-600/20 text-blue-400 border border-blue-500/40 rounded-lg text-xs font-semibold flex items-center gap-1.5 shrink-0 animate-pulse">
                          <FiLoader className="w-3.5 h-3.5 animate-spin text-blue-400" />
                          <span>Baixando ({downloadedCount}/{currentEpisodes.length} prontos)</span>
                        </div>
                        {currentEpisodes.length > (downloadedCount + downloadingCount + queuedCount) && (
                          <button
                            type="button"
                            onClick={handleDownloadSeason}
                            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 hover:text-white rounded-lg text-xs font-semibold whitespace-nowrap transition flex items-center gap-1.5 shrink-0 shadow border border-gray-600"
                          >
                            <FiDownload className="w-3.5 h-3.5" />
                            <span>Baixar Restantes</span>
                          </button>
                        )}
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={handleDownloadSeason}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold whitespace-nowrap transition flex items-center gap-1.5 shrink-0 shadow"
                        title="Baixar todos os episódios desta temporada para assistir offline"
                      >
                        <FiDownload className="w-3.5 h-3.5" />
                        <span>Baixar Temporada ({currentEpisodes.length})</span>
                      </button>
                    )}

                    {seasonWatchedDownloadedCount > 0 && (
                      <button
                        type="button"
                        onClick={async () => {
                          const toDelete = seasonEpKeys.filter((k) => tasks[k]?.status === 'completed' && watchedKeys.has(k));
                          if (window.confirm(`Excluir ${toDelete.length} episódios baixados e já assistidos da Temporada ${activeSeason}?`)) {
                            for (const k of toDelete) {
                              await cancelDownload(k);
                            }
                            toast.success(`${toDelete.length} episódios assistidos excluídos do disco!`);
                          }
                        }}
                        className="px-2.5 py-1.5 bg-rose-600/15 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/30 rounded-lg text-xs font-semibold whitespace-nowrap transition flex items-center gap-1.5 shrink-0 shadow"
                        title="Excluir do dispositivo apenas os episódios desta temporada que você já assistiu"
                      >
                        <FiTrash2 className="w-3.5 h-3.5" />
                        <span>Excluir Assistidos ({seasonWatchedDownloadedCount})</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Episode List */}
              <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                {currentEpisodes.map((ep, idx) => {
                  const epKey = `${seriesId}_s${activeSeason}_e${idx}`;
                  const isEpWatched = watchedKeys.has(epKey);
                  const epProgress = progress[epKey];
                  const progressPct = epProgress && epProgress.duration > 0
                    ? Math.min(100, Math.round((epProgress.currentTime / epProgress.duration) * 100))
                    : 0;

                  const epTask = tasks[epKey];
                  const isEpDownloaded = epTask?.status === 'completed' || clientCompletedDownloads.includes(epKey);
                  const isEpDownloading = epTask?.status === 'downloading';
                  const isEpQueued = epTask?.status === 'queued';
                  const downloadPct = epTask && epTask.totalBytes > 0
                    ? Math.min(100, Math.round((epTask.downloadedBytes / epTask.totalBytes) * 100))
                    : 0;

                  return (
                    <div
                      key={ep.url || idx}
                      className={`border rounded-xl p-3 flex justify-between items-center transition group relative overflow-hidden ${
                        isEpDownloading
                          ? 'bg-blue-950/30 border-blue-500/50 shadow-md shadow-blue-500/10'
                          : isEpDownloaded
                          ? 'bg-gray-900/60 border-emerald-500/30'
                          : isEpWatched
                          ? 'bg-gray-900/40 border-gray-700/40 opacity-75 hover:opacity-100'
                          : 'bg-gray-900/60 border-gray-700/50 hover:border-blue-500/50'
                      }`}
                    >
                      {/* Watch progress bar */}
                      {progressPct > 0 && !isEpDownloading && (
                        <div
                          className="absolute bottom-0 left-0 h-1 bg-blue-500 transition-all"
                          style={{ width: `${progressPct}%` }}
                          title={`${progressPct}% watched`}
                        />
                      )}

                      {/* Active download progress bar */}
                      {isEpDownloading && (
                        <div className="absolute bottom-0 left-0 right-0 h-1 bg-gray-800 overflow-hidden">
                          <div
                            className="bg-gradient-to-r from-blue-500 to-emerald-400 h-full transition-all duration-300"
                            style={{ width: `${Math.max(2, downloadPct)}%` }}
                          />
                        </div>
                      )}

                      <div className="min-w-0 pr-3 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[10px] font-semibold text-gray-400 bg-gray-800 px-1.5 py-0.5 rounded">
                            E{idx + 1}
                          </span>
                          <p className="text-sm font-semibold text-white truncate">{ep.name || `Episode ${idx + 1}`}</p>
                        </div>

                        {/* Download & watch status badges */}
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          {isEpWatched && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                              <FiCheck className="w-3 h-3 text-emerald-400" />
                              <span>Assistido</span>
                            </span>
                          )}

                          {isEpDownloading && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-600/30 text-blue-300 border border-blue-500/50 flex items-center gap-1.5 animate-pulse">
                              <FiLoader className="w-3 h-3 animate-spin text-blue-400" />
                              <span>Baixando: {downloadPct}%</span>
                              {epTask.speedBytesPerSec ? (
                                <span className="text-blue-400 font-semibold">• {formatBytes(epTask.speedBytesPerSec)}/s</span>
                              ) : null}
                              <span>• {formatBytes(epTask.downloadedBytes)}</span>
                            </span>
                          )}

                          {isEpQueued && (
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-600/20 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                              <FiClock className="w-3 h-3" />
                              <span>Na fila de download</span>
                            </span>
                          )}

                          {isEpDownloaded && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                              <FiCheckCircle className="w-3 h-3 text-emerald-400" />
                              <span>{isRemoteClient ? '💾 Baixado no PC' : 'Baixado offline'} {epTask?.downloadedBytes ? `• ${formatBytes(epTask.downloadedBytes)}` : ''}</span>
                            </span>
                          )}

                          {progressPct > 0 && (
                            <span className="text-[11px] text-blue-400 font-medium">
                              {progressPct}% assistido
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {/* Watched Toggle Button */}
                        <button
                          type="button"
                          onClick={() => handleToggleEpisodeWatched(ep, idx)}
                          className={`p-2 rounded-lg border transition text-xs font-medium flex items-center justify-center ${
                            isEpWatched
                              ? 'bg-emerald-600/20 text-emerald-400 border-emerald-500/40 hover:bg-emerald-600/30'
                              : 'bg-gray-800/80 text-gray-400 border-gray-700 hover:text-white hover:bg-gray-700'
                          }`}
                          title={isEpWatched ? 'Desmarcar como assistido' : 'Marcar episódio como assistido'}
                        >
                          <FiCheck className={`w-3.5 h-3.5 ${isEpWatched ? 'text-emerald-400' : 'text-gray-400'}`} />
                        </button>

                        {/* Episode Download Button */}
                        <button
                          type="button"
                          onClick={() => {
                            if (isEpDownloaded && isRemoteClient) {
                              handleEpisodeClick(ep, idx);
                              return;
                            }
                            handleDownloadEpisode(ep, idx);
                          }}
                          className={`p-2 rounded-lg border transition text-xs font-medium flex items-center justify-center ${
                            isEpDownloaded
                              ? 'bg-emerald-600/20 text-emerald-400 border-emerald-500/40 hover:bg-emerald-600/30'
                              : isEpDownloading
                              ? 'bg-blue-600/30 text-blue-300 border-blue-500/50'
                              : isEpQueued
                              ? 'bg-amber-600/20 text-amber-400 border-amber-500/30'
                              : 'bg-gray-800/80 text-gray-400 border-gray-700 hover:text-white hover:bg-gray-700'
                          }`}
                          title={
                            isEpDownloaded
                              ? isRemoteClient ? 'Episódio baixado no PC (clique para reproduzir)' : 'Episódio baixado offline (clique para remover download)'
                              : isEpDownloading
                              ? `Baixando episódio (${downloadPct}%)`
                              : isEpQueued
                              ? 'Aguardando na fila de download'
                              : 'Baixar episódio offline'
                          }
                        >
                          {isEpDownloaded ? (
                            <FiCheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                          ) : isEpDownloading ? (
                            <FiLoader className="w-3.5 h-3.5 animate-spin text-blue-400" />
                          ) : isEpQueued ? (
                            <FiClock className="w-3.5 h-3.5 text-amber-400" />
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
                          <span>▶</span> {isEpWatched ? 'Reassistir' : progressPct > 0 ? 'Resume' : 'Play'}
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
    </div>
  );
};
