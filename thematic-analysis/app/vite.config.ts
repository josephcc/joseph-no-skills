import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// server.mjs serves the built app in normal use; in dev, Vite proxies /api to the daemon
// on its conventional port (see DEFAULT_PORT in server.mjs).
export default defineConfig({
  plugins: [react()],
  server: { port: 5180, proxy: { '/api': 'http://localhost:47821' } },
  build: { outDir: 'dist' },
});
