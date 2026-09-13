import React from 'react';
import type { PlayerErrorInfo } from '../types';
import { FiAlertTriangle, FiRotateCw, FiGlobe, FiCpu, FiArrowLeft } from 'react-icons/fi';

interface PlayerErrorStateProps {
  readonly error: PlayerErrorInfo;
  readonly isOfflineMedia: boolean;
  readonly forceDirect: boolean;
  readonly onRetry: () => void;
  readonly onFallbackOnline: () => void;
  readonly onToggleDirect: () => void;
  readonly onBackToGuide: () => void;
}

export function PlayerErrorState({
  error,
  isOfflineMedia,
  forceDirect,
  onRetry,
  onFallbackOnline,
  onToggleDirect,
  onBackToGuide,
}: PlayerErrorStateProps): React.JSX.Element {
  return (
    <div className="absolute inset-0 z-30 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center space-y-4 animate-fade-in">
      <div className="w-14 h-14 rounded-2xl bg-red-950/60 border border-red-500/40 flex items-center justify-center text-red-400 text-2xl shadow-lg shadow-red-950/50">
        <FiAlertTriangle className="w-7 h-7" />
      </div>

      <div className="space-y-1.5 max-w-md">
        <h3 className="text-lg font-bold text-white tracking-wide">Falha na Reprodução</h3>
        <p className="text-xs text-red-300 font-medium">{error.message}</p>
        {error.details && (
          <p className="text-[11px] text-gray-400 bg-gray-900/80 px-3 py-1.5 rounded-lg border border-white/5 font-mono">
            {error.details}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2.5 justify-center pt-2 max-w-md">
        {error.canRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow transition active:scale-95"
          >
            <FiRotateCw className="w-3.5 h-3.5" />
            <span>Tentar Novamente</span>
          </button>
        )}

        {isOfflineMedia && (
          <button
            type="button"
            onClick={onFallbackOnline}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow transition active:scale-95"
          >
            <FiGlobe className="w-3.5 h-3.5" />
            <span>Assistir Online</span>
          </button>
        )}

        {error.canToggleTranscoder && (
          <button
            type="button"
            onClick={onToggleDirect}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 border border-white/10 transition active:scale-95"
          >
            <FiCpu className="w-3.5 h-3.5 text-amber-400" />
            <span>{forceDirect ? 'Ativar Transcoder' : 'Stream Direto (Sem Transcoder)'}</span>
          </button>
        )}

        <button
          type="button"
          onClick={onBackToGuide}
          className="px-4 py-2 bg-gray-900 hover:bg-gray-800 text-gray-400 hover:text-gray-200 rounded-xl text-xs font-medium flex items-center gap-1.5 border border-white/5 transition"
        >
          <FiArrowLeft className="w-3.5 h-3.5" />
          <span>Voltar ao Guia</span>
        </button>
      </div>
    </div>
  );
}
