import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The viewer is served by server.mjs in production; in dev, Vite proxies /api to it.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5178,
    proxy: { '/api': 'http://localhost:5177' },
  },
  build: { outDir: 'dist' },
});
