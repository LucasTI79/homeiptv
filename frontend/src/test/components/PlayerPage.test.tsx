import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { PlayerPage } from '../../pages/PlayerPage';
import { renderWithProviders } from '../renderWithProviders';

// Mock the Zustand store and TanStack Query config
vi.mock('../../store/uiStore', () => ({
  useUiStore: vi.fn((selector) => {
    const store = {
      selectedChannel: { id: 'test', name: 'Test Channel', url: 'http://example.com/stream.m3u8' },
    };
    return selector(store);
  }),
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
    vi.mocked(useUiStore).mockImplementation((selector: any) => {
      const store = {
        selectedChannel: {
          id: 'movie_123',
          name: 'Downloaded Movie',
          url: 'http://example.com/movie.mp4',
          isVod: true,
          offlineFileName: 'movie_123.mp4',
        },
      };
      return selector(store);
    });

    const opfs = await import('../../services/opfsStorage');
    vi.spyOn(opfs, 'getDownloadedFile').mockResolvedValue(new File(['video-content'], 'movie_123.mp4', { type: 'video/mp4' }));

    renderWithProviders(<PlayerPage />);

    expect(screen.getByText('Downloaded Movie')).toBeInTheDocument();
    expect(await screen.findByText('Offline Local')).toBeInTheDocument();
  });
});
