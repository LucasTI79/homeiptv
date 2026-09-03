import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { AdminPage } from './AdminPage';
import { renderWithProviders } from '../../test/renderWithProviders';

vi.mock('../../api/admin', () => ({
  useSystemHealth: vi.fn(() => ({
    data: { cpu: { load: 45 }, memory: { percent: 60 }, disks: { dvr: { percent: 20 } } },
    isLoading: false,
  })),
  useAnalytics: vi.fn(() => ({
    data: { topChannels: [{ channel_name: 'Test Ch 1', total_duration: 3600 }], topUsers: [] },
    isLoading: false,
  })),
  useActivityData: vi.fn(() => ({
    data: {
      live: [{ streamKey: '123', username: 'testuser', channelName: 'Live Ch', startTime: new Date().toISOString() }],
      history: { items: [], totalPages: 1, totalItems: 0, currentPage: 1 }
    },
    isLoading: false,
  })),
  useStopStream: vi.fn(() => ({
    mutate: vi.fn()
  })),
  useClearHistory: vi.fn(() => ({
    mutate: vi.fn()
  })),
  useDeleteHistoryEntry: vi.fn(() => ({
    mutate: vi.fn()
  })),
}));

describe('AdminPage', () => {
  it('renders health stats and live activity', () => {
    renderWithProviders(<AdminPage />);
    
    // Check health stats
    expect(screen.getByText('45%')).toBeInTheDocument(); // CPU
    expect(screen.getByText('60%')).toBeInTheDocument(); // RAM
    
    // Check live activity
    expect(screen.getByText('testuser')).toBeInTheDocument();
    expect(screen.getByText('Live Ch')).toBeInTheDocument();
  });
});
