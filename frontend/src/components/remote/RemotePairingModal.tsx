import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { FiX, FiSmartphone, FiCheck, FiWifi } from 'react-icons/fi';
import { useRemoteStore } from '../../store/remoteStore';

interface RemotePairingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const RemotePairingModal: React.FC<RemotePairingModalProps> = ({ isOpen, onClose }) => {
  const { sessionId, pinCode, clientCount, startHostSession } = useRemoteStore();
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    async function initHostSession() {
      try {
        setIsLoading(true);
        let currentSessionId = sessionId;
        let currentPin = pinCode;

        if (!currentSessionId || !currentPin) {
          const res = await startHostSession();
          currentSessionId = res.sessionId;
          currentPin = res.pinCode;
        }

        const pairingUrl = `${window.location.origin}/?remote_session=${encodeURIComponent(
          currentSessionId!
        )}&pin=${encodeURIComponent(currentPin!)}`;

        const dataUrl = await QRCode.toDataURL(pairingUrl, {
          width: 280,
          margin: 1,
          color: {
            dark: '#000000',
            light: '#ffffff',
          },
        });
        setQrCodeDataUrl(dataUrl);
      } catch (err) {
        console.error('[RemotePairingModal] Failed to generate pairing QR code:', err);
      } finally {
        setIsLoading(false);
      }
    }

    initHostSession();
  }, [isOpen, sessionId, pinCode, startHostSession]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="remote-pairing-title"
    >
      <div className="relative w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-2xl text-white">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-neutral-800">
          <div className="flex items-center gap-2">
            <FiSmartphone className="w-6 h-6 text-primary-400" />
            <h2 id="remote-pairing-title" className="text-xl font-bold">
              Conectar Celular
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
            aria-label="Fechar modal"
          >
            <FiX className="w-5 h-5" />
          </button>
        </div>

        {/* Status Badge */}
        <div className="my-4 flex items-center justify-center">
          {clientCount > 0 ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-sm font-medium">
              <FiCheck className="w-4 h-4" />
              <span>{clientCount} celular(es) conectado(s)</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary-500/20 text-primary-400 border border-primary-500/30 text-sm font-medium animate-pulse">
              <FiWifi className="w-4 h-4" />
              <span>Aguardando conexão do celular...</span>
            </div>
          )}
        </div>

        {/* QR Code Container */}
        <div className="flex flex-col items-center justify-center py-2">
          {isLoading || !qrCodeDataUrl ? (
            <div className="w-64 h-64 flex items-center justify-center bg-neutral-800 rounded-xl animate-pulse">
              <span className="text-sm text-neutral-400">Gerando QR Code...</span>
            </div>
          ) : (
            <div className="p-3 bg-white rounded-2xl shadow-inner">
              <img
                src={qrCodeDataUrl}
                alt="QR Code para parear celular"
                className="w-56 h-56 rounded-lg"
              />
            </div>
          )}

          {/* PIN Display */}
          {pinCode && (
            <div className="mt-4 text-center">
              <span className="text-xs text-neutral-400 uppercase tracking-wider font-semibold">
                Código PIN
              </span>
              <div className="text-3xl font-mono font-bold tracking-widest text-primary-400 mt-1">
                {pinCode}
              </div>
            </div>
          )}
        </div>

        {/* Instructions */}
        <div className="mt-4 p-3.5 bg-neutral-800/50 rounded-xl border border-neutral-800 text-xs text-neutral-300 space-y-1.5">
          <p className="flex items-start gap-2">
            <span className="font-bold text-primary-400">1.</span>
            <span>Aponte a câmera do celular para o QR Code para abrir o controle.</span>
          </p>
          <p className="flex items-start gap-2">
            <span className="font-bold text-primary-400">2.</span>
            <span>Navegue pelo catálogo de filmes, séries e canais pelo celular e escolha o que assistir na TV.</span>
          </p>
        </div>

        {/* Footer */}
        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="w-full py-2.5 px-4 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-medium transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
