const PORT = process.env.CDP_PORT || '9333';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, label, tries = 40) {
  for (let i = 0; i < tries; i++) { try { const v = await fn(); if (v) return v; } catch {} await sleep(500); }
  throw new Error('timeout waiting for ' + label);
}
const targets = await waitFor(async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/json`); const t = await r.json();
  return t.find(x => x.type === 'page' && x.url.includes('localhost:8765')) || null;
}, 'page target');
const ws = new WebSocket(targets.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalIn = async (expression, contextId) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, ...(contextId ? { contextId } : {}) });
  if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.exception?.description || JSON.stringify(r.result.exceptionDetails) };
  return r.result?.result?.value;
};
await send('Runtime.enable'); await send('Page.enable');
await waitFor(async () => (await evalIn('document.readyState')) === 'complete', 'page load');
await sleep(500);
const out = {};
out.chromeVersion = (await send('Browser.getVersion')).result?.product;
out.mainWorld = {
  api: await evalIn('document.getElementById("api").textContent'),
  typeofDocumentModelContext: await evalIn('typeof document.modelContext'),
  typeofNavigatorModelContext: await evalIn('typeof navigator.modelContext'),
  registered: await evalIn('JSON.stringify(window.__registered)'),
  registerError: await evalIn('window.__registerError || null'),
};
// Emulate a content script: isolated world on the main frame
const tree = await send('Page.getFrameTree');
const frameId = tree.result.frameTree.frame.id;
const iso = await send('Page.createIsolatedWorld', { frameId, worldName: 'spike-isolated', grantUniveralAccess: false });
const ctx = iso.result.executionContextId;
out.isolatedWorld = {
  typeofDocumentModelContext: await evalIn('typeof document.modelContext', ctx),
  pageGlobalsVisible: await evalIn('typeof window.__registered', ctx),  // expect "undefined" (isolated)
  tools: await evalIn(`(async () => { const ts = await document.modelContext.getTools(); return JSON.stringify(ts.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations, origin: t.origin, sameWindow: t.window === window }))); })()`, ctx),
  callSet: await evalIn(`(async () => { const ts = await document.modelContext.getTools(); const t = ts.find(x => x.name === 'set_background_color'); const r = await document.modelContext.executeTool(t, { color: 'teal' }); return JSON.stringify({ type: typeof r, value: r }); })()`, ctx),
  callGet: await evalIn(`(async () => { const ts = await document.modelContext.getTools(); const t = ts.find(x => x.name === 'get_state'); const r = await document.modelContext.executeTool(t, {}); return JSON.stringify({ type: typeof r, value: r }); })()`, ctx),
  callSentence: await evalIn(`(async () => { const ts = await document.modelContext.getTools(); const t = ts.find(x => x.name === 'set_sentence'); const r = await document.modelContext.executeTool(t, { text: 'Changed from the isolated world' }); return JSON.stringify({ type: typeof r, value: r }); })()`, ctx),
};
out.mainWorldAfter = {
  bg: await evalIn('document.body.style.backgroundColor'),
  sentence: await evalIn('document.getElementById("sentence").textContent'),
};
// toolchange: register a listener in the isolated world, then register a new tool from the main world
await evalIn(`window.__tc = 0; document.modelContext.addEventListener('toolchange', () => { window.__tc++; }); 'ok'`, ctx);
await evalIn(`(async () => { await (document.modelContext).registerTool({ name: 'late_tool', description: 'registered later', inputSchema: {type:'object',properties:{}}, execute: async () => 'late' }); return 'ok'; })()`);
await sleep(300);
out.toolchange = { isolatedListenerFired: await evalIn('window.__tc', ctx), toolCountNow: await evalIn('(async () => (await document.modelContext.getTools()).length)()', ctx) };
console.log(JSON.stringify(out, null, 2));
ws.close();
