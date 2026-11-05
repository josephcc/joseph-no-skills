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
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function render() {
  document.body.style.backgroundColor = state.backgroundColor;
  $('sentence').textContent = state.sentence;
  $('swatch').style.backgroundColor = state.backgroundColor;
  $('color').textContent = state.backgroundColor;
}
export function snapshot() { return { ...state, backgroundColor: document.body.style.backgroundColor || state.backgroundColor }; }
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
