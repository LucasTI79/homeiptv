/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
const backendTarget = `http://localhost:${process.env.VITE_BACKEND_PORT || 8999}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    // Worker-thread pool hangs on process exit in this sandbox; forks exit cleanly.
    pool: 'forks',
  },
  server: {
    proxy: {
      // Dev-only: forwards API/stream calls to the TS backend (Wave 2) so the
      // Vite dev server and the API share an origin (cookies work, no CORS).
      // In production the backend serves this build's output directly instead.
      // VITE_BACKEND_PORT lets a second, isolated backend instance be tested
      // without colliding with one already running on the default port.
      '/api': backendTarget,
      '/stream': backendTarget,
      '/dvr': backendTarget,
    },
    watch: {
      ignored: ['**/node_modules/**'],
    },
  },

})
