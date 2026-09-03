import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RemoteNowPlayingBar } from '../../components/remote/RemoteNowPlayingBar';
import { useRemoteStore } from '../../store/remoteStore';

describe('RemoteNowPlayingBar', () => {
  const mockSendCommand = vi.fn();

  beforeEach(() => {
    mockSendCommand.mockClear();
    useRemoteStore.setState({
      isPaired: false,
      role: 'standalone',
      remoteNowPlaying: null,
      sendCommand: mockSendCommand,
    });
  });

  it('renders nothing when not paired as client', () => {
    const { container } = render(<RemoteNowPlayingBar />);
    expect(container.firstChild).toBeNull();
  });

  it('renders floating bar when paired as client with media info', () => {
    useRemoteStore.setState({
      isPaired: true,
      role: 'client',
      remoteNowPlaying: {
        title: 'The Sopranos',
        isVod: true,
        isLive: false,
        isPaused: false,
        currentTime: 50,
        duration: 3600,
        volume: 1,
        isMuted: false,
      },
    });

    render(<RemoteNowPlayingBar />);

    expect(screen.getByText('Na TV')).toBeInTheDocument();
    expect(screen.getByText('The Sopranos')).toBeInTheDocument();
    expect(screen.getByLabelText('Pausar na TV')).toBeInTheDocument();
  });

  it('sends COMMAND_PLAY_PAUSE when clicking play/pause button', () => {
    useRemoteStore.setState({
      isPaired: true,
      role: 'client',
      remoteNowPlaying: {
        title: 'The Sopranos',
        isVod: true,
        isLive: false,
        isPaused: true,
        currentTime: 0,
        duration: 3600,
        volume: 1,
        isMuted: false,
      },
    });

    render(<RemoteNowPlayingBar />);

    const playBtn = screen.getByLabelText('Reproduzir na TV');
    fireEvent.click(playBtn);

    expect(mockSendCommand).toHaveBeenCalledWith({ type: 'COMMAND_PLAY_PAUSE' });
  });

  it('opens expanded sheet when clicking the bar', () => {
    useRemoteStore.setState({
      isPaired: true,
      role: 'client',
      remoteNowPlaying: {
        title: 'The Wire',
        isVod: true,
        isLive: false,
        isPaused: false,
        currentTime: 120,
        duration: 3600,
        volume: 1,
        isMuted: false,
      },
    });

    render(<RemoteNowPlayingBar />);

    const bar = screen.getByRole('button', { name: /abrir controles do controle remoto/i });
    fireEvent.click(bar);

    // Sheet should now be visible
    expect(screen.getByText('Transmitindo na TV')).toBeInTheDocument();
    expect(screen.getByText('Reprodução')).toBeInTheDocument();
    expect(screen.getByText('Controle Remoto')).toBeInTheDocument();
  });
});
