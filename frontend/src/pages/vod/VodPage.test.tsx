import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { VodPage } from './VodPage';
import { renderWithProviders } from '../../test/renderWithProviders';
import { usePlaybackStore } from '../../store/playbackStore';
import { useUiStore } from '../../store/uiStore';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../../api/vod', () => ({
  useVodLibrary: vi.fn(() => ({
    data: {
      movies: [{ id: '1', name: 'Test Movie', type: 'movie', group: 'Action', logo: '', url: 'http://example.com/movie.mp4' }],
      series: [{ id: '2', name: 'Test Series', type: 'series', group: 'Drama', logo: '' }],
      categories: ['Action', 'Drama']
    },
    isLoading: false,
  })),
  useRefreshVod: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
  useSeriesDetails: vi.fn(() => ({
    data: {
      id: '2',
      name: 'Test Series',
      logo: '',
      seasons: { '1': [{ name: 'Ep 1', url: 'http://example.com/s1e1.mp4' }] },
    },
    isLoading: false,
  })),
}));

describe('VodPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePlaybackStore.setState({ progress: {}, favorites: [], isHydrated: true });
    useUiStore.setState({ selectedChannel: null });
  });

  it('renders the VOD grid with movies and series', () => {
    renderWithProviders(<VodPage />);
    expect(screen.getByText('Test Movie')).toBeInTheDocument();
    expect(screen.getByText('Test Series')).toBeInTheDocument();
  });

  it('renders Continue Watching rail and resumes a series with enriched episode context', async () => {
    usePlaybackStore.setState({
      progress: {
        '2_s1_e0': {
          id: '2_s1_e0',
          seriesId: '2',
          seriesName: 'Test Series',
          season: '1',
          episodeIndex: 0,
          title: 'Test Series - Ep 1',
          type: 'series',
          url: 'http://example.com/s1e1.mp4',
          currentTime: 120,
          duration: 2400,
          updatedAt: Date.now(),
          episodes: [
            { name: 'Ep 1', url: 'http://example.com/s1e1.mp4' },
            { name: 'Ep 2', url: 'http://example.com/s1e2.mp4' },
          ],
          nextEpisode: {
            url: 'http://example.com/s1e2.mp4',
            name: 'Test Series - Ep 2',
            season: '1',
            episodeIndex: 1,
          },
        },
      },
    });

    renderWithProviders(<VodPage />);

    expect(screen.getByText('Continue Watching')).toBeInTheDocument();
    expect(screen.getByText('Test Series - Ep 1')).toBeInTheDocument();

    const resumeBtn = screen.getByTitle('Resume');
    fireEvent.click(resumeBtn);

    const selected = useUiStore.getState().selectedChannel;
    expect(selected).toBeDefined();
    expect(selected?.id).toBe('2_s1_e0');
    expect(selected?.initialTime).toBe(120);
    expect(selected?.seriesContext?.episodes).toHaveLength(2);
    expect(selected?.nextEpisode?.name).toBe('Test Series - Ep 2');
    expect(mockNavigate).toHaveBeenCalledWith('/player');
  });

  it('opens series details modal when clicking series info button in Continue Watching', async () => {
    usePlaybackStore.setState({
      progress: {
        '2_s1_e0': {
          id: '2_s1_e0',
          seriesId: '2',
          seriesName: 'Test Series',
          season: '1',
          episodeIndex: 0,
          title: 'Test Series - Ep 1',
          type: 'series',
          url: 'http://example.com/s1e1.mp4',
          currentTime: 120,
          duration: 2400,
          updatedAt: Date.now(),
        },
      },
    });

    renderWithProviders(<VodPage />);

    expect(screen.getByText('Continue Watching')).toBeInTheDocument();

    const infoBtns = screen.getAllByTitle('View series details');
    expect(infoBtns.length).toBeGreaterThan(0);
    fireEvent.click(infoBtns[0]);

    // Modal should now be visible with Season 1 and episodes
    expect(screen.getByText(/Season 1/)).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('opens series details modal when clicking the series card directly in Continue Watching', async () => {
    usePlaybackStore.setState({
      progress: {
        '2_s1_e0': {
          id: '2_s1_e0',
          seriesId: '2',
          seriesName: 'Test Series',
          season: '1',
          episodeIndex: 0,
          title: 'Test Series - Ep 1',
          type: 'series',
          url: 'http://example.com/s1e1.mp4',
          currentTime: 120,
          duration: 2400,
          updatedAt: Date.now(),
        },
      },
    });

    renderWithProviders(<VodPage />);

    // Click the card title
    const titleEl = screen.getByText('Test Series - Ep 1');
    fireEvent.click(titleEl);

    expect(screen.getByText(/Season 1/)).toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('clears all in-progress items when clicking Limpar Tudo', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    usePlaybackStore.setState({
      progress: {
        'movie_1': {
          id: 'movie_1',
          title: 'Test Movie',
          type: 'movie',
          url: 'http://example.com/movie.mp4',
          currentTime: 50,
          duration: 1000,
          updatedAt: Date.now(),
        },
      },
    });

    renderWithProviders(<VodPage />);
    expect(screen.getByText('Continue Watching')).toBeInTheDocument();

    const clearAllBtn = screen.getByTitle('Limpar todos os itens em andamento');
    fireEvent.click(clearAllBtn);

    expect(screen.queryByText('Continue Watching')).not.toBeInTheDocument();
  });

  it('removes single item from Continue Watching on close button click', async () => {
    usePlaybackStore.setState({
      progress: {
        'movie_1': {
          id: 'movie_1',
          title: 'Test Movie',
          type: 'movie',
          url: 'http://example.com/movie.mp4',
          currentTime: 50,
          duration: 1000,
          updatedAt: Date.now(),
        },
      },
    });

    renderWithProviders(<VodPage />);
    const removeBtn = screen.getByTitle('Remove from Continue Watching');
    fireEvent.click(removeBtn);

    expect(screen.queryByText('Continue Watching')).not.toBeInTheDocument();
  });

  it('filters catalog items when clicking Assistidos filter', async () => {
    usePlaybackStore.setState({
      watchedSummary: {
        seriesCounts: { '2': 1 },
        movieIds: [],
      },
    });

    renderWithProviders(<VodPage />);
    expect(screen.getByText('Test Movie')).toBeInTheDocument();
    expect(screen.getByText('Test Series')).toBeInTheDocument();

    const watchedFilterBtn = screen.getByRole('button', { name: /Assistidos/ });
    fireEvent.click(watchedFilterBtn);

    // Only Test Series is watched, Test Movie should be filtered out
    expect(screen.getByText('Test Series')).toBeInTheDocument();
    expect(screen.queryByText('Test Movie')).not.toBeInTheDocument();
  });
});
