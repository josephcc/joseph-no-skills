// M2 end-to-end: a real MCP client against the daemon's /mcp and /mcp/by-page endpoints while the demo page is open.
// Usage: node scripts/e2e/m2.mjs   (daemon + vite running; launches its own Chrome)
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { launchChrome, waitFor, sleep } from './cdp.mjs';

const DEMO = process.env.DEMO_URL ?? 'http://127.0.0.1:5173/';
const DAEMON = process.env.DAEMON_URL ?? 'http://127.0.0.1:8717';
const out = {};
const { page, close } = await launchChrome({ url: DEMO, webmcp: true, port: 9334 });
let client;
try {
  await waitFor(async () => JSON.parse(await page.evaluate('JSON.stringify(window.__demo.page.status)')).state === 'connected', 'connected');
  const pages = await (await fetch(`${DAEMON}/pages`)).json();
  const pageId = pages[0].id;

  client = new Client({ name: 'e2e', version: '0' }, { capabilities: {} });
  const notifications = [];
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => notifications.push('tools'));
  const transport = new StreamableHTTPClientTransport(new URL(`${DAEMON}/mcp`));
  await client.connect(transport);
  out.serverInfo = client.getServerVersion();
  out.instructions = client.getInstructions();
  const tools = (await client.listTools()).tools;
  out.toolNames = tools.map((t) => t.name);
  out.mirrored = tools.filter((t) => !t.name.startsWith('webmcp_')).map((t) => ({ name: t.name, annotations: t.annotations, description: t.description.slice(0, 80) }));
  out.list_pages = JSON.parse((await client.callTool({ name: 'webmcp_list_pages', arguments: {} })).content[0].text);
  out.get_context = (await client.callTool({ name: 'webmcp_get_context', arguments: {} })).content[0].text.slice(0, 200);
  out.get_state = (await client.callTool({ name: 'get_state', arguments: {} })).structuredContent;
  out.set_color = (await client.callTool({ name: 'set_background_color', arguments: { color: '#0066cc' } })).structuredContent;
  out.set_sentence = (await client.callTool({ name: 'set_sentence', arguments: { text: 'Hello from Claude Code' } })).structuredContent;
  out.call_tool_meta = (await client.callTool({ name: 'webmcp_call_tool', arguments: { name: 'randomize', args: {} } })).structuredContent;
  out.bad = (await client.callTool({ name: 'set_background_color', arguments: { color: 'nope' } }));
  out.pageAfter = { bg: await page.evaluate('document.body.style.backgroundColor'), sentence: await page.evaluate('document.getElementById("sentence").textContent') };

  // dynamic: register the bonus tool → expect notifications/tools/list_changed and 'shout' in tools/list
  await page.evaluate('document.getElementById("bonus-btn").click(); "ok"');
  await waitFor(async () => notifications.length > 0, 'list_changed notification', { tries: 20, every: 250 });
  out.notifications = notifications.length;
  out.toolsAfterBonus = (await client.listTools()).tools.map((t) => t.name);
  out.shout = (await client.callTool({ name: 'shout', arguments: {} })).structuredContent;

  // prompt
  out.prompts = (await client.listPrompts()).prompts.map((p) => p.name);
  out.prompt = (await client.getPrompt({ name: 'page-instructions', arguments: {} })).messages[0].content.text.slice(0, 160);

  // per-page endpoint: only the page's tools (+ webmcp_get_context), no meta-tools
  const c2 = new Client({ name: 'e2e-page', version: '0' }, { capabilities: {} });
  await c2.connect(new StreamableHTTPClientTransport(new URL(`${DAEMON}/mcp/by-page/${pageId}`)));
  out.byPage = { serverName: c2.getServerVersion()?.name, tools: (await c2.listTools()).tools.map((t) => t.name), get_state: (await c2.callTool({ name: 'get_state', arguments: {} })).structuredContent, get_context: (await c2.callTool({ name: 'webmcp_get_context', arguments: {} })).content[0].text.slice(0, 60) };
  await c2.close();
  out.console = page.consoleLines.slice(0, 10);
} catch (err) {
  out.error = String(err?.stack ?? err); out.console = page.consoleLines.slice(0, 20);
} finally {
  try { await client?.close(); } catch {}
  page.close(); close();
}
console.log(JSON.stringify(out, null, 2));
process.exit(out.error ? 1 : 0);
