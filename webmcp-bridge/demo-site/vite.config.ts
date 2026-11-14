import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: { port: 5173, strictPort: true, host: '127.0.0.1' },
  // The connector is consumed from TypeScript source via the workspace link.
  resolve: { conditions: ['source', 'module', 'browser', 'development|production'] },
  optimizeDeps: { exclude: ['webmcp-connector', 'webmcp-protocol'] },
});
