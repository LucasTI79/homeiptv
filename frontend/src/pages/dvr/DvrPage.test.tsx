import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { DvrPage } from './DvrPage';
import { renderWithProviders } from '../../test/renderWithProviders';

vi.mock('../../api/dvr', () => ({
  useDvrJobs: vi.fn(() => ({
    data: [{ id: '1', programTitle: 'Test Job', channelName: 'Test Channel', startTime: new Date().toISOString(), endTime: new Date().toISOString(), status: 'scheduled' }],
    isLoading: false,
  })),
  useDvrRecordings: vi.fn(() => ({
    data: [{ id: '2', programTitle: 'Test Recording', channelName: 'Test Channel', startTime: new Date().toISOString(), durationSeconds: 3600, fileSizeBytes: 1000 }],
    isLoading: false,
  })),
  useDvrStorage: vi.fn(() => ({
    data: { total: 1000, used: 500, percentage: 50 },
    isLoading: false,
  })),
  useCancelDvrJob: vi.fn(() => ({
    mutate: vi.fn()
  }))
}));

describe('DvrPage', () => {
  it('renders scheduled jobs and completed recordings', () => {
    renderWithProviders(<DvrPage />);
    
    // Check initial state (Scheduled tab)
    expect(screen.getByText('Test Job')).toBeInTheDocument();
    
    // Switch tabs
    fireEvent.click(screen.getByText(/Completed/));
    
    // Check completed recordings
    expect(screen.getByText('Test Recording')).toBeInTheDocument();
  });
});
