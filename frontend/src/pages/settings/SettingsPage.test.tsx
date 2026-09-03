import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { SettingsPage } from './SettingsPage';
import { renderWithProviders } from '../../test/renderWithProviders';

// KNOWN ISSUE: this file hangs vitest's process exit when run standalone or
// as part of the full suite (all assertions pass; only the exit is affected).
// Ruled out: SourcesTab, DiagnosticsTab, GuideTour (driver.js) as the cause --
// mocking each individually did not fix it. Needs further isolation (likely
// react-hook-form/@hookform/resolvers/zod interaction, or a Vite transform
// issue specific to this file's import graph). Workaround for CI: run this
// file with `vitest run --exclude` or accept the hang and let the runner's
// own timeout kill it -- `npm test` still reports pass/fail correctly before
// hanging, it just won't return control on its own.

vi.mock('../../api/guide', () => ({
  useConfig: vi.fn(() => ({
    data: {
      settings: {
        timezoneOffset: 0,
        playerLogLevel: 'info',
        dvrLogLevel: 'warning',
        notificationLeadTime: 5,
      }
    },
    isLoading: false,
  })),
}));

vi.mock('../../api/settings', () => ({
  usePublicIp: vi.fn(() => ({
    data: { publicIp: '192.168.1.1' },
  })),
  useHardwareInfo: vi.fn(() => ({
    data: { nvidia: 'Nvidia GTX 1080' },
  })),
  useSaveGlobalSettings: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  }))
}));

describe('SettingsPage', () => {
  it('renders general settings and switches tabs', async () => {
    renderWithProviders(<SettingsPage />);
    
    // Initial tab is General
    expect(screen.getByText('General Preferences')).toBeInTheDocument();
    
    // Switch to DVR tab
    fireEvent.click(screen.getByText('DVR & Storage'));
    await waitFor(() => {
      expect(screen.getByText('DVR Configuration')).toBeInTheDocument();
    });

    // Switch to Logs tab
    fireEvent.click(screen.getByText('Logs'));
    await waitFor(() => {
      expect(screen.getByText('Log Management')).toBeInTheDocument();
    });
  });
});
