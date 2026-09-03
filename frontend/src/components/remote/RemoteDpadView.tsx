import React, { useState } from 'react';
import {
  FiChevronUp,
  FiChevronDown,
  FiChevronLeft,
  FiChevronRight,
  FiCornerDownLeft,
  FiHome,
  FiMenu,
  FiVolume2,
  FiVolumeX,
  FiVolume1,
  FiSend,
} from 'react-icons/fi';
import { useRemoteStore } from '../../store/remoteStore';
import { RemoteDpadKey } from '@homeiptv/shared-types';

export const RemoteDpadView: React.FC = () => {
  const { sendCommand } = useRemoteStore();
  const [inputText, setInputText] = useState('');

  const triggerHaptic = () => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(20);
    }
  };

  const handleDpadPress = (key: RemoteDpadKey) => {
    triggerHaptic();
    sendCommand({ type: 'COMMAND_DPAD', payload: { key } });
  };

  const handleVolumeDelta = (delta: number) => {
    triggerHaptic();
    sendCommand({ type: 'COMMAND_VOLUME', payload: { delta } });
  };

  const handleToggleMute = () => {
    triggerHaptic();
    sendCommand({ type: 'COMMAND_VOLUME', payload: { toggleMute: true } });
  };

  const handleSendText = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    triggerHaptic();
    sendCommand({ type: 'COMMAND_INPUT_TEXT', payload: { text: inputText, submit: true } });
    setInputText('');
  };

  return (
    <div className="flex flex-col items-center justify-center p-4 max-w-sm mx-auto text-white select-none">
      {/* Search / Text Input to TV */}
      <form onSubmit={handleSendText} className="w-full mb-6 flex gap-2">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Digitar na TV / PC..."
          className="flex-1 bg-neutral-800 border border-neutral-700 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-primary-500"
        />
        <button
          type="submit"
          className="p-2.5 rounded-xl bg-primary-600 hover:bg-primary-500 text-white transition-colors"
          aria-label="Enviar texto"
        >
          <FiSend className="w-5 h-5" />
        </button>
      </form>

      {/* Top Controls Row */}
      <div className="w-full flex justify-between items-center mb-6 px-4">
        <button
          onClick={() => handleDpadPress('back')}
          className="p-3 rounded-2xl bg-neutral-800/80 hover:bg-neutral-700 active:scale-95 transition-all text-neutral-300"
          aria-label="Voltar"
        >
          <FiCornerDownLeft className="w-6 h-6" />
        </button>
        <button
          onClick={() => handleDpadPress('menu')}
          className="p-3 rounded-2xl bg-neutral-800/80 hover:bg-neutral-700 active:scale-95 transition-all text-neutral-300"
          aria-label="Menu"
        >
          <FiMenu className="w-6 h-6" />
        </button>
        <button
          onClick={handleToggleMute}
          className="p-3 rounded-2xl bg-neutral-800/80 hover:bg-neutral-700 active:scale-95 transition-all text-neutral-300"
          aria-label="Mudo"
        >
          <FiVolumeX className="w-6 h-6" />
        </button>
      </div>

      {/* D-Pad Circular Controller */}
      <div className="relative w-64 h-64 bg-neutral-800/60 border border-neutral-700/60 rounded-full flex items-center justify-center shadow-2xl p-2 mb-8">
        {/* Up */}
        <button
          onClick={() => handleDpadPress('up')}
          className="absolute top-2 left-1/2 -translate-x-1/2 w-20 h-16 flex items-center justify-center text-neutral-300 hover:text-white active:scale-90 transition-transform"
          aria-label="Cima"
        >
          <FiChevronUp className="w-10 h-10" />
        </button>

        {/* Down */}
        <button
          onClick={() => handleDpadPress('down')}
          className="absolute bottom-2 left-1/2 -translate-x-1/2 w-20 h-16 flex items-center justify-center text-neutral-300 hover:text-white active:scale-90 transition-transform"
          aria-label="Baixo"
        >
          <FiChevronDown className="w-10 h-10" />
        </button>

        {/* Left */}
        <button
          onClick={() => handleDpadPress('left')}
          className="absolute left-2 top-1/2 -translate-y-1/2 w-16 h-20 flex items-center justify-center text-neutral-300 hover:text-white active:scale-90 transition-transform"
          aria-label="Esquerda"
        >
          <FiChevronLeft className="w-10 h-10" />
        </button>

        {/* Right */}
        <button
          onClick={() => handleDpadPress('right')}
          className="absolute right-2 top-1/2 -translate-y-1/2 w-16 h-20 flex items-center justify-center text-neutral-300 hover:text-white active:scale-90 transition-transform"
          aria-label="Direita"
        >
          <FiChevronRight className="w-10 h-10" />
        </button>

        {/* Center OK Button */}
        <button
          onClick={() => handleDpadPress('select')}
          className="w-24 h-24 rounded-full bg-gradient-to-br from-primary-600 to-primary-700 hover:from-primary-500 hover:to-primary-600 active:scale-95 shadow-lg flex items-center justify-center text-lg font-bold text-white transition-transform"
          aria-label="OK / Selecionar"
        >
          OK
        </button>
      </div>

      {/* Volume Bar Controls */}
      <div className="flex items-center gap-6 bg-neutral-800/80 px-6 py-3 rounded-full border border-neutral-700/60">
        <button
          onClick={() => handleVolumeDelta(-0.05)}
          className="p-2 text-neutral-400 hover:text-white active:scale-90 transition-transform"
          aria-label="Diminuir Volume"
        >
          <FiVolume1 className="w-6 h-6" />
        </button>
        <span className="text-xs uppercase tracking-wider text-neutral-400 font-semibold">Volume</span>
        <button
          onClick={() => handleVolumeDelta(0.05)}
          className="p-2 text-neutral-400 hover:text-white active:scale-90 transition-transform"
          aria-label="Aumentar Volume"
        >
          <FiVolume2 className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
};
