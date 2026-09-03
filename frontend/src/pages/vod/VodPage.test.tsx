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
});
