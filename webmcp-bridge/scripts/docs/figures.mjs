// The README's architecture figures as hand-laid-out SVGs (plans/readme-three-audiences/main.md D-6: Mermaid read too
// small and dense). Boxes, arrows and labels are declared here with explicit coordinates on a 1200-wide canvas, so the
// type stays large at README width and every figure can be edited by hand. Usage: node scripts/docs/figures.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(new URL('../../', import.meta.url).pathname, 'docs', 'img');
mkdirSync(OUT, { recursive: true });

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const C = { ink: '#1f2a2e', muted: '#5b6b70', line: '#8a9a9e', page: '#eef6f4', pageEdge: '#79a9a0', daemon: '#fff4e3', daemonEdge: '#d9a441', claude: '#eceefb', claudeEdge: '#7c86d6', accent: '#105257', white: '#ffffff' };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A rounded box with a bold title and optional body lines (mono: true renders a line in monospace). */
function box({ x, y, w, h, title, lines = [], fill, edge, titleSize = 22, bodySize = 17, pad = 18 }) {
  let out = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${fill}" stroke="${edge}" stroke-width="2"/>`;
  let ty = y + pad + titleSize * 0.8;
  if (title) { out += `<text x="${x + pad}" y="${ty}" font-size="${titleSize}" font-weight="700" fill="${C.ink}">${esc(title)}</text>`; ty += titleSize * 0.6; }
  for (const l of lines) {
    const text = typeof l === 'string' ? l : l.text;
    const mono = typeof l === 'object' && l.mono;
    const dim = typeof l === 'object' && l.dim;
    ty += bodySize * 1.45;
    out += `<text x="${x + pad}" y="${ty}" font-size="${bodySize}" font-family="${mono ? MONO : FONT}" fill="${dim ? C.muted : C.ink}">${esc(text)}</text>`;
  }
  return out;
}

/** An arrow along the given points, with a label on a white halo at the midpoint of the given segment (default the first). */
function arrow({ points, label, labelAt = 0, dashed = false, both = false, labelDy = -10, labelSize = 16, labelAnchor = 'middle' }) {
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
  let out = `<path d="${d}" fill="none" stroke="${C.line}" stroke-width="2.5" ${dashed ? 'stroke-dasharray="8 6"' : ''} marker-end="url(#head)" ${both ? 'marker-start="url(#tail)"' : ''}/>`;
  if (label) {
    const [a, b] = [points[labelAt], points[labelAt + 1]];
    const mx = (a[0] + b[0]) / 2; const my = (a[1] + b[1]) / 2;
    const w = label.length * labelSize * 0.56 + 16;
    const lx = labelAnchor === 'middle' ? mx - w / 2 : labelAnchor === 'start' ? mx : mx - w;
    out += `<rect x="${lx}" y="${my + labelDy - labelSize}" width="${w}" height="${labelSize + 10}" rx="6" fill="${C.white}" opacity="0.95"/>`;
    out += `<text x="${labelAnchor === 'middle' ? mx : labelAnchor === 'start' ? mx + 8 : mx - 8}" y="${my + labelDy + 2}" font-size="${labelSize}" text-anchor="${labelAnchor}" fill="${C.muted}">${esc(label)}</text>`;
  }
  return out;
}

function note({ x, y, lines, size = 16, anchor = 'start' }) {
  return lines.map((l, i) => `<text x="${x}" y="${y + i * size * 1.45}" font-size="${size}" text-anchor="${anchor}" fill="${C.muted}">${esc(l)}</text>`).join('');
}

