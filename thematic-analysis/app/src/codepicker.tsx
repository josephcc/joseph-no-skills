// Adding a code, with its rule in view.
//
// Principle 4: no coding verdict is asked for without the code's definition beside the
// passage. So the picker searches ids, names and definitions, shows the definition of
// whatever is focused, and marks candidates — because accepting a candidate is a
// different act from applying an accepted code.
import { useMemo, useState } from 'react';
import { familyIndex, searchCodes } from './codes';
import type { Code } from './types';

export function CodePicker({ codes, exclude = [], onPick, onCancel, placeholder = 'code…' }: {
  codes: Code[];
  exclude?: string[];
  onPick: (id: string) => void;
  onCancel?: () => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const hues = useMemo(() => familyIndex(codes), [codes]);
  const results = useMemo(() => searchCodes(codes, q).filter((c) => !exclude.includes(c.id)), [codes, q, exclude]);
  const focused = results[Math.min(cursor, results.length - 1)];
  return (
    <div className="wb-picker" onClick={(e) => e.stopPropagation()}>
      <input
        className="wb-input"
        autoFocus
        placeholder={placeholder}
        value={q}
        onChange={(ev) => {
          setQ(ev.target.value);
          setCursor(0);
        }}
        onKeyDown={(ev) => {
          if (ev.key === 'ArrowDown') {
            ev.preventDefault();
            setCursor((c) => Math.min(results.length - 1, c + 1));
          } else if (ev.key === 'ArrowUp') {
            ev.preventDefault();
            setCursor((c) => Math.max(0, c - 1));
          } else if (ev.key === 'Enter' && focused) {
            ev.preventDefault();
            onPick(focused.id);
          } else if (ev.key === 'Escape') {
            ev.preventDefault();
            onCancel?.();
          }
        }}
      />
      <ul className="wb-picker-list">
        {results.map((c, i) => (
          <li
            key={c.id}
            className={`wb-picker-row ${i === cursor ? 'wb-picker-on' : ''}`}
            onMouseEnter={() => setCursor(i)}
            onClick={() => onPick(c.id)}
          >
            <span className="wb-swatch" style={{ ['--hue' as string]: hues[c.id] ?? 0 }} />
            <code>{c.id}</code>
            <span className="wb-picker-name">{c.name}</span>
            <span className="wb-picker-n" title="participants · extracts (from ta.py)">
              {c.n}p · {c.extracts}
            </span>
            {c.status === 'candidate' && <span className="wb-cand" title="still a candidate code">◦</span>}
          </li>
        ))}
        {!results.length && <li className="wb-muted wb-picker-row">no code matches. The agent proposes new codes; you accept them.</li>}
      </ul>
      {/* Fixed height on purpose: a panel that grows and shrinks per code moves the list
          under the pointer, which walks the cursor onto the next row and loops. */}
      {focused && (
        <div className="wb-picker-def">
          <b>{focused.id}</b> · {focused.name}
          <p>{focused.definition || <i>no definition yet</i>}</p>
          {focused.include && (
            <p className="wb-muted">
              <b>include:</b> {focused.include}
            </p>
          )}
          {focused.exclude && (
            <p className="wb-muted">
              <b>exclude:</b> {focused.exclude}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
