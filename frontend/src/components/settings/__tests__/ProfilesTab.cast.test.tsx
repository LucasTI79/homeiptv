import { screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ProfilesTab } from '../ProfilesTab';
import { renderWithProviders } from '../../../test/renderWithProviders';

vi.mock('../../../api/settings', () => ({
  useHardwareInfo: () => ({ data: {}, refetch: vi.fn(), isFetching: false }),
  useSaveGlobalSettings: () => ({ mutate: vi.fn(), isPending: false }),
}));

describe('ProfilesTab Cast settings', () => {
  it('renders Google Cast Application ID input and timeout selector', () => {
    renderWithProviders(
      <ProfilesTab
        settings={
          {
            castReceiverAppId: 'APP_TEST_123',
            streamInactivityTimeoutSeconds: 1800,
            streamProfiles: [],
            castProfiles: [],
          } as any
        }
      />
    );

    const appIdInput = screen.getByLabelText(/Google Cast Application ID/i) as HTMLInputElement;
    expect(appIdInput).toBeInTheDocument();
    expect(appIdInput.value).toBe('APP_TEST_123');

    const timeoutSelect = screen.getByLabelText(/Tempo Limite de Inatividade/i) as HTMLSelectElement;
    expect(timeoutSelect).toBeInTheDocument();
    expect(timeoutSelect.value).toBe('1800');
  });
});
