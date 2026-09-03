import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useVodLibrary, useRefreshVod, type VodItem, type SeriesDetails, type SeriesEpisode } from '../../api/vod';
import { useUiStore } from '../../store/uiStore';
import { usePlaybackStore, type VodProgressItem } from '../../store/playbackStore';
import { useDownloadStore } from '../../store/downloadStore';
import { proxiedLogoUrl } from '../../components/guide/ChannelRow';
import { GuideTour } from '../../components/ui/GuideTour';
import { VodSkeleton } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/EmptyState';
import { SeriesModal, type PlayEpisodeOptions } from '../../components/vod/SeriesModal';
import { FiPlay, FiX, FiHeart, FiClock, FiDownload, FiCheckCircle, FiLoader, FiInfo } from 'react-icons/fi';
import { FaHeart } from 'react-icons/fa';
import { toast } from 'react-hot-toast';

import { PLAYBACK_CONFIG } from '../../constants';

const {
  itemsPerPage: ITEMS_PER_PAGE,
  maxContinueWatchingItems: MAX_CONTINUE_WATCHING_ITEMS,
  searchDebounceMs: SEARCH_DEBOUNCE_MS,
} = PLAYBACK_CONFIG;

export function VodPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setSelectedChannel = useUiStore((s) => s.setSelectedChannel);

  const { data: library, isLoading, error } = useVodLibrary();
  const refreshMutation = useRefreshVod();

  const progress = usePlaybackStore((s) => s.progress);
  const removeProgress = usePlaybackStore((s) => s.removeProgress);
  const favorites = usePlaybackStore((s) => s.favorites);
  const toggleFavorite = usePlaybackStore((s) => s.toggleFavorite);
  const isFavorite = usePlaybackStore((s) => s.isFavorite);
  const tasks = useDownloadStore((s) => s.tasks);
  const enqueueMovie = useDownloadStore((s) => s.enqueueMovie);
  const initDownloads = useDownloadStore((s) => s.initDownloads);

  useEffect(() => {
    initDownloads();
  }, [initDownloads]);

  const [filterType, setFilterType] = useState<'all' | 'movie' | 'series' | 'favorites'>('all');
  const [filterGroup, setFilterGroup] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [displayCount, setDisplayCount] = useState<number>(ITEMS_PER_PAGE);

  // Selected series for episode modal
  const [selectedSeries, setSelectedSeries] = useState<VodItem | null>(null);

  // Continue watching sorted list (most recently updated first, deduplicated by series)
  const continueWatchingItems = useMemo(() => {
    const sorted = Object.values(progress).sort((a, b) => b.updatedAt - a.updatedAt);
    const seenSeries = new Set<string>();
    const deduplicated: VodProgressItem[] = [];

    for (const item of sorted) {
      if (item.type === 'series' && item.seriesId) {
        if (seenSeries.has(item.seriesId)) {
          continue;
        }
        seenSeries.add(item.seriesId);
      }
      deduplicated.push(item);
    }

    return deduplicated.slice(0, MAX_CONTINUE_WATCHING_ITEMS);
  }, [progress]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
      setDisplayCount(ITEMS_PER_PAGE);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Reset display count when filters change
  useEffect(() => {
    setDisplayCount(ITEMS_PER_PAGE);
  }, [filterType, filterGroup]);
  
  const allItems = useMemo(() => {
    if (!library) return [];
    return [...library.movies, ...library.series].map(item => ({
      ...item,
      id: String(item.id)
    })).sort((a, b) => a.name.localeCompare(b.name));
  }, [library]);

  const filteredItems = useMemo(() => {
    const q = debouncedQuery.toLowerCase().trim();
    return allItems.filter(item => {
      let typeMatch = true;
      if (filterType === 'favorites') {
        typeMatch = favorites.includes(item.id);
      } else if (filterType !== 'all') {
        typeMatch = item.type === filterType;
      }

      const groupMatch = filterGroup === 'all' || item.group === filterGroup;
      const searchMatch = !q || item.name.toLowerCase().includes(q);
      return typeMatch && groupMatch && searchMatch;
    });
  }, [allItems, filterType, filterGroup, debouncedQuery, favorites]);

  const visibleItems = useMemo(() => {
    return filteredItems.slice(0, displayCount);
  }, [filteredItems, displayCount]);

  const handleVodClick = (item: VodItem) => {
    if (item.type === 'movie') {
      if (item.url) {
        setSelectedChannel({
          url: item.url,
          name: item.name,
          id: item.id,
          isVod: true,
          vodType: 'movie',
          logo: item.logo,
          originalUrl: item.url,
        });
        navigate('/player');
      }
    } else {
      setSelectedSeries(item);
    }
  };

  const handlePlayEpisode = (options: PlayEpisodeOptions) => {
    if (!selectedSeries) return;
    const series = selectedSeries;
    setSelectedSeries(null);
    setSelectedChannel({
      url: options.url,
      name: options.title,
      id: `${series.id}_s${options.season}_e${options.episodeIndex}`,
      isVod: true,
      vodType: 'series',
      logo: series.logo,
      originalUrl: options.url,
      seriesContext: {
        seriesId: series.id,
        seriesName: series.name,
        season: options.season,
        episodeIndex: options.episodeIndex,
        episodes: options.episodes,
      },
      nextEpisode: options.nextEpisode,
    });
    navigate('/player');
  };

  const handleOpenSeriesInfo = (cw: VodProgressItem) => {
    if (!cw.seriesId) return;
    const found = library?.series.find((s) => String(s.id) === String(cw.seriesId));
    const seriesItem: VodItem = found || {
      id: String(cw.seriesId),
      name: cw.seriesName || cw.title,
      type: 'series',
      group: '',
      logo: cw.logo || '',
    };
    setSelectedSeries(seriesItem);
  };

  const handleResumeContinueWatching = (cw: VodProgressItem) => {
    let episodes: SeriesEpisode[] = cw.episodes || [];
    let nextEpisode = cw.nextEpisode;

    if (cw.seriesId && (!episodes.length || !nextEpisode)) {
      try {
        const cached = queryClient.getQueryData<SeriesDetails>(['vod', 'series', cw.seriesId]);
        if (cached?.seasons) {
          const season = cw.season || '1';
          const seasonEps = cached.seasons[season] || [];
          episodes = seasonEps;
          const idx = cw.episodeIndex ?? 0;
          if (idx + 1 < seasonEps.length) {
            const nextEp = seasonEps[idx + 1];
            nextEpisode = {
              url: nextEp.url,
              name: `${cw.seriesName || cached.name} - ${nextEp.name || `Ep ${idx + 2}`}`,
              season,
              episodeIndex: idx + 1,
            };
          }
        }
      } catch {}
    }

    setSelectedChannel({
      url: cw.url,
      name: cw.title,
      id: cw.id,
      isVod: true,
      vodType: cw.type,
      logo: cw.logo,
      originalUrl: cw.url,
      initialTime: cw.currentTime,
      seriesContext: cw.seriesId ? {
        seriesId: cw.seriesId,
        seriesName: cw.seriesName || cw.title,
        season: cw.season || '1',
        episodeIndex: cw.episodeIndex || 0,
        episodes,
      } : undefined,
      nextEpisode,
    });
    navigate('/player');
  };

  if (isLoading) {
    return <VodSkeleton />;
  }

  if (error) {
    return (
      <div className="p-8">
        <EmptyState
          icon="⚠️"
          title="Failed to Load VODs"
          description="There was an error communicating with the backend VOD service."
          instructions={[
            "Check if your server is running properly.",
            "Verify your database connection and active sources in Settings."
          ]}
          primaryAction={{ label: "Retry", onClick: () => window.location.reload() }}
        />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 h-[calc(100vh-60px)] overflow-y-auto">
      <GuideTour
        tourKey="vod-tour"
        steps={[
          { element: '#vod-filters', popover: { title: 'Filters', description: 'Filter by movies, series, categories, or search by name.' } },
          { element: '#vod-grid', popover: { title: 'VOD Library', description: 'Browse available movies and series here.' } },
        ]}
      />
      {/* Continue Watching Section */}
      {continueWatchingItems.length > 0 && (
        <section className="mb-8 bg-gray-800/40 border border-gray-700/50 rounded-2xl p-4 md:p-5 backdrop-blur-xs">
          <div className="flex items-center justify-between mb-3.5">
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-blue-500/20 text-blue-400">
                <FiClock className="w-4 h-4" />
              </span>
              <h2 className="text-base font-bold text-white tracking-wide">Continue Watching</h2>
              <span className="text-xs text-gray-400 font-medium">({continueWatchingItems.length})</span>
            </div>
          </div>

          <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent">
            {continueWatchingItems.map((cw) => {
              const pct = cw.duration > 0 ? Math.min(100, Math.round((cw.currentTime / cw.duration) * 100)) : 0;
              const remainingSecs = Math.max(0, cw.duration - cw.currentTime);
              const remainingMins = Math.ceil(remainingSecs / 60);

              return (
                <div
                  key={cw.id}
                  onClick={() => {
                    if (cw.type === 'series' && cw.seriesId) {
                      handleOpenSeriesInfo(cw);
                    } else {
                      handleResumeContinueWatching(cw);
                    }
                  }}
                  className="w-48 sm:w-56 shrink-0 bg-gray-900/80 border border-gray-700/60 rounded-xl overflow-hidden hover:border-blue-500/60 transition-all flex flex-col group relative shadow-md cursor-pointer"
                >
                  <div className="relative aspect-video bg-gray-950 overflow-hidden">
                    <img
                      src={proxiedLogoUrl(cw.logo)}
                      alt={cw.title}
                      loading="lazy"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      onError={(e) => {
                        e.currentTarget.src = `https://placehold.co/400x225/111827/d1d5db?text=${encodeURIComponent(cw.title)}`;
                      }}
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleResumeContinueWatching(cw);
                        }}
                        className="w-10 h-10 rounded-full bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center text-sm shadow-xl transition hover:scale-105"
                        title="Resume"
                      >
                        <FiPlay className="w-4 h-4 fill-current ml-0.5" />
                      </button>

                      {cw.type === 'series' && cw.seriesId && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenSeriesInfo(cw);
                          }}
                          className="w-10 h-10 rounded-full bg-gray-800/90 hover:bg-gray-700 text-white flex items-center justify-center text-sm shadow-xl transition border border-gray-600 hover:scale-105"
                          title="View series details"
                        >
                          <FiInfo className="w-4 h-4" />
                        </button>
                      )}
                    </div>

                    {/* Remove from continue watching */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeProgress(cw.id);
                      }}
                      className="absolute top-1.5 right-1.5 p-1 rounded-md bg-black/70 hover:bg-red-600/80 text-gray-300 hover:text-white transition opacity-0 group-hover:opacity-100"
                      title="Remove from Continue Watching"
                    >
                      <FiX className="w-3.5 h-3.5" />
                    </button>

                    {/* Progress bar at bottom of thumbnail */}
                    <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-gray-800">
                      <div
                        className="h-full bg-blue-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>

                  <div className="p-2.5 flex flex-col justify-between flex-1">
                    <div className="flex items-start justify-between gap-1">
                      <h3 className="text-xs font-semibold text-white truncate flex-1" title={cw.title}>
                        {cw.title}
                      </h3>
                      {cw.type === 'series' && cw.seriesId && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenSeriesInfo(cw);
                          }}
                          className="text-gray-400 hover:text-blue-400 p-0.5 rounded transition shrink-0"
                          title="View series details"
                        >
                          <FiInfo className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-1 text-[11px] text-gray-400">
                      <span>{pct}% watched</span>
                      {remainingMins > 0 && <span>{remainingMins}m left</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="flex flex-col md:flex-row gap-4 mb-6 items-stretch md:items-center" id="vod-filters">
        <div className="flex bg-gray-800 rounded p-1 shrink-0">
          <button
            onClick={() => setFilterType('all')}
            className={`px-4 py-1.5 rounded text-sm font-medium transition ${filterType === 'all' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
          >
            All ({allItems.length})
          </button>
          <button
            onClick={() => setFilterType('movie')}
            className={`px-4 py-1.5 rounded text-sm font-medium transition ${filterType === 'movie' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
          >
            Movies ({library?.movies.length || 0})
          </button>
          <button
            onClick={() => setFilterType('series')}
            className={`px-4 py-1.5 rounded text-sm font-medium transition ${filterType === 'series' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
          >
            Series ({library?.series.length || 0})
          </button>
          <button
            onClick={() => setFilterType('favorites')}
            className={`px-4 py-1.5 rounded text-sm font-medium transition flex items-center gap-1.5 ${filterType === 'favorites' ? 'bg-rose-600 text-white' : 'text-gray-400 hover:text-white'}`}
          >
            <FaHeart className="w-3 h-3 text-rose-300" />
            Favorites ({favorites.length})
          </button>
        </div>

        <select
          value={filterGroup}
          onChange={(e) => setFilterGroup(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-4 py-2 text-sm text-white focus:ring-2 focus:ring-blue-500 outline-none"
        >
          <option value="all">All Categories</option>
          {library?.categories?.sort().map(cat => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>

        <input
          type="text"
          placeholder="Search movies & series..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-4 py-2 flex-grow text-sm text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 outline-none"
        />

        <button
          type="button"
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold rounded shadow transition flex items-center justify-center gap-2 shrink-0"
        >
          {refreshMutation.isPending ? (
            <>
              <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
              </svg>
              <span>Syncing VODs...</span>
            </>
          ) : (
            <>
              <span>⟳</span> Sync VODs
            </>
          )}
        </button>
      </div>

      {filteredItems.length === 0 ? (
        <EmptyState
          icon="🎬"
          title={allItems.length === 0 ? "VOD Library is Empty" : "No Results Found"}
          description={
            allItems.length === 0
              ? "You haven't synchronized movies or series from your IPTV / Xtream Codes sources yet."
              : "No titles matched your current category or search query."
          }
          instructions={
            allItems.length === 0
              ? [
                  "Make sure you have an active Xtream Codes provider configured in Settings > Playlists & Sources.",
                  "Click 'Sync VODs Now' below to download all movies and series."
                ]
              : [
                  "Check your search term for typos.",
                  "Switch back to 'All Categories' or 'All' types."
                ]
          }
          primaryAction={
            allItems.length === 0
              ? {
                  label: refreshMutation.isPending ? "Syncing VOD Library..." : "Sync VODs Now",
                  onClick: () => refreshMutation.mutate(),
                }
              : {
                  label: "Clear Search",
                  onClick: () => {
                    setSearchQuery('');
                    setFilterType('all');
                    setFilterGroup('all');
                  },
                }
          }
        />
      ) : (
        <>
          <div id="vod-grid" className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {visibleItems.map(item => {
              const itemFav = isFavorite(item.id);

              return (
                <div
                  key={item.id}
                  onClick={() => handleVodClick(item)}
                  className="bg-gray-800 rounded-xl overflow-hidden hover:ring-2 hover:ring-blue-500 cursor-pointer transition-all flex flex-col group shadow-lg relative"
                >
                  <div className="relative aspect-[2/3] bg-gray-900 overflow-hidden">
                    <img
                      src={proxiedLogoUrl(item.logo)}
                      loading="lazy"
                      decoding="async"
                      alt={item.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      onError={(e) => {
                        e.currentTarget.src = `https://placehold.co/400x600/1f2937/d1d5db?text=${encodeURIComponent(item.name)}`;
                      }}
                    />
                    <div className="absolute top-2 left-2 bg-black/75 px-2 py-0.5 rounded text-[11px] font-semibold text-gray-200">
                      {item.type === 'movie' ? 'Movie' : 'Series'}
                    </div>

                    {/* Favorite Button */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFavorite(item.id);
                      }}
                      className={`absolute top-2 right-2 p-1.5 rounded-lg backdrop-blur-xs transition z-10 ${
                        itemFav
                          ? 'bg-black/60 text-rose-500 hover:bg-black/80'
                          : 'bg-black/50 text-gray-400 hover:text-white hover:bg-black/75 opacity-0 group-hover:opacity-100'
                      }`}
                      title={itemFav ? "Remove from Favorites" : "Add to Favorites"}
                    >
                      {itemFav ? <FaHeart className="w-3.5 h-3.5" /> : <FiHeart className="w-3.5 h-3.5" />}
                    </button>

                    {/* Movie Download Button */}
                    {item.type === 'movie' && item.url && (() => {
                      const taskId = `movie_${item.id}`;
                      const movieTask = tasks[taskId];
                      const isDownloaded = movieTask?.status === 'completed';
                      const isDownloading = movieTask?.status === 'downloading';
                      const isQueued = movieTask?.status === 'queued';
                      const downloadPct = movieTask && movieTask.totalBytes > 0
                        ? Math.min(100, Math.round((movieTask.downloadedBytes / movieTask.totalBytes) * 100))
                        : 0;

                      return (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isDownloaded) {
                              toast('Este filme já foi baixado para assistir offline!');
                              return;
                            }
                            if (isDownloading || isQueued) {
                              toast('Este filme já está na fila de downloads!');
                              return;
                            }
                            toast.success(`Download de "${item.name}" adicionado à fila!`);
                            enqueueMovie({
                              id: item.id,
                              title: item.name,
                              url: item.url!,
                              logo: item.logo,
                            });
                          }}
                          className={`absolute bottom-2 right-2 px-2 py-1.5 rounded-lg backdrop-blur-xs transition z-10 flex items-center gap-1.5 text-xs font-semibold ${
                            isDownloaded
                              ? 'bg-emerald-600/90 text-white shadow'
                              : isDownloading
                              ? 'bg-blue-600/90 text-white animate-pulse shadow'
                              : isQueued
                              ? 'bg-amber-600/90 text-white shadow'
                              : 'bg-black/60 text-gray-300 hover:text-white hover:bg-black/80 opacity-0 group-hover:opacity-100'
                          }`}
                          title={
                            isDownloaded
                              ? 'Filme baixado para assistir offline'
                              : isDownloading
                              ? `Baixando filme (${downloadPct}%)`
                              : isQueued
                              ? 'Na fila de download'
                              : 'Baixar filme para assistir offline'
                          }
                        >
                          {isDownloaded ? (
                            <FiCheckCircle className="w-3.5 h-3.5" />
                          ) : isDownloading ? (
                            <>
                              <FiLoader className="w-3.5 h-3.5 animate-spin" />
                              <span className="text-[10px]">{downloadPct}%</span>
                            </>
                          ) : isQueued ? (
                            <FiClock className="w-3.5 h-3.5" />
                          ) : (
                            <FiDownload className="w-3.5 h-3.5" />
                          )}
                        </button>
                      );
                    })()}

                    <div className="absolute inset-0 bg-blue-600/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                      <span className="w-12 h-12 rounded-full bg-blue-600 text-white flex items-center justify-center text-xl shadow-xl">▶</span>
                    </div>
                  </div>
                  <div className="p-3 flex-1 flex flex-col justify-between">
                    <h3 className="font-semibold text-xs text-white truncate" title={item.name}>{item.name}</h3>
                    <p className="text-[11px] text-gray-400 truncate mt-1">{item.group}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {visibleItems.length < filteredItems.length && (
            <div className="flex justify-center py-8">
              <button
                type="button"
                onClick={() => setDisplayCount(prev => prev + ITEMS_PER_PAGE)}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg shadow transition"
              >
                Load More ({filteredItems.length - visibleItems.length} remaining)
              </button>
            </div>
          )}
        </>
      )}

      {selectedSeries && (
        <SeriesModal
          seriesId={selectedSeries.id}
          seriesName={selectedSeries.name}
          seriesLogo={selectedSeries.logo}
          onClose={() => setSelectedSeries(null)}
          onPlayEpisode={handlePlayEpisode}
        />
      )}
    </div>
  );
}
