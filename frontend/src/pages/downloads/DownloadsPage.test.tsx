import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { DownloadsPage } from './DownloadsPage';
import { renderWithProviders } from '../../test/renderWithProviders';
import { useDownloadStore } from '../../store/downloadStore';
import { usePlaybackStore } from '../../store/playbackStore';
import * as db from '../../services/db';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('DownloadsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDownloadStore.setState({
      tasks: {},
      isInitialized: true,
      storageUsage: { usedBytes: 500000000, quotaBytes: 2000000000 },
      initDownloads: vi.fn().mockResolvedValue(undefined),
      refreshStorage: vi.fn().mockResolvedValue(undefined),
    });
    usePlaybackStore.setState({
      watchedSummary: { seriesCounts: {}, movieIds: [] },
      isHydrated: true,
    });
  });

  it('renders empty state when no downloads exist', () => {
    renderWithProviders(<DownloadsPage />);
    expect(screen.getByText('Nenhum download concluído ainda')).toBeInTheDocument();
  });

  it('displays completed movies and marks watched movies with badge and Reassistir', () => {
    usePlaybackStore.setState({
      watchedSummary: {
        seriesCounts: {},
        movieIds: ['movie_10'],
      },
    });

    useDownloadStore.setState({
      tasks: {
        'movie_10': {
          id: 'movie_10',
          title: 'Matrix',
          mediaType: 'movie',
          remoteUrl: 'http://test.com/matrix.mp4',
          fileName: 'matrix.mp4',
          status: 'completed',
          downloadedBytes: 100000000,
          totalBytes: 100000000,
          createdAt: Date.now(),
        },
        'movie_20': {
          id: 'movie_20',
          title: 'Inception',
          mediaType: 'movie',
          remoteUrl: 'http://test.com/inception.mp4',
          fileName: 'inception.mp4',
          status: 'completed',
          downloadedBytes: 150000000,
          totalBytes: 150000000,
          createdAt: Date.now(),
        },
      },
      isInitialized: true,
    });

    renderWithProviders(<DownloadsPage />);

    expect(screen.getByText('Matrix')).toBeInTheDocument();
    expect(screen.getByText('Inception')).toBeInTheDocument();

    // Matrix is watched
    expect(screen.getByText('Assistido')).toBeInTheDocument();
    expect(screen.getByText('Reassistir')).toBeInTheDocument();
    expect(screen.getByText('Assistir')).toBeInTheDocument(); // Inception is not watched
  });

  it('displays completed series episodes and detects watched status via getWatchedEpisodesBySeries', async () => {
    vi.spyOn(db, 'getWatchedEpisodesBySeries').mockResolvedValue([
      {
        id: 'bb_s1_e0',
        seriesId: 'bb',
        seriesName: 'Breaking Bad',
        season: '1',
        episodeIndex: 0,
        title: 'Pilot',
        mediaType: 'series',
        watchedAt: Date.now(),
        autoMarked: true,
      },
    ]);

    useDownloadStore.setState({
      tasks: {
        'bb_s1_e0': {
          id: 'bb_s1_e0',
          seriesId: 'bb',
          seriesName: 'Breaking Bad',
          season: '1',
          episodeIndex: 0,
          title: 'Pilot',
          mediaType: 'series',
          remoteUrl: 'http://test.com/s1e0.mp4',
          fileName: 's1e0.mp4',
          status: 'completed',
          downloadedBytes: 200000000,
          totalBytes: 200000000,
          createdAt: Date.now(),
        },
        'bb_s1_e1': {
          id: 'bb_s1_e1',
          seriesId: 'bb',
          seriesName: 'Breaking Bad',
          season: '1',
          episodeIndex: 1,
          title: 'Cat in the Bag',
          mediaType: 'series',
          remoteUrl: 'http://test.com/s1e1.mp4',
          fileName: 's1e1.mp4',
          status: 'completed',
          downloadedBytes: 200000000,
          totalBytes: 200000000,
          createdAt: Date.now(),
        },
      },
      isInitialized: true,
    });

    renderWithProviders(<DownloadsPage />);

    expect(screen.getByText('Breaking Bad')).toBeInTheDocument();
    expect(screen.getByText('Pilot')).toBeInTheDocument();
    expect(screen.getByText('Cat in the Bag')).toBeInTheDocument();

    // After async resolution of watched episodes
    await waitFor(() => {
      expect(screen.getByText('1 de 2 assistidos')).toBeInTheDocument();
      expect(screen.getByText('Assistido')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Excluir 1 assistidos/ })).toBeInTheDocument();
    });
  });

  it('allows deleting watched downloads with the global button in the header', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const cancelSpy = vi.fn().mockResolvedValue(undefined);
    useDownloadStore.setState({
      cancelDownload: cancelSpy,
      tasks: {
        'movie_watched': {
          id: 'movie_watched',
          title: 'Watched Movie',
          mediaType: 'movie',
          remoteUrl: 'http://test.com/m.mp4',
          fileName: 'm.mp4',
          status: 'completed',
          downloadedBytes: 100000000,
          totalBytes: 100000000,
          createdAt: Date.now(),
        },
      },
      isInitialized: true,
    });

    usePlaybackStore.setState({
      watchedSummary: {
        seriesCounts: {},
        movieIds: ['movie_watched'],
      },
    });

    renderWithProviders(<DownloadsPage />);

    const globalDeleteBtn = screen.getByRole('button', { name: /Excluir Assistidos \(1\)/ });
    expect(globalDeleteBtn).toBeInTheDocument();

    fireEvent.click(globalDeleteBtn);

    expect(window.confirm).toHaveBeenCalled();
    expect(cancelSpy).toHaveBeenCalledWith('movie_watched');
  });

  it('allows deleting series watched episodes via the series header button', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const cancelSpy = vi.fn().mockResolvedValue(undefined);

    vi.spyOn(db, 'getWatchedEpisodesBySeries').mockResolvedValue([
      {
        id: 'bb_s1_e0',
        seriesId: 'bb',
        seriesName: 'Breaking Bad',
        season: '1',
        episodeIndex: 0,
        title: 'Pilot',
        mediaType: 'series',
        watchedAt: Date.now(),
        autoMarked: true,
      },
    ]);

    useDownloadStore.setState({
      cancelDownload: cancelSpy,
      tasks: {
        'bb_s1_e0': {
          id: 'bb_s1_e0',
          seriesId: 'bb',
          seriesName: 'Breaking Bad',
          season: '1',
          episodeIndex: 0,
          title: 'Pilot',
          mediaType: 'series',
          remoteUrl: 'http://test.com/s1e0.mp4',
          fileName: 's1e0.mp4',
          status: 'completed',
          downloadedBytes: 200000000,
          totalBytes: 200000000,
          createdAt: Date.now(),
        },
        'bb_s1_e1': {
          id: 'bb_s1_e1',
          seriesId: 'bb',
          seriesName: 'Breaking Bad',
          season: '1',
          episodeIndex: 1,
          title: 'Cat in the Bag',
          mediaType: 'series',
          remoteUrl: 'http://test.com/s1e1.mp4',
          fileName: 's1e1.mp4',
          status: 'completed',
          downloadedBytes: 200000000,
          totalBytes: 200000000,
          createdAt: Date.now(),
        },
      },
      isInitialized: true,
    });

    renderWithProviders(<DownloadsPage />);

    let deleteSeriesWatchedBtn: HTMLElement | null = null;
    await waitFor(() => {
      deleteSeriesWatchedBtn = screen.getByRole('button', { name: /Excluir 1 assistidos/ });
      expect(deleteSeriesWatchedBtn).toBeInTheDocument();
    });

    fireEvent.click(deleteSeriesWatchedBtn!);

    expect(window.confirm).toHaveBeenCalled();
    expect(cancelSpy).toHaveBeenCalledWith('bb_s1_e0');
    expect(cancelSpy).not.toHaveBeenCalledWith('bb_s1_e1'); // unviewed episode was preserved!
  });
});
