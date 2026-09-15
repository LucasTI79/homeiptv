import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { PlayerPage } from '../../pages/PlayerPage';
import { renderWithProviders } from '../renderWithProviders';
import type { UiState } from '../../store/uiStore';

const createMockUiStore = (overrides?: Partial<UiState>): UiState => ({
  isMobileNavOpen: false,
  setMobileNavOpen: vi.fn(),
  selectedChannel: { id: 'test', name: 'Test Channel', url: 'http://example.com/stream.m3u8' },
  setSelectedChannel: vi.fn(),
  appName: 'ViniPlay',
  setAppName: vi.fn(),
  ...overrides,
});

// Mock the Zustand store and TanStack Query config
vi.mock('../../store/uiStore', () => ({
  useUiStore: vi.fn((selector) => selector(createMockUiStore())),
}));

vi.mock('../../api/guide', () => ({
  useConfig: vi.fn(() => ({
    data: {
      settings: {
        activeStreamProfileId: 'ffmpeg',
        activeUserAgentId: 'default',
        streamProfiles: [{ id: 'ffmpeg', command: 'ffmpeg' }],
      }
    }
  })),
}));

// Mock mpegts to avoid browser API issues in JSDOM
vi.mock('mpegts.js', () => ({
  default: {
    isSupported: vi.fn(() => true),
    Events: { ERROR: 'error' },
    createPlayer: vi.fn(() => ({
      on: vi.fn(),
      attachMediaElement: vi.fn(),
      load: vi.fn(),
      play: vi.fn(() => Promise.resolve()),
      pause: vi.fn(),
      unload: vi.fn(),
      detachMediaElement: vi.fn(),
      destroy: vi.fn(),
    })),
  }
}));

