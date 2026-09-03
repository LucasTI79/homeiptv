import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
});

// The real CastProvider calls useConfig() (a live /api/config fetch) and sets
// up Google Cast SDK listeners -- neither works in jsdom and neither is what
// page-level tests care about, so every test gets a no-op stand-in instead.
// Individual test files can still override this with their own vi.mock if a
// test specifically needs to exercise cast behavior.
vi.mock('../components/cast/CastProvider', () => ({
  CastProvider: ({ children }: { children: import('react').ReactNode }) => children,
  useCast: () => ({
    isAvailable: false,
    isCasting: false,
    isConnected: false,
    isPaused: false,
    requestSession: vi.fn(),
    loadMedia: vi.fn(),
    togglePlayPause: vi.fn(),
    seekMedia: vi.fn(),
    stopCasting: vi.fn(),
  }),
}));
