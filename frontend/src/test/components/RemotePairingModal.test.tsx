import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RemotePairingModal } from '../../components/remote/RemotePairingModal';
import { useRemoteStore } from '../../store/remoteStore';

// Mock qrcode module
vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,fake-qr-code'),
  },
}));

describe('RemotePairingModal', () => {
  beforeEach(() => {
    useRemoteStore.setState({
      sessionId: 'test-session-uuid',
      pinCode: '123-456',
      clientCount: 0,
      startHostSession: vi.fn().mockResolvedValue({ sessionId: 'test-session-uuid', pinCode: '123-456' }),
    });
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(<RemotePairingModal isOpen={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders modal with PIN and status when isOpen is true', async () => {
    render(<RemotePairingModal isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByText('Conectar Celular')).toBeInTheDocument();
    expect(screen.getByText('123-456')).toBeInTheDocument();
    expect(screen.getByText('Aguardando conexão do celular...')).toBeInTheDocument();

    const img = await screen.findByAltText('QR Code para parear celular');
    expect(img).toBeInTheDocument();
  });

  it('updates badge when a client connects', () => {
    useRemoteStore.setState({ clientCount: 1 });
    render(<RemotePairingModal isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByText('1 celular(es) conectado(s)')).toBeInTheDocument();
  });
});