describe('PlayerPage', () => {
  it('renders the selected channel name and video player', () => {
    renderWithProviders(<PlayerPage />);

    // Channel name from the store mock
    expect(screen.getByText('Test Channel')).toBeInTheDocument();

    // Video element should be present
    const videoElement = document.querySelector('video');
    expect(videoElement).toBeInTheDocument();
  });

  it('renders the offline badge when playing from local storage', async () => {
    const { useUiStore } = await import('../../store/uiStore');
    vi.mocked(useUiStore).mockImplementation((selector) =>
      selector(
        createMockUiStore({
          selectedChannel: {
            id: 'movie_123',
            name: 'Downloaded Movie',
            url: 'http://example.com/movie.mp4',
            isVod: true,
            offlineFileName: 'movie_123.mp4',
          },
        })
      )
    );

    const opfs = await import('../../services/opfsStorage');
    vi.spyOn(opfs, 'getDownloadedFile').mockResolvedValue(new File(['video-content'], 'movie_123.mp4', { type: 'video/mp4' }));

    renderWithProviders(<PlayerPage />);

    expect(screen.getByText('Downloaded Movie')).toBeInTheDocument();
    expect(await screen.findByText('Offline Local')).toBeInTheDocument();
  });

  it('renders playback speed button and adjusts speed when preset is clicked', async () => {
    const { useUiStore } = await import('../../store/uiStore');
    vi.mocked(useUiStore).mockImplementation((selector) =>
      selector(
        createMockUiStore({
          selectedChannel: {
            id: 'test_vid',
            name: 'Speed Test Video',
            url: 'http://example.com/vid.mp4',
            isVod: true,
          },
        })
      )
    );

    const { fireEvent } = await import('@testing-library/react');
    renderWithProviders(<PlayerPage />);

    // Playback speed button should be rendered
    const speedBtn = screen.getByRole('button', { name: 'Ajustar velocidade de reprodução' });
    expect(speedBtn).toBeInTheDocument();

    // Click to open speed popover
    fireEvent.click(speedBtn);

    expect(screen.getByText('Velocidade')).toBeInTheDocument();
    const btn15 = screen.getByRole('button', { name: '1.5x' });
    expect(btn15).toBeInTheDocument();

    // Click 1.5x
    fireEvent.click(btn15);

    const videoElement = document.querySelector('video');
    expect(videoElement?.playbackRate).toBe(1.5);
  });

  it('marks current episode as watched and removes progress when Next Episode is clicked', async () => {
    const { usePlaybackStore } = await import('../../store/playbackStore');
    const markEpisodeWatchedSpy = vi.fn();
    const removeProgressSpy = vi.fn();
    const saveProgressSpy = vi.fn();

    usePlaybackStore.setState({
      markEpisodeWatched: markEpisodeWatchedSpy,
      removeProgress: removeProgressSpy,
      saveProgress: saveProgressSpy,
    });

    const { useUiStore } = await import('../../store/uiStore');
    const setSelectedChannelSpy = vi.fn();

    vi.mocked(useUiStore).mockImplementation((selector) =>
      selector(
        createMockUiStore({
          selectedChannel: {
            id: 'series_1_s1_e0',
            name: 'My Series - Ep 1',
            url: 'http://example.com/ep1.mp4',
            isVod: true,
            vodType: 'series',
            seriesContext: {
              seriesId: 'series_1',
              seriesName: 'My Series',
              season: '1',
              episodeIndex: 0,
              episodes: [
                { name: 'Ep 1', url: 'http://example.com/ep1.mp4' },
                { name: 'Ep 2', url: 'http://example.com/ep2.mp4' },
              ],
            },
            nextEpisode: {
              url: 'http://example.com/ep2.mp4',
              name: 'My Series - Ep 2',
              season: '1',
              episodeIndex: 1,
            },
          },
          setSelectedChannel: setSelectedChannelSpy,
        })
      )
    );

    const { fireEvent } = await import('@testing-library/react');
    renderWithProviders(<PlayerPage />);

    const nextEpBtn = screen.getByTitle('Próximo episódio');
    expect(nextEpBtn).toBeInTheDocument();

    fireEvent.click(nextEpBtn);

    // Verify current episode was marked as watched
    expect(markEpisodeWatchedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'series_1_s1_e0',
        seriesId: 'series_1',
        seriesName: 'My Series',
        season: '1',
        episodeIndex: 0,
        title: 'My Series - Ep 1',
        mediaType: 'series',
        autoMarked: true,
      })
    );

    // Verify progress of the old episode was removed
    expect(removeProgressSpy).toHaveBeenCalledWith('series_1_s1_e0');

    // Verify progress for the new episode was initiated
    expect(saveProgressSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'series_1_s1_e1',
        seriesId: 'series_1',
        currentTime: 0,
      })
    );

    // Verify setSelectedChannel was called with initialTime: 0
    expect(setSelectedChannelSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'series_1_s1_e1',
        url: 'http://example.com/ep2.mp4',
        initialTime: 0,
      })
    );
  });

  it('does not advance to next episode on premature ended event when duration is not near completion', async () => {
    const { useUiStore } = await import('../../store/uiStore');
    const { usePlaybackStore } = await import('../../store/playbackStore');

    const markEpisodeWatchedSpy = vi.fn();
    const setSelectedChannelSpy = vi.fn();
    usePlaybackStore.setState({
      markEpisodeWatched: markEpisodeWatchedSpy,
    });

    vi.mocked(useUiStore).mockImplementation((selector) =>
      selector(
        createMockUiStore({
          selectedChannel: {
            id: 'series_1_s1_e0',
            name: 'My Series - Ep 1',
            url: 'http://example.com/ep1.mp4',
            isVod: true,
            duration: 2700,
            seriesContext: {
              seriesId: 'series_1',
              seriesName: 'My Series',
              season: '1',
              episodeIndex: 0,
              episodes: [
                { name: 'Ep 1', url: 'http://example.com/ep1.mp4', duration: 2700 },
                { name: 'Ep 2', url: 'http://example.com/ep2.mp4', duration: 2700 },
              ],
            },
            nextEpisode: {
              url: 'http://example.com/ep2.mp4',
              name: 'My Series - Ep 2',
              season: '1',
              episodeIndex: 1,
              duration: 2700,
            },
          },
          setSelectedChannel: setSelectedChannelSpy,
        })
      )
    );

    const { fireEvent } = await import('@testing-library/react');
    renderWithProviders(<PlayerPage />);

    const video = document.querySelector('video');
    expect(video).toBeInTheDocument();

    if (video) {
      Object.defineProperty(video, 'currentTime', { value: 120, writable: true });
      fireEvent.ended(video);
    }

    expect(markEpisodeWatchedSpy).not.toHaveBeenCalled();
    expect(setSelectedChannelSpy).not.toHaveBeenCalled();
  });

  it('resets currentTime to 0 and selects previous episode when Previous Episode is clicked', async () => {
    const { useUiStore } = await import('../../store/uiStore');
    const setSelectedChannelSpy = vi.fn();

    vi.mocked(useUiStore).mockImplementation((selector) =>
      selector(
        createMockUiStore({
          selectedChannel: {
            id: 'series_1_s1_e1',
            name: 'My Series - Ep 2',
            url: 'http://example.com/ep2.mp4',
            isVod: true,
            vodType: 'series',
            seriesContext: {
              seriesId: 'series_1',
              seriesName: 'My Series',
              season: '1',
              episodeIndex: 1,
              episodes: [
                { name: 'Ep 1', url: 'http://example.com/ep1.mp4', duration_secs: 2400 },
                { name: 'Ep 2', url: 'http://example.com/ep2.mp4', duration_secs: 2600 },
              ],
            },
          },
          setSelectedChannel: setSelectedChannelSpy,
        })
      )
    );

    const { fireEvent } = await import('@testing-library/react');
    renderWithProviders(<PlayerPage />);

    const prevEpBtn = screen.getByTitle('Episódio anterior');
    expect(prevEpBtn).toBeInTheDocument();

    fireEvent.click(prevEpBtn);

    expect(setSelectedChannelSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'series_1_s1_e0',
        url: 'http://example.com/ep1.mp4',
        duration: 2400,
        initialTime: 0,
      })
    );
  });
});

