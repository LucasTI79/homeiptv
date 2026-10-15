import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.unmock('../CastProvider');

import * as guideApi from '../../../api/guide';
import { CastProvider, useCast } from '../CastProvider';

vi.mock('../../../api/guide', () => ({
  useConfig: vi.fn(),
}));

describe('CastProvider dynamic App ID and keep-alive', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function setupCastMock(setOptionsMock = vi.fn()) {
    window.cast = {
      framework: {
        CastContext: {
          getInstance: () => ({
            setOptions: setOptionsMock,
            addEventListener: vi.fn(),
            getCurrentSession: vi.fn(),
          }),
        },
        CastContextEventType: {
          SESSION_STATE_CHANGED: 'SESSION_STATE_CHANGED',
        },
        RemotePlayer: class {
          isConnected = false;
        },
        RemotePlayerController: class {
          addEventListener = vi.fn();
        },
        RemotePlayerEventType: {
          IS_CONNECTED_CHANGED: 'IS_CONNECTED_CHANGED',
          IS_PAUSED_CHANGED: 'IS_PAUSED_CHANGED',
          CURRENT_TIME_CHANGED: 'CURRENT_TIME_CHANGED',
          DURATION_CHANGED: 'DURATION_CHANGED',
          VOLUME_LEVEL_CHANGED: 'VOLUME_LEVEL_CHANGED',
          IS_MUTED_CHANGED: 'IS_MUTED_CHANGED',
        },
        SessionState: {
          SESSION_STARTED: 'SESSION_STARTED',
          SESSION_RESUMED: 'SESSION_RESUMED',
          SESSION_ENDED: 'SESSION_ENDED',
          NO_SESSION: 'NO_SESSION',
        },
        LoggerLevel: { DEBUG: 0 },
        setLoggerLevel: vi.fn(),
      },
    } as any;

    window.chrome = {
      cast: {
        AutoJoinPolicy: { ORIGIN_SCOPED: 1 },
      },
    } as any;

    window.__isCastAvailable = true;
    return setOptionsMock;
  }

  it('uses default CC1AD845 when castReceiverAppId is empty or undefined', () => {
    (guideApi.useConfig as any).mockReturnValue({
      data: { settings: { castReceiverAppId: '' } },
    });

    const setOptionsMock = setupCastMock();

    function TestComponent() {
      const { isAvailable } = useCast();
      return <div>Available: {String(isAvailable)}</div>;
    }

    render(
      <CastProvider>
        <TestComponent />
      </CastProvider>
    );

    expect(setOptionsMock).toHaveBeenCalledWith(
      expect.objectContaining({ receiverApplicationId: 'CC1AD845' })
    );
  });

  it('uses custom castReceiverAppId when configured in settings', () => {
    (guideApi.useConfig as any).mockReturnValue({
      data: { settings: { castReceiverAppId: 'CUSTOM_APP_99' } },
    });

    const setOptionsMock = setupCastMock();

    function TestComponent() {
      useCast();
      return <div>Test</div>;
    }

    render(
      <CastProvider>
        <TestComponent />
      </CastProvider>
    );

    expect(setOptionsMock).toHaveBeenCalledWith(
      expect.objectContaining({ receiverApplicationId: 'CUSTOM_APP_99' })
    );
  });
});