function svg(w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${FONT}">
<defs>
  <marker id="head" markerWidth="12" markerHeight="12" refX="10" refY="6" orient="auto" markerUnits="userSpaceOnUse"><path d="M1 1 L11 6 L1 11 z" fill="${C.line}"/></marker>
  <marker id="tail" markerWidth="12" markerHeight="12" refX="2" refY="6" orient="auto" markerUnits="userSpaceOnUse"><path d="M11 1 L1 6 L11 11 z" fill="${C.line}"/></marker>
</defs>
<rect width="${w}" height="${h}" fill="${C.white}"/>
${body}
</svg>
`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Figure 1: the pieces. The daemon's endpoints sit level with what they talk to, so the arrows stay short and
// horizontal; each endpoint box names its transport instead of a label on the arrow.
{
  const body = [
    // Browser
    box({ x: 40, y: 40, w: 360, h: 490, title: 'Browser tab', fill: C.page, edge: C.pageEdge }),
    box({ x: 64, y: 100, w: 312, h: 170, title: 'Your page', fill: C.white, edge: C.pageEdge, lines: ['registers tools on', { text: 'document.modelContext', mono: true }, 'and describes itself:', 'instructions + what the user sees'] }),
    box({ x: 64, y: 300, w: 312, h: 205, title: 'webmcp-connector', fill: C.white, edge: C.pageEdge, lines: [{ text: 'connect()', mono: true }, 'mirrors the tools, answers', 'context requests, runs calls', { text: '<AgentChat>  the chat panel', mono: true }, { text: '<FloatingWidgetPanel>  cards', mono: true }] }),
    // Daemon
    box({ x: 470, y: 40, w: 300, h: 490, title: 'webmcp-daemon', fill: C.daemon, edge: C.daemonEdge, lines: [{ text: 'one process on 127.0.0.1,', dim: true }, { text: 'first free of 5 candidate ports', dim: true }] }),
    box({ x: 494, y: 150, w: 252, h: 76, title: '/mcp', fill: C.white, edge: C.daemonEdge, lines: ['MCP server, streamable HTTP'], titleSize: 20, pad: 12 }),
    box({ x: 494, y: 300, w: 252, h: 76, title: '/ws', fill: C.white, edge: C.daemonEdge, lines: ['pages, WebSocket'], titleSize: 20, pad: 12 }),
    box({ x: 494, y: 400, w: 252, h: 76, title: '/acp', fill: C.white, edge: C.daemonEdge, lines: ['the chat, ACP over WebSocket'], titleSize: 20, pad: 12 }),
    note({ x: 494, y: 500, lines: ['origin approval · page registry', 'a workspace per page origin'], size: 14 }),
    // Claude sides
    box({ x: 840, y: 100, w: 320, h: 176, title: 'Terminal Claude Code', fill: C.claude, edge: C.claudeEdge, lines: ['the webmcp-daemon plugin:', 'hooks inject the page\'s', 'instructions and state;', { text: 'webmcp-mcp relays MCP (stdio)', mono: true }] }),
    box({ x: 840, y: 330, w: 320, h: 200, title: 'The chat\'s agent', fill: C.claude, edge: C.claudeEdge, lines: ['one process per open thread', { text: 'claude-agent-acp', mono: true }, 'around your Claude Code', '(your login, your skills)', 'in the page\'s workspace'] }),
    // Arrows: short and level.
    arrow({ points: [[376, 338], [494, 338]] }),
    arrow({ points: [[376, 438], [494, 438]] }),
    arrow({ points: [[746, 188], [840, 188]], both: true }),
    arrow({ points: [[746, 438], [840, 438]], both: true, label: 'stdio', labelDy: -14, labelSize: 14 }),
    arrow({ points: [[1000, 330], [1000, 300], [800, 300], [800, 206], [746, 206]], label: 'MCP, scoped to this page', labelAt: 1, labelDy: -12, labelSize: 14, dashed: true }),
    note({ x: 600, y: 560, lines: ['A page tool call from either Claude goes out over /ws, and the page runs it.'], anchor: 'middle' }),
  ].join('\n');
  writeFileSync(join(OUT, 'fig-pieces.svg'), svg(1200, 590, body));
}

// ---------------------------------------------------------------------------------------------------------------------
// Figure 2: a page connects, then terminal Claude calls one of its tools.
{
  const lane = (x, title, fill, edge) => box({ x, y: 30, w: 340, h: 60, title, fill, edge, titleSize: 22, pad: 16 });
  const stepBox = (x, y, text, n) => `${box({ x, y, w: 340, h: 54, fill: C.white, edge: '#c9d3d6', lines: [], pad: 0 })}<circle cx="${x + 24}" cy="${y + 27}" r="15" fill="${C.accent}"/><text x="${x + 24}" y="${y + 33}" font-size="16" font-weight="700" text-anchor="middle" fill="${C.white}">${n}</text><text x="${x + 50}" y="${y + 33}" font-size="17" fill="${C.ink}">${esc(text)}</text>`;
  const L = [40, 430, 820];
  const body = [
    lane(L[0], 'Page (connector)', C.page, C.pageEdge), lane(L[1], 'Daemon', C.daemon, C.daemonEdge), lane(L[2], 'Terminal Claude', C.claude, C.claudeEdge),
    stepBox(L[0], 120, 'GET /id on each candidate port', 1),
    stepBox(L[0], 190, 'WebSocket /ws, then hello', 2),
    stepBox(L[1], 260, 'approval tab the first time; welcome', 3),
    stepBox(L[0], 330, 'tools: the modelContext list', 4),
    stepBox(L[2], 400, 'tools/list → the page\'s tools', 5),
    stepBox(L[2], 470, 'tools/call set_sentence', 6),
    stepBox(L[1], 540, 'call → the page runs the tool', 7),
    stepBox(L[1], 610, 'call/result → the result to Claude', 8),
    arrow({ points: [[380, 147], [430, 147]] }), arrow({ points: [[380, 217], [430, 217]] }), arrow({ points: [[430, 287], [380, 287]] }),
    arrow({ points: [[380, 357], [430, 357]] }), arrow({ points: [[820, 427], [770, 427]] }), arrow({ points: [[820, 497], [770, 497]] }),
    arrow({ points: [[430, 567], [380, 567]] }), arrow({ points: [[770, 637], [820, 637]] }),
    note({ x: 600, y: 700, lines: ['The hooks then attach the page\'s new state to Claude\'s next prompt.'], anchor: 'middle' }),
  ].join('\n');
  writeFileSync(join(OUT, 'fig-terminal-call.svg'), svg(1200, 730, body));
}

// ---------------------------------------------------------------------------------------------------------------------
// Figure 3: a prompt in the embedded chat that ends in a card.
{
  const lane = (x, title, fill, edge) => box({ x, y: 30, w: 265, h: 60, title, fill, edge, titleSize: 21, pad: 14 });
  const stepBox = (x, y, text, n, w = 265) => `${box({ x, y, w, h: 54, fill: C.white, edge: '#c9d3d6', lines: [], pad: 0 })}<circle cx="${x + 24}" cy="${y + 27}" r="15" fill="${C.accent}"/><text x="${x + 24}" y="${y + 33}" font-size="16" font-weight="700" text-anchor="middle" fill="${C.white}">${n}</text><text x="${x + 50}" y="${y + 33}" font-size="15" fill="${C.ink}">${esc(text)}</text>`;
  const L = [25, 320, 615, 910];
  const body = [
    lane(L[0], 'AgentChat (page)', C.page, C.pageEdge), lane(L[1], 'Daemon /acp', C.daemon, C.daemonEdge), lane(L[2], 'claude-agent-acp', C.claude, C.claudeEdge), lane(L[3], 'Page tools', C.page, C.pageEdge),
    stepBox(L[0], 120, 'session/new (page workspace)', 1),
    stepBox(L[1], 190, 'spawn the agent, forward', 2),
    stepBox(L[0], 260, 'prompt + page://ui-state', 3),
    stepBox(L[2], 330, 'tools/call propose_palette', 4),
    stepBox(L[3], 400, 'the tool runs in the page', 5),
    stepBox(L[2], 470, 'result, then the reply text', 6),
    stepBox(L[0], 540, 'the card, from the result', 7),
    stepBox(L[0], 610, 'Use: applied; note() recorded', 8),
    arrow({ points: [[290, 147], [320, 147]] }), arrow({ points: [[585, 217], [615, 217]] }), arrow({ points: [[290, 287], [320, 287]] }),
    arrow({ points: [[585, 357], [615, 357]], both: false }), arrow({ points: [[880, 427], [910, 427]] }), arrow({ points: [[880, 497], [910, 497]], both: true }),
    arrow({ points: [[615, 567], [290, 567]] }),
    note({ x: 600, y: 700, lines: ['The note rides with the next prompt, so Claude learns what the user picked.'], anchor: 'middle' }),
  ].join('\n');
  writeFileSync(join(OUT, 'fig-chat-card.svg'), svg(1200, 730, body));
}

// ---------------------------------------------------------------------------------------------------------------------
// Figure 4: finding the daemon, and only one of it.
{
  const body = [
    box({ x: 40, y: 150, w: 200, h: 90, title: 'serve', fill: C.daemon, edge: C.daemonEdge, lines: ['(no --port)'] }),
    box({ x: 300, y: 120, w: 300, h: 150, title: 'A daemon recorded here?', fill: C.white, edge: C.daemonEdge, lines: ['daemon.json in this state dir:', 'pid alive, and GET /id', 'answers as that instance'] }),
    box({ x: 660, y: 40, w: 500, h: 80, title: 'yes → exit 0', fill: C.page, edge: C.pageEdge, lines: ['already running on 127.0.0.1:<port> (pid …)'] }),
    box({ x: 660, y: 170, w: 500, h: 110, title: 'no → claim daemon.json, then walk the list', fill: C.white, edge: C.daemonEdge, lines: [{ text: '8717 → 49217 → 52431 → 55893 → 61307', mono: true }, 'first free: listen, record the port · all taken: exit 1'] }),
    box({ x: 40, y: 340, w: 1120, h: 120, title: 'Every client walks the same list', fill: C.claude, edge: C.claudeEdge, lines: ['pages: GET /id on each candidate, then a WebSocket only to the port that answered as the daemon', 'the plugin\'s hooks and the webmcp-mcp relay: daemon.json first, then the list'] }),
    arrow({ points: [[240, 195], [300, 195]] }),
    arrow({ points: [[600, 165], [660, 80]], label: 'yes', labelDy: -14 }),
    arrow({ points: [[600, 225], [660, 225]], label: 'no', labelDy: -14 }),
    arrow({ points: [[910, 280], [910, 340]] }),
  ].join('\n');
  writeFileSync(join(OUT, 'fig-ports.svg'), svg(1200, 480, body));
}

console.log('wrote fig-pieces.svg, fig-terminal-call.svg, fig-chat-card.svg, fig-ports.svg to', OUT);
