import { create } from 'zustand';

// The channel the user picked in the TV Guide (or elsewhere) that the Player
// screen should tune to. Just the intent -- not full Channel/EPG data, which
// stays in TanStack Query.
export interface SelectedEpisodeContext {
  seriesId: string;
  seriesName: string;
  season: string;
  episodeIndex: number;
  episodes: Array<{ name: string; url: string; duration?: string | number | null; duration_secs?: number | null }>;
}

export interface NextEpisodeInfo {
  url: string;
  name: string;
  season: string;
  episodeIndex: number;
  duration?: number | null;
}

export interface SelectedChannel {
  url: string;
  name: string;
  id: string;
  isVod?: boolean;
  vodType?: 'movie' | 'series';
  duration?: number | null;
  logo?: string;
  originalUrl?: string;
  initialTime?: number;
  seriesContext?: SelectedEpisodeContext;
  nextEpisode?: NextEpisodeInfo;
  offlineFileName?: string;
  isOffline?: boolean;
  isLocal?: boolean;
}

// Placeholder UI-only store (replaces state.js's globals from the old app).
// Server state (channels, EPG, settings, etc.) belongs in TanStack Query
// hooks instead, not here.
interface UiState {
  isMobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
  selectedChannel: SelectedChannel | null;
  setSelectedChannel: (channel: SelectedChannel | null) => void;
  appName: string;
  setAppName: (name: string) => void;
}

export const useUiStore = create<UiState>((set) => ({
  isMobileNavOpen: false,
  setMobileNavOpen: (open) => set({ isMobileNavOpen: open }),
  selectedChannel: null,
  setSelectedChannel: (channel) => set({ selectedChannel: channel }),
  appName: 'HomeIPTV',
  setAppName: (name) => set({ appName: name }),
}));
