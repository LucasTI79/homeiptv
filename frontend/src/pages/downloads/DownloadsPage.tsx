import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDownloadStore } from '../../store/downloadStore';
import { useUiStore } from '../../store/uiStore';
import { usePlaybackStore } from '../../store/playbackStore';
import { getWatchedEpisodesBySeries, type DownloadTask } from '../../services/db';
import { proxiedLogoUrl } from '../../components/guide/ChannelRow';
import { toast } from 'react-hot-toast';
import {
  FiDownload,
  FiPlay,
  FiPause,
  FiTrash2,
  FiHardDrive,
  FiCheckCircle,
  FiClock,
  FiAlertCircle,
  FiRefreshCw,
  FiCheck,
} from 'react-icons/fi';

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function DownloadsPage() {
  const navigate = useNavigate();
  const setSelectedChannel = useUiStore((s) => s.setSelectedChannel);

  const tasks = useDownloadStore((s) => s.tasks);
  const storageUsage = useDownloadStore((s) => s.storageUsage);
  const initDownloads = useDownloadStore((s) => s.initDownloads);
  const refreshStorage = useDownloadStore((s) => s.refreshStorage);
  const pauseDownload = useDownloadStore((s) => s.pauseDownload);
  const resumeDownload = useDownloadStore((s) => s.resumeDownload);
  const cancelDownload = useDownloadStore((s) => s.cancelDownload);
  const maxConcurrency = useDownloadStore((s) => s.maxConcurrency);
  const setMaxConcurrency = useDownloadStore((s) => s.setMaxConcurrency);

  const isMovieWatched = usePlaybackStore((s) => s.isMovieWatched);
  const watchedSummary = usePlaybackStore((s) => s.watchedSummary);
  const [watchedEpisodesSet, setWatchedEpisodesSet] = useState<Set<string>>(new Set());

  const [activeTab, setActiveTab] = useState<'completed' | 'queue'>('completed');

  useEffect(() => {
    initDownloads();
    refreshStorage();
  }, [initDownloads, refreshStorage]);

  const taskList = useMemo(() => Object.values(tasks), [tasks]);

  const completedTasks = useMemo(
    () => taskList.filter((t) => t.status === 'completed'),
    [taskList]
  );

  const queueTasks = useMemo(
    () =>
      taskList
        .filter((t) => t.status !== 'completed')
        .sort((a, b) => b.createdAt - a.createdAt),
    [taskList]
  );

  // Group completed tasks into Movies and Series
  const completedMovies = useMemo(
    () => completedTasks.filter((t) => t.mediaType === 'movie'),
    [completedTasks]
  );

  const completedSeriesGrouped = useMemo(() => {
    const seriesMap: Record<string, { seriesName: string; logo?: string; episodes: DownloadTask[] }> = {};

    for (const task of completedTasks) {
      if (task.mediaType === 'series' && task.seriesId) {
        if (!seriesMap[task.seriesId]) {
          seriesMap[task.seriesId] = {
            seriesName: task.seriesName || 'Série',
            logo: task.logo,
            episodes: [],
          };
        }
        seriesMap[task.seriesId].episodes.push(task);
      }
    }

    // Sort episodes inside each series
    for (const group of Object.values(seriesMap)) {
      group.episodes.sort((a, b) => {
        const seasonA = parseInt(a.season || '1', 10);
        const seasonB = parseInt(b.season || '1', 10);
        if (seasonA !== seasonB) return seasonA - seasonB;
        return (a.episodeIndex || 0) - (b.episodeIndex || 0);
      });
    }

    return Object.entries(seriesMap);
  }, [completedTasks]);

  // Load watched status on-demand only for series currently downloaded
  useEffect(() => {
    const seriesIds = completedSeriesGrouped.map(([sId]) => sId);
    if (seriesIds.length === 0) {
      setWatchedEpisodesSet(new Set());
      return;
    }

    let active = true;
    Promise.all(seriesIds.map((sId) => getWatchedEpisodesBySeries(sId))).then((results) => {
      if (active) {
        const set = new Set<string>();
        for (const list of results) {
          for (const item of list) {
            set.add(item.id);
          }
        }
        setWatchedEpisodesSet(set);
      }
    });

    return () => {
      active = false;
    };
  }, [completedSeriesGrouped, watchedSummary]);

  // Find all watched downloaded tasks (both movies and series episodes)
  const watchedDownloadedTasks = useMemo(() => {
    return completedTasks.filter((task) => {
      if (task.mediaType === 'movie') {
        return isMovieWatched(task.id);
      }
      return watchedEpisodesSet.has(task.id);
    });
  }, [completedTasks, isMovieWatched, watchedEpisodesSet]);

  const watchedBytesTotal = useMemo(() => {
    return watchedDownloadedTasks.reduce((acc, t) => acc + (t.downloadedBytes || 0), 0);
  }, [watchedDownloadedTasks]);

  const handleDeleteAllWatched = async () => {
    if (watchedDownloadedTasks.length === 0) return;
    const msg = `Deseja excluir ${watchedDownloadedTasks.length} ${
      watchedDownloadedTasks.length === 1 ? 'mídia já assistida' : 'mídias já assistidas'
    }? Isso liberará aproximadamente ${formatBytes(watchedBytesTotal)} de espaço no dispositivo.`;

    if (window.confirm(msg)) {
      for (const task of watchedDownloadedTasks) {
        await cancelDownload(task.id);
      }
      toast.success(`${watchedDownloadedTasks.length} itens assistidos excluídos com sucesso!`);
    }
  };

  const handleDeleteSeriesWatched = async (seriesName: string, episodes: DownloadTask[]) => {
    const watchedEps = episodes.filter((ep) => watchedEpisodesSet.has(ep.id));
    if (watchedEps.length === 0) return;
    const bytes = watchedEps.reduce((acc, ep) => acc + (ep.downloadedBytes || 0), 0);

    if (
      window.confirm(
        `Excluir ${watchedEps.length} episódios já assistidos de "${seriesName}"? Liberará aproximadamente ${formatBytes(bytes)}.`
      )
    ) {
      for (const ep of watchedEps) {
        await cancelDownload(ep.id);
      }
      toast.success(`${watchedEps.length} episódios assistidos de "${seriesName}" excluídos!`);
    }
  };

  const handlePlayMedia = (task: DownloadTask) => {
    setSelectedChannel({
      id: task.id,
      name: task.title,
      url: task.remoteUrl,
      logo: task.logo,
      isVod: true,
      // Pass offline flag and filename to help player locate OPFS file
      offlineFileName: task.fileName,
    });
    navigate('/player');
  };

  const usedPct =
    storageUsage.quotaBytes > 0
      ? Math.min(100, (storageUsage.usedBytes / storageUsage.quotaBytes) * 100)
      : 0;

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      {/* Top Header & Storage Quota */}
      <div className="bg-gray-800 border border-gray-700/70 rounded-2xl p-5 sm:p-6 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2.5">
              <FiDownload className="text-blue-500" />
              <span>Downloads &amp; Mídia Offline</span>
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              Assista seus filmes e episódios salvos localmente mesmo sem conexão à internet.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {watchedDownloadedTasks.length > 0 && activeTab === 'completed' && (
              <button
                type="button"
                onClick={handleDeleteAllWatched}
                className="px-3 py-1.5 bg-rose-600/15 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/30 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 shadow-sm"
                title={`Excluir todos os ${watchedDownloadedTasks.length} arquivos já assistidos e liberar ${formatBytes(watchedBytesTotal)}`}
              >
                <FiTrash2 className="w-3.5 h-3.5" />
                <span>Excluir Assistidos ({watchedDownloadedTasks.length})</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                initDownloads();
                refreshStorage();
              }}
              className="p-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition"
              title="Atualizar status"
            >
              <FiRefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Disk Quota Bar */}
        <div className="bg-gray-900/80 rounded-xl p-4 border border-gray-700/50 space-y-2">
          <div className="flex justify-between items-center text-xs font-semibold">
            <span className="text-gray-300 flex items-center gap-1.5">
              <FiHardDrive className="text-blue-400" />
              <span>Armazenamento do Dispositivo</span>
            </span>
            <span className="text-gray-400">
              {formatBytes(storageUsage.usedBytes)} usados de {formatBytes(storageUsage.quotaBytes)} totais
            </span>
          </div>
          <div className="w-full bg-gray-800 rounded-full h-2.5 overflow-hidden">
            <div
              className="bg-gradient-to-r from-blue-500 to-emerald-500 h-2.5 rounded-full transition-all duration-500"
              style={{ width: `${Math.max(1, usedPct)}%` }}
            />
          </div>
        </div>

        {/* Tabs & Concurrency Selector */}
        <div className="flex justify-between items-center border-b border-gray-700 pt-2 flex-wrap gap-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('completed')}
              className={`px-4 py-2 text-sm font-semibold border-b-2 transition flex items-center gap-2 ${
                activeTab === 'completed'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              <FiCheckCircle className="w-4 h-4" />
              <span>Baixados ({completedTasks.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('queue')}
              className={`px-4 py-2 text-sm font-semibold border-b-2 transition flex items-center gap-2 ${
                activeTab === 'queue'
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              <FiClock className="w-4 h-4" />
              <span>Fila ({queueTasks.length})</span>
            </button>
          </div>

          {/* Concurrency Selector */}
          <div className="flex items-center gap-2 pb-1.5 text-xs text-gray-300">
            <span className="text-gray-400 font-medium">Downloads simultâneos:</span>
            <div className="flex bg-gray-900/90 border border-gray-700/70 rounded-lg p-0.5 gap-0.5 shadow-inner">
              {[1, 2, 3, 4, 5].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => {
                    setMaxConcurrency(num);
                    toast.success(`Downloads simultâneos configurados para ${num}!`);
                  }}
                  className={`w-6 h-6 rounded font-bold transition text-xs flex items-center justify-center ${
                    maxConcurrency === num
                      ? 'bg-blue-600 text-white shadow'
                      : 'text-gray-400 hover:text-white hover:bg-gray-800'
                  }`}
                  title={`${num} download${num > 1 ? 's' : ''} simultâneo${num > 1 ? 's' : ''}`}
                >
                  {num}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Tab: Completed Items */}
      {activeTab === 'completed' && (
        <div className="space-y-8">
          {completedTasks.length === 0 ? (
            <div className="bg-gray-800/60 border border-gray-700/60 rounded-2xl p-12 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-gray-700/50 flex items-center justify-center mx-auto text-gray-400">
                <FiDownload className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-semibold text-white">Nenhum download concluído ainda</h3>
              <p className="text-sm text-gray-400 max-w-md mx-auto">
                Navegue pelo catálogo de Filmes e Séries e clique no botão de download para salvar mídias offline neste dispositivo.
              </p>
              <button
                type="button"
                onClick={() => navigate('/vod')}
                className="mt-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg shadow transition"
              >
                Ir para o Catálogo VOD
              </button>
            </div>
          ) : (
            <>
              {/* Movies Section */}
              {completedMovies.length > 0 && (
                <div className="space-y-3">
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <span>Filmes Baixados</span>
                    <span className="text-xs bg-gray-800 px-2 py-0.5 rounded-full text-gray-400">
                      {completedMovies.length}
                    </span>
                  </h2>

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                    {completedMovies.map((movie) => (
                      <div
                        key={movie.id}
                        className="bg-gray-800 rounded-xl overflow-hidden border border-gray-700/60 hover:border-blue-500/60 transition flex flex-col group shadow-lg"
                      >
                        <div className="relative aspect-[2/3] bg-gray-900 overflow-hidden">
                          <img
                            src={proxiedLogoUrl(movie.logo)}
                            alt={movie.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            onError={(e) => {
                              e.currentTarget.src = `https://placehold.co/400x600/1f2937/d1d5db?text=${encodeURIComponent(
                                movie.title
                              )}`;
                            }}
                          />
                          <div className="absolute top-2 left-2 flex flex-col gap-1 items-start z-10">
                            <div className="bg-black/80 px-2 py-0.5 rounded text-[10px] font-semibold text-emerald-400 flex items-center gap-1">
                              <FiCheckCircle className="w-3 h-3" />
                              <span>Offline</span>
                            </div>
                            {isMovieWatched(movie.id) && (
                              <div className="bg-emerald-600/90 text-white px-2 py-0.5 rounded text-[10px] font-bold flex items-center gap-1 shadow-sm">
                                <FiCheck className="w-3 h-3" />
                                <span>Assistido</span>
                              </div>
                            )}
                          </div>

                          <div className="absolute inset-0 bg-blue-600/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <button
                              type="button"
                              onClick={() => handlePlayMedia(movie)}
                              className="w-11 h-11 rounded-full bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center text-lg shadow-xl transition"
                              title="Reproduzir Filme"
                            >
                              <FiPlay className="ml-0.5" />
                            </button>
                          </div>
                        </div>

                        <div className="p-3 flex-1 flex flex-col justify-between">
                          <div>
                            <h3 className="font-semibold text-xs text-white truncate" title={movie.title}>
                              {movie.title}
                            </h3>
                            <p className="text-[11px] text-gray-400 mt-0.5">
                              {formatBytes(movie.downloadedBytes)}
                            </p>
                          </div>
                          <div className="flex justify-between items-center mt-3 pt-2 border-t border-gray-700/50">
                            <button
                              type="button"
                              onClick={() => handlePlayMedia(movie)}
                              className="text-xs text-blue-400 hover:text-blue-300 font-semibold flex items-center gap-1"
                            >
                              <FiPlay className="w-3 h-3" />
                              <span>{isMovieWatched(movie.id) ? 'Reassistir' : 'Assistir'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => cancelDownload(movie.id)}
                              className={`p-1 rounded transition ${
                                isMovieWatched(movie.id)
                                  ? 'text-rose-400 hover:text-rose-300 hover:bg-rose-500/20'
                                  : 'text-gray-400 hover:text-rose-400'
                              }`}
                              title={isMovieWatched(movie.id) ? 'Excluir filme assistido do dispositivo' : 'Excluir arquivo do dispositivo'}
                            >
                              <FiTrash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Series Section */}
              {completedSeriesGrouped.length > 0 && (
                <div className="space-y-4">
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <span>Séries Baixadas</span>
                    <span className="text-xs bg-gray-800 px-2 py-0.5 rounded-full text-gray-400">
                      {completedSeriesGrouped.length}
                    </span>
                  </h2>

                  <div className="space-y-4">
                    {completedSeriesGrouped.map(([sId, group]) => {
                      const seriesWatchedCount = group.episodes.filter((ep) => watchedEpisodesSet.has(ep.id)).length;
                      const allDownloadedWatched = group.episodes.length > 0 && seriesWatchedCount === group.episodes.length;

                      return (
                        <div
                          key={sId}
                          className="bg-gray-800/80 border border-gray-700/70 rounded-2xl p-4 sm:p-5 space-y-4 shadow-lg"
                        >
                          <div className="flex items-center justify-between flex-wrap gap-3">
                            <div className="flex items-center gap-3">
                              <img
                                src={proxiedLogoUrl(group.logo)}
                                alt={group.seriesName}
                                className="w-12 h-16 object-cover rounded-lg bg-gray-900 border border-gray-700 shrink-0"
                                onError={(e) => {
                                  e.currentTarget.src = `https://placehold.co/100x150/1f2937/d1d5db?text=${encodeURIComponent(
                                    group.seriesName
                                  )}`;
                                }}
                              />
                              <div>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <h3 className="font-bold text-base text-white">{group.seriesName}</h3>
                                  {allDownloadedWatched ? (
                                    <span className="text-[11px] bg-emerald-900/40 text-emerald-400 border border-emerald-500/40 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
                                      <FiCheck className="w-3 h-3" />
                                      <span>Todos assistidos</span>
                                    </span>
                                  ) : seriesWatchedCount > 0 ? (
                                    <span className="text-[11px] bg-gray-700/70 text-gray-300 px-2 py-0.5 rounded-full font-medium">
                                      {seriesWatchedCount} de {group.episodes.length} assistidos
                                    </span>
                                  ) : null}
                                </div>
                                <p className="text-xs text-gray-400 mt-0.5">
                                  {group.episodes.length} episódios disponíveis para assistir offline
                                </p>
                              </div>
                            </div>

                            {seriesWatchedCount > 0 && (
                              <button
                                type="button"
                                onClick={() => handleDeleteSeriesWatched(group.seriesName, group.episodes)}
                                className="px-3 py-1.5 text-xs text-rose-300 hover:text-white bg-rose-500/15 hover:bg-rose-600 border border-rose-500/30 rounded-lg transition flex items-center gap-1.5 shadow-sm font-semibold"
                                title={`Excluir os ${seriesWatchedCount} episódios já assistidos de ${group.seriesName}`}
                              >
                                <FiTrash2 className="w-3.5 h-3.5" />
                                <span>Excluir {seriesWatchedCount} assistidos</span>
                              </button>
                            )}
                          </div>

                          {/* Episodes Grid */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                            {group.episodes.map((ep) => {
                              const isEpWatched = watchedEpisodesSet.has(ep.id);

                              return (
                                <div
                                  key={ep.id}
                                  className={`bg-gray-900/60 border rounded-xl p-3 flex justify-between items-center transition ${
                                    isEpWatched
                                      ? 'border-emerald-900/50 bg-gray-900/40 opacity-80 hover:opacity-100'
                                      : 'border-gray-700/60 hover:border-gray-600'
                                  }`}
                                >
                                  <div className="min-w-0 pr-2">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="text-[10px] font-semibold text-blue-400 bg-blue-900/30 px-1.5 py-0.5 rounded">
                                        T{ep.season || 1} E{((ep.episodeIndex ?? 0) + 1)}
                                      </span>
                                      {isEpWatched && (
                                        <span className="text-[10px] font-bold text-emerald-400 bg-emerald-950/70 border border-emerald-500/40 px-1.5 py-0.5 rounded flex items-center gap-1">
                                          <FiCheck className="w-2.5 h-2.5" />
                                          <span>Assistido</span>
                                        </span>
                                      )}
                                    </div>
                                    <h4 className="text-xs font-semibold text-white truncate mt-1" title={ep.title}>
                                      {ep.title}
                                    </h4>
                                    <p className="text-[10px] text-gray-400 mt-0.5">
                                      {formatBytes(ep.downloadedBytes)}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => handlePlayMedia(ep)}
                                      className="p-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition"
                                      title={isEpWatched ? 'Reassistir episódio' : 'Reproduzir episódio'}
                                    >
                                      <FiPlay className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => cancelDownload(ep.id)}
                                      className={`p-2 rounded-lg transition border ${
                                        isEpWatched
                                          ? 'bg-rose-500/10 hover:bg-rose-600 text-rose-300 hover:text-white border-rose-500/30'
                                          : 'bg-gray-800 hover:bg-rose-500/20 text-gray-400 hover:text-rose-400 border-gray-700'
                                      }`}
                                      title={isEpWatched ? 'Excluir episódio assistido' : 'Excluir episódio'}
                                    >
                                      <FiTrash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Tab: Queue & Active Downloads */}
      {activeTab === 'queue' && (
        <div className="space-y-3">
          {queueTasks.length === 0 ? (
            <div className="bg-gray-800/60 border border-gray-700/60 rounded-2xl p-12 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-gray-700/50 flex items-center justify-center mx-auto text-gray-400">
                <FiClock className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-semibold text-white">Fila de downloads vazia</h3>
              <p className="text-sm text-gray-400 max-w-md mx-auto">
                Nenhum download está sendo processado no momento.
              </p>
            </div>
          ) : (
            queueTasks.map((task) => {
              const progressPct =
                task.totalBytes > 0
                  ? Math.min(100, Math.round((task.downloadedBytes / task.totalBytes) * 100))
                  : 0;

              return (
                <div
                  key={task.id}
                  className="bg-gray-800 border border-gray-700/70 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-md"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-14 bg-gray-900 rounded-lg overflow-hidden shrink-0 border border-gray-700">
                      {task.logo ? (
                        <img
                          src={proxiedLogoUrl(task.logo)}
                          alt={task.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-500">
                          <FiDownload className="w-4 h-4" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                            task.status === 'downloading'
                              ? 'bg-blue-600/30 text-blue-400 border border-blue-500/40 animate-pulse'
                              : task.status === 'retrying'
                              ? 'bg-amber-600/30 text-amber-400 border border-amber-500/40 animate-pulse'
                              : task.status === 'queued'
                              ? 'bg-amber-600/20 text-amber-400 border border-amber-500/30'
                              : task.status === 'paused'
                              ? 'bg-gray-700 text-gray-300'
                              : 'bg-rose-600/20 text-rose-400 border border-rose-500/30'
                          }`}
                        >
                          {task.status === 'downloading'
                            ? 'Baixando'
                            : task.status === 'retrying'
                            ? 'Reconectando'
                            : task.status === 'queued'
                            ? 'Na Fila'
                            : task.status === 'paused'
                            ? 'Pausado'
                            : 'Erro'}
                        </span>
                        <h4 className="text-sm font-semibold text-white truncate">{task.title}</h4>
                      </div>

                      {/* Progress Metrics */}
                      <div className="flex items-center gap-3 text-xs text-gray-400 mt-1.5 flex-wrap">
                        <span>
                          {formatBytes(task.downloadedBytes)}
                          {task.totalBytes > 0 && ` de ${formatBytes(task.totalBytes)}`}
                        </span>
                        {task.status === 'downloading' && task.speedBytesPerSec ? (
                          <span className="text-blue-400 font-medium">
                            {formatBytes(task.speedBytesPerSec)}/s
                          </span>
                        ) : null}
                        {task.errorMessage && (
                          <span className={`flex items-center gap-1 ${task.status === 'retrying' ? 'text-amber-400' : 'text-rose-400'}`}>
                            <FiAlertCircle className="w-3 h-3 shrink-0" />
                            <span>{task.errorMessage}</span>
                          </span>
                        )}
                      </div>

                      {/* Progress Bar */}
                      <div className="w-full max-w-md bg-gray-900 rounded-full h-1.5 mt-2 overflow-hidden">
                        <div
                          className={`h-1.5 rounded-full transition-all duration-300 ${
                            task.status === 'error'
                              ? 'bg-rose-500'
                              : task.status === 'retrying'
                              ? 'bg-amber-500'
                              : task.status === 'paused'
                              ? 'bg-gray-500'
                              : 'bg-blue-500'
                          }`}
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                    {(task.status === 'downloading' || task.status === 'retrying') && (
                      <button
                        type="button"
                        onClick={() => pauseDownload(task.id)}
                        className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg text-xs font-semibold transition flex items-center gap-1.5"
                      >
                        <FiPause className="w-3.5 h-3.5" />
                        <span>Pausar</span>
                      </button>
                    )}

                    {(task.status === 'paused' || task.status === 'error') && (
                      <button
                        type="button"
                        onClick={() => resumeDownload(task.id)}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold transition flex items-center gap-1.5 shadow"
                      >
                        <FiPlay className="w-3.5 h-3.5" />
                        <span>Retomar</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => cancelDownload(task.id)}
                      className="p-2 bg-gray-800 hover:bg-rose-500/20 text-gray-400 hover:text-rose-400 rounded-lg transition border border-gray-700"
                      title="Cancelar e remover da fila"
                    >
                      <FiTrash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
