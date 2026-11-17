// A "?" that opens a view's guidance in a modal. The guidance used to sit in the inspector column
// whenever nothing was selected, which cost the board a 390 px column for three paragraphs the
// researcher had read on day one; now it costs a button until it is asked for.
import { useEffect, useState, type ReactNode } from 'react';

export function Help({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <>
      <button type="button" className="wb-help" title={`How this view works: ${title}`} aria-label={`How this view works: ${title}`} onClick={() => setOpen(true)}>
        ?
      </button>
      {open && (
        <div className="wb-modal" onClick={() => setOpen(false)}>
          <div className="wb-modal-inner wb-help-inner" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
            <h3>{title}</h3>
            {children}
            <p className="wb-help-foot">
              <button type="button" className="wb-btn wb-btn-ghost" onClick={() => setOpen(false)}>
                Close
              </button>
            </p>
          </div>
        </div>
      )}
    </>
  );
}
