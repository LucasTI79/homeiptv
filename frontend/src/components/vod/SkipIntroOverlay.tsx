import React, { useEffect } from 'react';
import { FiFastForward } from 'react-icons/fi';

interface SkipIntroOverlayProps {
  isVisible: boolean;
  introEndSec: number;
  onSkip: (targetSec: number) => void;
}

export const SkipIntroOverlay: React.FC<SkipIntroOverlayProps> = ({
  isVisible,
  introEndSec,
  onSkip
}) => {
  // Listen for keyboard shortcut 's' or 'S'
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        onSkip(introEndSec);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, introEndSec, onSkip]);

  if (!isVisible) return null;

  return (
    <div className="absolute bottom-20 right-6 z-40 transition-all duration-300 ease-out transform translate-y-0 opacity-100 animate-fadeIn">
      <button
        type="button"
        onClick={() => onSkip(introEndSec)}
        className="group flex items-center gap-2 px-5 py-2.5 bg-black/80 hover:bg-white text-white hover:text-black font-semibold text-sm rounded-lg border border-white/30 hover:border-white shadow-2xl backdrop-blur-md transition-all duration-200 cursor-pointer select-none active:scale-95"
        title="Pular Introdução (Tecla S)"
      >
        <FiFastForward className="w-4 h-4 text-emerald-400 group-hover:text-black transition-colors" />
        <span>Pular Introdução</span>
        <kbd className="hidden sm:inline-block ml-1 px-1.5 py-0.5 text-xs text-zinc-400 group-hover:text-zinc-600 bg-white/10 group-hover:bg-black/10 rounded border border-white/20 group-hover:border-black/20 font-mono">
          S
        </kbd>
      </button>
    </div>
  );
};
