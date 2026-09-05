import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RemoteExpandedSheet } from '../../components/remote/RemoteExpandedSheet';
import { useRemoteStore } from '../../store/remoteStore';

vi.mock('../../store/remoteStore', () => ({
  useRemoteStore: vi.fn(),
}));

describe('RemoteExpandedSheet - Playback Speed', () => {
  const sendCommandMock = vi.fn();
  const disconnectMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useRemoteStore).mockReturnValue({
      isPaired: true,
      remoteNowPlaying: {
        title: 'Breaking Bad - S01E01',
        subtitle: 'Pilot',
        isVod: true,
        isLive: false,
        isPaused: false,
        currentTime: 300,
        duration: 3000,
        volume: 0.8,
        isMuted: false,
        playbackRate: 1.0,
      },
      sendCommand: sendCommandMock,
      disconnect: disconnectMock,
    } as any);
  });

  it('renders playback speed section with current speed and presets', () => {
    render(<RemoteExpandedSheet isOpen={true} onClose={() => {}} />);

    expect(screen.getByText('Velocidade de Reprodução')).toBeInTheDocument();
    expect(screen.getByText('1.00x')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1x' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1.25x' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1.5x' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2x' })).toBeInTheDocument();
  });

  it('dispatches COMMAND_PLAYBACK_SPEED when preset button is clicked', () => {
    render(<RemoteExpandedSheet isOpen={true} onClose={() => {}} />);

    const btn125 = screen.getByRole('button', { name: '1.25x' });
    fireEvent.click(btn125);

    expect(sendCommandMock).toHaveBeenCalledWith({
      type: 'COMMAND_PLAYBACK_SPEED',
      payload: { speed: 1.25 },
    });

    const btn2 = screen.getByRole('button', { name: '2x' });
    fireEvent.click(btn2);

    expect(sendCommandMock).toHaveBeenCalledWith({
      type: 'COMMAND_PLAYBACK_SPEED',
      payload: { speed: 2 },
    });
  });

  it('dispatches COMMAND_PLAYBACK_SPEED when - and + fine buttons are clicked', () => {
    render(<RemoteExpandedSheet isOpen={true} onClose={() => {}} />);

    const decreaseBtn = screen.getByRole('button', { name: 'Diminuir velocidade 0.05x' });
    fireEvent.click(decreaseBtn);

    expect(sendCommandMock).toHaveBeenCalledWith({
      type: 'COMMAND_PLAYBACK_SPEED',
      payload: { speed: 0.95 },
    });

    const increaseBtn = screen.getByRole('button', { name: 'Aumentar velocidade 0.05x' });
    fireEvent.click(increaseBtn);

    expect(sendCommandMock).toHaveBeenCalledWith({
      type: 'COMMAND_PLAYBACK_SPEED',
      payload: { speed: 1.05 },
    });
  });
});
