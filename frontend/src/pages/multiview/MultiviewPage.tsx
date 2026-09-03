import React, { useState, useEffect } from 'react';
import { Responsive as ResponsiveGridLayout } from 'react-grid-layout';
import type { Layout } from 'react-grid-layout';

type LayoutItem = { i: string; x: number; y: number; w: number; h: number };
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { MultiviewPlayer } from './MultiviewPlayer';
import { FiPlus, FiLayout } from 'react-icons/fi';
import { toast } from 'react-hot-toast';
import { GuideTour } from '../../components/ui/GuideTour';


export interface MultiviewChannel {
  id: string;
  name: string;
  url: string;
  logo?: string;
}

interface PlayerWidget {
  id: string;
  channel: MultiviewChannel | null;
}

const MAX_PLAYERS = 9;

export const MultiviewPage: React.FC = () => {
  const [widgets, setWidgets] = useState<PlayerWidget[]>([]);
  const [layout, setLayout] = useState<Layout>([]);
  const [activePlayerId, setActivePlayerId] = useState<string | null>(null);
  
  const [isSelectorOpen, setIsSelectorOpen] = useState(false);
  const [selectingForWidget, setSelectingForWidget] = useState<string | null>(null);

  const handleLayoutChange = (newLayout: Layout) => {
    setLayout(newLayout);
  };

  const addPlayer = () => {
    if (widgets.length >= MAX_PLAYERS) {
      toast.error(`Maximum of ${MAX_PLAYERS} players allowed.`);
      return;
    }
    const id = `player-${Date.now()}`;
    setWidgets([...widgets, { id, channel: null }]);
    const newLayoutItem = { i: id, x: (widgets.length * 4) % 12, y: Infinity, w: 4, h: 4 };
    setLayout([...layout, newLayoutItem]);
  };

  const removePlayer = (id: string) => {
    setWidgets(widgets.filter((w) => w.id !== id));
    setLayout(layout.filter((l) => l.i !== id));
    if (activePlayerId === id) setActivePlayerId(null);
  };

  const selectChannelForWidget = (id: string) => {
    setSelectingForWidget(id);
    setIsSelectorOpen(true);
  };

  const handleChannelSelect = (channel: MultiviewChannel) => {
    if (selectingForWidget) {
      setWidgets(
        widgets.map((w) =>
          w.id === selectingForWidget ? { ...w, channel } : w
        )
      );
      setActivePlayerId(selectingForWidget);
    }
    setIsSelectorOpen(false);
    setSelectingForWidget(null);
  };

  const applyPresetLayout = (type: '2x2' | '1x3' | 'auto') => {
    const numPlayers = widgets.length;
    if (type === 'auto' && numPlayers === 0) {
      addPlayer();
      return;
    }

    let newLayout: LayoutItem[] = [];
    if (type === 'auto') {
      let cols = 3, rows = 3;
      if (numPlayers <= 1) { cols = 1; rows = 1; }
      else if (numPlayers === 2) { cols = 2; rows = 1; }
      else if (numPlayers === 3) { cols = 3; rows = 1; }
      else if (numPlayers === 4) { cols = 2; rows = 2; }
      else if (numPlayers <= 6) { cols = 3; rows = 2; }

      const w = Math.floor(12 / cols);
      const h = Math.floor(9 / rows);

      newLayout = widgets.map((widget, i) => {
        const item = {
          i: widget.id,
          x: (i % cols) * w,
          y: Math.floor(i / cols) * h,
          w,
          h,
        };
        return item;
      });
    } else if (type === '2x2') {
      const positions = [
        { x: 0, y: 0, w: 6, h: 4 }, { x: 6, y: 0, w: 6, h: 4 },
        { x: 0, y: 4, w: 6, h: 4 }, { x: 6, y: 4, w: 6, h: 4 }
      ];
      newLayout = widgets.map((widget, i) => {
        const pos = positions[i] || { x: 0, y: Infinity, w: 4, h: 4 };
        const item = {
          i: widget.id,
          ...pos
        };
        return item;
      });
    } else if (type === '1x3') {
      const positions = [
        { x: 0, y: 0, w: 8, h: 9 },
        { x: 8, y: 0, w: 4, h: 3 },
        { x: 8, y: 3, w: 4, h: 3 },
        { x: 8, y: 6, w: 4, h: 3 }
      ];
      newLayout = widgets.map((widget, i) => {
        const pos = positions[i] || { x: 0, y: Infinity, w: 4, h: 4 };
        const item = {
          i: widget.id,
          ...pos
        };
        return item;
      });
    }

    setLayout(newLayout);
  };

  return (
    <div className="h-[calc(100vh-64px)] w-full overflow-hidden bg-gray-900 text-white flex flex-col">
      <GuideTour
        tourKey="multiview"
        steps={[
          {
            element: '.add-player-btn',
            popover: {
              title: 'Adicionar Player',
              description: 'Clique aqui para adicionar um novo player à grade Multiview.',
              side: 'bottom',
            },
          },
          {
            element: '.layout-btn',
            popover: {
              title: 'Organizar Layout',
              description: 'Escolha um layout automático ou gradeado para organizar os players.',
              side: 'bottom',
            },
          },
        ]}
      />
      <div className="flex items-center justify-between p-4 bg-gray-900 border-b border-gray-800 shrink-0">
        <h1 className="text-xl font-bold">Multiview</h1>
        <div className="flex items-center gap-2 relative layout-btn">
          <button onClick={() => applyPresetLayout('auto')} className="px-3 py-1 bg-gray-800 hover:bg-gray-700 rounded text-sm flex items-center gap-2">
            <FiLayout /> Auto
          </button>
          <button onClick={() => applyPresetLayout('2x2')} className="px-3 py-1 bg-gray-800 hover:bg-gray-700 rounded text-sm flex items-center gap-2">
            <FiLayout /> 2x2
          </button>
          <button onClick={() => applyPresetLayout('1x3')} className="px-3 py-1 bg-gray-800 hover:bg-gray-700 rounded text-sm flex items-center gap-2">
            <FiLayout /> 1x3
          </button>
          <button 
            onClick={addPlayer}
            className="add-player-btn flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded transition-colors text-sm font-medium ml-4"
          >
            <FiPlus /> Add Player
          </button>
        </div>
      </div>

      {/* Grid container */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-2">
        <ResponsiveGridLayout
          className="layout"
          layouts={{ lg: layout }}
          cols={{ lg: 12, md: 12, sm: 12, xs: 12, xxs: 12 }}
          rowHeight={80} // Approx 8vh
          width={window.innerWidth - 16}
          onLayoutChange={(l: Layout) => handleLayoutChange(l)}
          margin={[8, 8]}
        >
          {widgets.map((widget) => (
            <div key={widget.id}>
              <MultiviewPlayer
                id={widget.id}
                channel={widget.channel}
                isActive={activePlayerId === widget.id}
                onActivate={setActivePlayerId}
                onRemove={removePlayer}
                onSelectChannel={selectChannelForWidget}
              />
            </div>
          ))}
        </ResponsiveGridLayout>
      </div>

      {isSelectorOpen && (
        <ChannelSelectorModal
          onSelect={handleChannelSelect}
          onClose={() => {
            setIsSelectorOpen(false);
            setSelectingForWidget(null);
          }}
        />
      )}
    </div>
  );
};

import { useVirtualizer } from '@tanstack/react-virtual';
import { useConfig } from '../../api/guide';
import { parseM3U } from '../../lib/parseM3U';
import { proxiedLogoUrl, PLACEHOLDER_LOGO } from '../../components/guide/ChannelRow';

// Virtualized Channel Selector Modal for Multiview
const ChannelSelectorModal: React.FC<{ onSelect: (ch: MultiviewChannel) => void; onClose: () => void }> = ({ onSelect, onClose }) => {
  const { data: config } = useConfig();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const listRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 150);
    return () => clearTimeout(timer);
  }, [search]);

  const channels = React.useMemo(() => {
    if (!config?.m3uContent) return [];
    return parseM3U(config.m3uContent);
  }, [config?.m3uContent]);

  const filteredChannels = React.useMemo(() => {
    if (!debouncedSearch) return channels;
    const q = debouncedSearch.toLowerCase().trim();
    return channels.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.displayName && c.displayName.toLowerCase().includes(q)) ||
      (c.group && c.group.toLowerCase().includes(q)) ||
      (c.chno && c.chno.includes(q))
    );
  }, [channels, debouncedSearch]);

  const rowVirtualizer = useVirtualizer({
    count: filteredChannels.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 52,
    overscan: 5,
  });

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 border border-gray-700 rounded-xl max-w-lg w-full p-5 shadow-2xl flex flex-col max-h-[85vh]">
        <div className="flex justify-between items-center pb-3 border-b border-gray-700">
          <h2 className="text-lg font-bold text-white">Select Channel</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">&times;</button>
        </div>

        <div className="my-3 space-y-2">
          <input
            type="text"
            placeholder="Search channel or category..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded-md px-3 py-2 text-sm text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 outline-none"
            autoFocus
          />
        </div>

        {/* Virtualized Channel List */}
        <div ref={listRef} className="flex-1 overflow-y-auto min-h-[300px] max-h-[400px] border border-gray-700/60 rounded-lg bg-gray-950/60 relative">
          {filteredChannels.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-sm">No channels found.</div>
          ) : (
            <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const channel = filteredChannels[virtualRow.index];
                if (!channel) return null;
                return (
                  <button
                    key={channel.id}
                    type="button"
                    onClick={() => onSelect({ id: channel.id, name: channel.displayName || channel.name, url: channel.url, logo: channel.logo })}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    className="flex items-center gap-3 px-3 py-1.5 hover:bg-blue-600/20 text-left border-b border-gray-800/40 transition"
                  >
                    <img
                      src={proxiedLogoUrl(channel.logo)}
                      loading="lazy"
                      decoding="async"
                      onError={(e) => { e.currentTarget.src = PLACEHOLDER_LOGO; }}
                      alt=""
                      className="w-7 h-7 object-contain rounded bg-gray-800 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-white truncate">{channel.displayName || channel.name}</p>
                      <p className="text-xs text-gray-500 truncate">{channel.group}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Custom URL Fallback */}
        <div className="pt-3 border-t border-gray-700 mt-3 space-y-2">
          <p className="text-xs text-gray-400">Or enter a custom stream URL:</p>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="http://example.com/live.m3u8"
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              className="flex-1 bg-gray-900 border border-gray-700 rounded-md px-3 py-1.5 text-xs text-white placeholder-gray-500 outline-none"
            />
            <button
              type="button"
              disabled={!customUrl.trim()}
              onClick={() => {
                if (customUrl.trim()) {
                  onSelect({ id: 'custom', name: 'Custom Stream', url: customUrl.trim() });
                }
              }}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-semibold text-white rounded transition"
            >
              Play
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
