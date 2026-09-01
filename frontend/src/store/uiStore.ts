import { create } from 'zustand';

// Placeholder UI-only store (replaces state.js's globals from the old app).
// Server state (channels, EPG, settings, etc.) belongs in TanStack Query
// hooks instead, not here.
interface UiState {
  isMobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  isMobileNavOpen: false,
  setMobileNavOpen: (open) => set({ isMobileNavOpen: open }),
}));
