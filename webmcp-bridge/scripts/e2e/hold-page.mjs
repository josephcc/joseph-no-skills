// Keeps the demo page open in a throwaway Chrome until killed (for tests that drive Claude Code separately).
import { launchChrome, waitFor } from './cdp.mjs';
const DEMO = process.env.DEMO_URL ?? 'http://127.0.0.1:5173/';
const { page, close } = await launchChrome({ url: DEMO, webmcp: process.env.WEBMCP !== '0', port: Number(process.env.CDP_PORT ?? 9335) });
await waitFor(async () => JSON.parse(await page.evaluate('JSON.stringify(window.__demo.page.status)')).state === 'connected', 'connected');
console.log('HOLDING ' + JSON.stringify(await page.evaluate('window.__demo.snapshot()')));
const bye = () => { page.close(); close(); process.exit(0); };
process.on('SIGTERM', bye); process.on('SIGINT', bye);
setTimeout(bye, Number(process.env.HOLD_MS ?? 600000));
