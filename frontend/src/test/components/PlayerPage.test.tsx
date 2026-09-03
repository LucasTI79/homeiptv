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
});
