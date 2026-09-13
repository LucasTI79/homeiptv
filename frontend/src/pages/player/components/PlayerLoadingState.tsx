import React from 'react';
import type { PlayerLoadingStage } from '../types';

interface PlayerLoadingStateProps {
  readonly stage: PlayerLoadingStage;
  readonly channelName?: string;
}

const STAGE_MESSAGES: Record<PlayerLoadingStage, string> = {
  idle: 'Preparando reprodução...',
  checking_cache: 'Verificando armazenamento local e cache...',
  probing_duration: 'Calculando duração e metadados do vídeo...',
  loading_stream: 'Conectando ao stream do servidor...',
  buffering: 'Carregando buffer de vídeo...',
};

export function PlayerLoadingState({ stage }: PlayerLoadingStateProps): React.JSX.Element | null {
  if (stage === 'idle') return null;

  return (
    <div className="absolute inset-0 z-20 bg-black/75 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center animate-fade-in pointer-events-none">
      <div className="relative mb-4">
        <div className="w-14 h-14 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-3 h-3 bg-blue-500 rounded-full animate-ping" />
        </div>
      </div>
      <p className="text-xs text-blue-300/90 font-medium tracking-wide">
        {STAGE_MESSAGES[stage] ?? STAGE_MESSAGES.idle}
      </p>
    </div>
  );
}
