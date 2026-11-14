// The demo page's state and rendering, in one module so both the tools (main.ts) and the cards (widgets.tsx) can use it.
export const COLOURS = ['#f4a261', '#2a9d8f', '#e9c46a', '#8ab6d6', '#c3b1e1', '#f7cac9', '#b5ead7', '#ffdac1'];
export const SENTENCES = [
  'The quick brown fox jumps over the lazy dog.',
  'A page is just a program that forgot it was one.',
  'Every tool call lands exactly where the user is looking.',
  'Colours are cheap; sentences are the expensive part.',
  'Hello from a web page that speaks WebMCP.',
];
export const state = { backgroundColor: '', sentence: '', toolCallCount: 0 };
/** The big monospace box under the sentence: whatever a tool (any Claude, any skill) last put there. */
export const output = { title: '', text: '', updatedAt: 0 };
export const OUTPUT_MAX_CHARS = 200_000;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function render() {
  document.body.style.backgroundColor = state.backgroundColor;
  $('sentence').textContent = state.sentence;
  $('swatch').style.backgroundColor = state.backgroundColor;
  $('color').textContent = state.backgroundColor;
}
export function snapshot() { return { ...state, backgroundColor: document.body.style.backgroundColor || state.backgroundColor, output: outputSummary() }; }

/** What the model sees of the box: counts and a short head, never the whole text (it wrote it). */
export function outputSummary() {
  const lines = output.text ? output.text.split('\n').length : 0;
  return { title: output.title, lines, chars: output.text.length, preview: output.text.slice(0, 240) };
}
export function renderOutput() {
  const empty = output.text.length === 0;
  $('output').textContent = output.text;
  $('output-title').textContent = output.title;
  $('output-section').dataset.empty = empty ? 'true' : 'false';
  $('output-meta').textContent = empty ? 'empty' : `${outputSummary().lines} lines · ${output.text.length} chars`;
  for (const id of ['output-copy', 'output-clear']) (document.getElementById(id) as HTMLButtonElement).disabled = empty;
}
/** Replace or append the box's text; an empty replace clears it (and its title unless a new one is given). */
export function setOutput(args: { text: string; title?: string; mode?: 'replace' | 'append' }) {
  const text = String(args.text ?? '');
  const append = args.mode === 'append' && output.text.length > 0;
  const next = append ? `${output.text.replace(/\n*$/, '')}\n\n${text}` : text;
  output.text = next.length > OUTPUT_MAX_CHARS ? next.slice(next.length - OUTPUT_MAX_CHARS) : next;
  if (args.title !== undefined) output.title = String(args.title).slice(0, 120);
  else if (!append && !text) output.title = '';
  output.updatedAt = Date.now();
  renderOutput();
  return { shown: text.length > 0, mode: append ? 'append' : 'replace', ...outputSummary() };
}
export function isCssColor(value: string): boolean { return typeof value === 'string' && CSS.supports('color', value); }
export function pick<T>(list: readonly T[], not?: T): T { let v = list[Math.floor(Math.random() * list.length)]!; while (v === not && list.length > 1) v = list[Math.floor(Math.random() * list.length)]!; return v; }
export function randomize() { state.backgroundColor = pick(COLOURS, state.backgroundColor); state.sentence = pick(SENTENCES, state.sentence); render(); return snapshot(); }

/** What a palette card's "Use" button does: page code, no tool call, no model turn. */
export function applyPalette(option: { color: string; sentence: string }) {
  if (!isCssColor(option.color)) throw new Error(`"${option.color}" is not a CSS colour`);
  state.backgroundColor = option.color;
  state.sentence = option.sentence.trim() || state.sentence;
  render();
  return snapshot();
}
