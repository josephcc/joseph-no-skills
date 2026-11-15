// Local https variant of the demo, for the mixed-content check (F2-8). Not used in normal development.
import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const tls = process.env.WEBMCP_BRIDGE_TLS_DIR ?? '/tmp/webmcp-e2e/tls';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: { port: 5174, strictPort: true, host: '127.0.0.1', https: { key: readFileSync(`${tls}/key.pem`), cert: readFileSync(`${tls}/cert.pem`) } },
  resolve: { conditions: ['source', 'module', 'browser', 'development|production'] },
  optimizeDeps: { exclude: ['webmcp-connector', 'webmcp-protocol'] },
});
