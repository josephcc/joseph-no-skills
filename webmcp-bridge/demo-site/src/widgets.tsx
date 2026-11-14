// The demo's in-chat widgets (plan in-chat-widgets §4.10): a palette proposal card (P1) and reply chips (P2).
// Each is an ordinary page component: it reads and changes page state directly and reports what the user did
// through `note()`, which rides along with the next prompt.
import type { WidgetMap, WidgetProps } from 'webmcp-connector/react';
import { applyPalette } from './state.ts';

export interface PaletteOption { color: string; sentence: string; why?: string }
export interface PaletteInput { story?: string; options?: PaletteOption[] }
export interface PaletteOutput { card: string; story: string; options: Array<PaletteOption & { index: number }> }
interface PaletteState { applied?: number }

export function PaletteCard({ input, output, status, error, restored, state, setState, note }: WidgetProps<PaletteInput, PaletteOutput, PaletteState>) {
  const story = output?.story ?? input.story ?? '';
  const options = output?.options ?? (input.options ?? []).map((o, i) => ({ index: i + 1, ...o }));
  if (status === 'pending' || status === 'in_progress') return <div className="demo-card"><em>Preparing palette ideas…</em>{story && <p className="demo-card-story">{story}</p>}</div>;
  if (error) return <div className="demo-card demo-card-error">The palette card failed: {error}</div>;
  return (
    <div className="demo-card" data-card={output?.card}>
      {story && <p className="demo-card-story">{story}</p>}
      <ul className="demo-palette">
        {options.map((o) => {
          const applied = state?.applied === o.index;
          return (
            <li key={o.index} data-index={o.index} data-applied={applied ? 'true' : undefined}>
              <span className="demo-swatch" style={{ backgroundColor: o.color }} title={o.color} />
              <span className="demo-option"><strong>{o.sentence}</strong>{o.why && <small>{o.why}</small>}</span>
              <button type="button" className={applied ? '' : 'wmc-primary'} data-action="use" onClick={() => {
                try { applyPalette(o); } catch (err) { note(`Could not apply palette option ${o.index}: ${(err as Error).message}`); return; }
                setState({ applied: o.index });
                note(`Applied palette option ${o.index} (${o.color}): "${o.sentence}"`);
              }}>{applied ? 'Applied ✓' : 'Use'}</button>
            </li>
          );
        })}
      </ul>
      {restored && <small className="demo-card-note">Restored from this thread's history.</small>}
    </div>
  );
}

export function RepliesRow({ input, status, live, prompt }: WidgetProps<{ replies?: string[] }, { shown: number }>) {
  if (!prompt || status !== 'completed') return null;   // no thread to send to (floating panel), or not ready yet
  const replies = (input.replies ?? []).filter((r) => typeof r === 'string' && r.trim());
  if (replies.length === 0) return null;
  return (
    <div className="demo-replies" role="group" aria-label="Suggested replies">
      {replies.map((r, i) => <button key={i} type="button" data-action="reply" disabled={live} onClick={() => { void prompt(r).catch(() => { /* busy: the chip is disabled then anyway */ }); }}>{r}</button>)}
    </div>
  );
}

export const WIDGETS: WidgetMap = {
  propose_palette: PaletteCard,
  // Chips belong under the reply that points at them, and only while that reply is the latest one.
  suggest_replies: { component: RepliesRow, placement: 'end', latestOnly: true },
};
