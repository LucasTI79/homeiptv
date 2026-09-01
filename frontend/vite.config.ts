import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // Dev-only: forwards API/stream calls to the TS backend (Wave 2) so the
      // Vite dev server and the API share an origin (cookies work, no CORS).
      // In production the backend serves this build's output directly instead.
      '/api': 'http://localhost:8999',
      '/stream': 'http://localhost:8999',
      '/dvr': 'http://localhost:8999',
    },
  },
})
