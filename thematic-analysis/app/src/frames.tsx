// The recording, one hover away.
//
// `watch-recording` leaves a frame every ten seconds beside the transcript, and the
// rule this skill states is that a claimed action becomes `did` only when the
// transcript or a frame shows it happened. So every timestamp here is a hover target
// and a click opens the frame full screen: the affordance to check, with no verdict
// offered — the researcher does the verifying.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { frameUrl } from './api';
import type { FrameRow } from './types';

export const toSeconds = (ts: string): number => {
  const m = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(ts ?? '');
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : -1;
};

/** The frame at or just before a timestamp — the state of the screen as they spoke. */
export function frameAt(frames: FrameRow[], ts: string | null): FrameRow | null {
  if (!ts || !frames.length) return null;
  const want = toSeconds(ts);
  if (want < 0) return null;
  let best: FrameRow | null = null;
  for (const f of frames) {
    if (f.seconds <= want) best = f;
    else break;
  }
  return best ?? frames[0];
}

export function FramePeek({ dir, t, frames, ts, onOpen, inline = false }: {
  dir: string;
  t: string;
  frames: FrameRow[];
  ts: string | null;
  onOpen: (file: string) => void;
  /** inline: always visible (the inspector). Otherwise it appears on hovering a timestamp. */
  inline?: boolean;
}) {
  const f = useMemo(() => frameAt(frames, ts), [frames, ts]);
  if (!f) return null;
  return (
    <span className={`wb-peek ${inline ? 'wb-peek-inline' : ''}`}>
      <img
        src={frameUrl(dir, t, { file: f.file })}
        alt={`screen at ${f.timestamp}`}
        loading="lazy"
        onClick={(e) => {
          e.stopPropagation();
          onOpen(f.file);
        }}
      />
      <span className="wb-peek-meta">
        {f.timestamp} · {f.file}
        {ts && f.timestamp !== ts ? ` (nearest before ${ts})` : ''}
      </span>
    </span>
  );
}

export function FrameLightbox({ dir, t, frames, file, onClose }: {
  dir: string;
  t: string;
  frames: FrameRow[];
  file: string;
  onClose: () => void;
}) {
  const [cur, setCur] = useState(() => Math.max(0, frames.findIndex((f) => f.file === file)));
  const step = useCallback((d: number) => setCur((c) => Math.max(0, Math.min(frames.length - 1, c + d))), [frames.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, step]);
  const f = frames[cur];
  if (!f) return null;
  return (
    <div className="wb-lightbox" onClick={onClose}>
      <div className="wb-lightbox-inner" onClick={(e) => e.stopPropagation()}>
        <header>
          <button className="wb-btn wb-btn-ghost" onClick={() => step(-1)} disabled={cur === 0} title="Previous frame (←)">
            ◂
          </button>
          <span className="wb-lightbox-ts">
            {f.timestamp} · {f.file} · {cur + 1} of {frames.length}
          </span>
          <button className="wb-btn wb-btn-ghost" onClick={() => step(1)} disabled={cur === frames.length - 1} title="Next frame (→)">
            ▸
          </button>
          <button className="wb-btn wb-btn-ghost wb-lightbox-close" onClick={onClose}>
            Close
          </button>
        </header>
        <img src={frameUrl(dir, t, { file: f.file })} alt={`screen at ${f.timestamp}`} />
      </div>
    </div>
  );
}
