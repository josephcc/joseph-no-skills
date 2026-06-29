import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadPlan, openInEditor, planPathFromUrl, savePlan, watchPlan } from './api';
import {
  appendTarget,
  encodeEntities,
  parsePlan,
  removeHighlight,
  replaceBlock,
  serializeBlock,
  wrapNthOccurrence,
} from './parser';
import { CheckList, DecisionStack, FindingMatrix, QuestionCard } from './blocks';
import { CommentRail } from './comments';
import { Markdown } from './markdown';
import type { Block, CheckBlock, CommentBlock, DecisionBlock, FindingBlock, QuestionBlock } from './types';

const nowStamp = () => new Date().toISOString().slice(0, 16);
const today = () => new Date().toISOString().slice(0, 10);
// User text is stored RAW (so reopening an answer doesn't double-escape). It is
// rendered through the escaping path in <Markdown escapeHtml> and is harmless to
// the doc parse because note/answer bodies live inside a comment/question block.

// Count whitespace-tolerant occurrences of `needle` in `hay` (same normalization
// wrapNthOccurrence uses on the source), so the rendered-text count lines up with
// the source-text count when picking which occurrence to wrap.
function countOccurrences(hay: string, needle: string): number {
  const norm = needle.trim();
  if (!norm) return 0;
  const re = new RegExp(norm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'g');
  let n = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(hay))) {
    n++;
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return n;
}

interface SelInfo {
  text: string;
  blockIndex: number;
  occ: number; // which occurrence of `text` within the block (0-based)
  x: number;
  y: number;
}

export function App() {
  const [planPath] = useState(planPathFromUrl);
  const [content, setContent] = useState<string | null>(null);
  const [hash, setHash] = useState('');
  const [path, setPath] = useState('');
  const [activeComment, setActiveComment] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [sel, setSel] = useState<SelInfo | null>(null);
  const [composer, setComposer] = useState<{ sel: SelInfo; text: string } | null>(null);
  const [elComposer, setElComposer] = useState<{ block: Block; text: string; x: number; y: number } | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const hashRef = useRef(hash);
  hashRef.current = hash;
  const mainRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!planPath) return;
    loadPlan(planPath).then((p) => {
      setContent(p.content);
      setHash(p.hash);
      setPath(p.path);
    });
    return watchPlan(planPath, ({ content: c, hash: h }) => {
      if (h === hashRef.current) return; // our own write echoing back
      setContent(c);
      setHash(h);
      setComposer(null); // a stale selection/composer would anchor wrongly after reload
      setElComposer(null);
      setSel(null);
      setToast('Plan updated by the agent — reloaded.');
      setTimeout(() => setToast(null), 2500);
    });
  }, [planPath]);

  // Condense the header once the user scrolls past the top.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Dismiss the floating "Comment" button on Escape or when the selection
  // clears (an off-click anywhere collapses the selection).
  useEffect(() => {
    const onSelChange = () => {
      if (composer) return; // keep it while the composer is open
      const s = window.getSelection();
      if (!s || s.isCollapsed || !s.toString().trim()) setSel(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSel(null);
        setComposer(null);
        setElComposer(null);
      }
    };
    document.addEventListener('selectionchange', onSelChange);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('selectionchange', onSelChange);
      document.removeEventListener('keydown', onKey);
    };
  }, [composer]);

  const plan = useMemo(() => (content == null ? null : parsePlan(content)), [content]);

  const commentMeta = useMemo(() => {
    const m: Record<string, { status: string; kind: string | null }> = {};
    plan?.blocks.forEach((b) => {
      if (b.type === 'comment') m[b.id] = { status: b.status, kind: b.kind };
    });
    return m;
  }, [plan]);

  const commit = useCallback(async (newContent: string) => {
    const base = hashRef.current;
    setContent(newContent); // optimistic
    const res = await savePlan(planPath!, newContent, base);
    if (res.conflict) {
      setConflict(true);
      setPending(newContent); // keep the user's attempted edit so it isn't lost
      if (res.currentContent && res.currentHash) {
        setContent(res.currentContent);
        setHash(res.currentHash);
      }
      return;
    }
    setPending(null);
    if (res.ok && res.hash) setHash(res.hash);
  }, [planPath]);

  // ---- edit handlers ----
  const editBlock = useCallback(
    (block: Block, next: Block) => {
      if (content == null) return;
      commit(replaceBlock(content, block.range, serializeBlock(next)));
    },
    [content, commit],
  );

  const onAnswer = (q: QuestionBlock, chose: string[], text: string) =>
    editBlock(q, { ...q, status: 'answered', answer: { by: 'user', at: nowStamp(), chose, text } });

  const onDecisionStatus = (d: DecisionBlock, status: DecisionBlock['status']) =>
    editBlock(d, { ...d, status, date: status === 'locked' ? today() : d.date });

  const onFindingStatus = (f: FindingBlock, status: FindingBlock['status']) => editBlock(f, { ...f, status });

  const onReply = (c: CommentBlock, text: string) =>
    editBlock(c, { ...c, notes: [...c.notes, { by: 'user', at: nowStamp(), body: text }] });

  const onResolve = (c: CommentBlock) =>
    editBlock(c, { ...c, status: 'resolved', resolvedBy: 'user', resolvedAt: nowStamp() });

  const onReopen = (c: CommentBlock) => editBlock(c, { ...c, status: 'open', resolvedBy: null, resolvedAt: null });

  // Toggle a <check> block's status (todo↔done) — id-addressed, via the same
  // block-edit round-trip as decisions/comments.
  const onCheckToggle = (c: CheckBlock) =>
    editBlock(c, { ...c, status: c.status === 'done' ? 'todo' : 'done' });

  // ---- new comment from a text selection (prose blocks only) ----
  function captureSelection() {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !s.toString().trim()) {
      setSel(null);
      return;
    }
    const text = s.toString().trim();
    const range = s.getRangeAt(0);
    const anchorEl = (range.startContainer.parentElement ?? null)?.closest('[data-block-index]') as HTMLElement | null;
    if (!anchorEl) {
      setSel(null);
      return;
    }
    const blockIndex = Number(anchorEl.dataset.blockIndex);
    // Free-text span selection only anchors in prose. Structured blocks
    // (questions, decisions, findings, checks) are commented via their ◆ marker.
    if (plan?.blocks[blockIndex]?.type !== 'markdown') {
      setSel(null);
      return;
    }
    // Which occurrence of `text` is selected: count copies that fully precede the
    // selection start within this block's rendered text. That index is handed to
    // wrapNthOccurrence so the *selected* phrase is highlighted, not the first.
    const before = range.cloneRange();
    before.selectNodeContents(anchorEl);
    before.setEnd(range.startContainer, range.startOffset);
    const occ = countOccurrences(before.toString(), text);
    const rect = range.getBoundingClientRect();
    setSel({ text, blockIndex, occ, x: rect.left, y: rect.top - 8 });
  }

  const nextCommentId = () => {
    const ids = (plan?.blocks ?? [])
      .filter((b) => b.type === 'comment')
      .map((b) => Number(/(\d+)/.exec(b.id)?.[1] ?? 0));
    return `c${Math.max(0, ...ids) + 1}`;
  };
  const commentSource = (id: string, text: string) =>
    `\n\n<comment id="${id}" status="open" kind="clarify">\n  <note by="user" at="${nowStamp()}">${encodeEntities(text)}</note>\n</comment>`;

  // Comment on a prose selection: wrap the exact selected occurrence as a span;
  // if that phrase can't be wrapped cleanly (repeats beyond the source, lands in
  // code), fall back to an appended ◆ target so the anchor is never wrong.
  function createComment(info: SelInfo, commentText: string) {
    if (content == null || !plan) return;
    const block = plan.blocks[info.blockIndex];
    if (!block || block.type !== 'markdown') return;
    const id = nextCommentId();
    const slice = content.slice(block.range.start, block.range.end);
    const wrapped = wrapNthOccurrence(slice, info.text, info.occ, id) ?? appendTarget(slice, id);
    const newContent =
      content.slice(0, block.range.start) + wrapped + commentSource(id, commentText) + content.slice(block.range.end);
    commit(newContent);
    setActiveComment(id);
    setComposer(null);
    setSel(null);
  }

  // Comment on a structured block (decision, finding, check, question) — anchor a
  // ◆ target to its primary field, so the comment can never drift to a duplicate
  // phrase. The element's ◆ marker then activates this thread.
  function addElementComment(block: Block, commentText: string) {
    if (content == null || !plan) return;
    const id = nextCommentId();
    let next: Block;
    if (block.type === 'check') next = { ...block, label: appendTarget(block.label, id) };
    else if (block.type === 'decision' || block.type === 'finding' || block.type === 'question')
      next = { ...block, body: appendTarget(block.body, id) };
    else return;
    const newContent =
      replaceBlock(content, block.range, serializeBlock(next)) + commentSource(id, commentText);
    commit(newContent);
    setActiveComment(id);
    setElComposer(null);
  }

  // ---- edit / delete comments ----
  // Edit one note's text (UI only exposes this for the user's own notes).
  const onEditNote = (c: CommentBlock, noteIndex: number, body: string) =>
    editBlock(c, { ...c, notes: c.notes.map((n, i) => (i === noteIndex ? { ...n, body } : n)) });

  // Delete a whole thread: strip its highlight/target anchor(s), then drop the
  // <comment> block and collapse the blank lines it leaves behind.
  const onDeleteThread = (c: CommentBlock) => {
    if (content == null) return;
    let next = removeHighlight(content, c.id);
    const cb = parsePlan(next).blocks.find((b) => b.type === 'comment' && b.id === c.id);
    if (cb) next = replaceBlock(next, cb.range, '').replace(/\n{3,}/g, '\n\n');
    if (activeComment === c.id) setActiveComment(null);
    commit(next);
  };

  // ---- click delegation: code refs + highlight activation ----
  function onMainClick(e: React.MouseEvent) {
    const target = e.target as HTMLElement;
    const ref = target.closest('.ip-coderef') as HTMLElement | null;
    if (ref?.dataset.ref) {
      const refStr = ref.dataset.ref;
      void openInEditor(refStr, planPath!).then((ok) => {
        if (!ok) {
          setToast(`Couldn't open ${refStr} — no such file under the plan's repo.`);
          setTimeout(() => setToast(null), 3000);
        }
      });
      return;
    }
    const hl = target.closest('.ip-hl') as HTMLElement | null;
    if (hl?.dataset.comment) {
      setActiveComment(hl.dataset.comment);
      document.getElementById(`comment-${hl.dataset.comment}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function activateComment(id: string) {
    setActiveComment(id);
    const mark = mainRef.current?.querySelector(`.ip-hl[data-comment="${id}"]`);
    mark?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    mark?.classList.add('ip-hl-flash');
    setTimeout(() => mark?.classList.remove('ip-hl-flash'), 900);
  }

  if (!planPath)
    return <div className="ip-loading">No plan specified — open via the interactive-plan skill (the URL needs a <code>?plan=</code> path).</div>;
  if (content == null || !plan) return <div className="ip-loading">Loading plan…</div>;

  const comments = plan.blocks.filter((b): b is CommentBlock => b.type === 'comment');

  const commenting = {
    commentMeta,
    onAddComment: (block: Block, e: React.MouseEvent) => {
      setComposer(null); // close any open prose-selection composer
      setSel(null);
      setElComposer({ block, text: '', x: e.clientX, y: e.clientY });
    },
    onActivateComment: activateComment,
  };

  // group consecutive decisions / findings; render the rest inline
  const rendered: JSX.Element[] = [];
  for (let i = 0; i < plan.blocks.length; i++) {
    const b = plan.blocks[i];
    if (b.type === 'comment') continue;
    if (b.type === 'decision') {
      const run: DecisionBlock[] = [];
      while (i < plan.blocks.length && plan.blocks[i].type === 'decision') run.push(plan.blocks[i++] as DecisionBlock);
      i--;
      rendered.push(<DecisionStack key={`d-${i}`} decisions={run} commenting={commenting} onStatus={onDecisionStatus} />);
    } else if (b.type === 'finding') {
      const run: FindingBlock[] = [];
      while (i < plan.blocks.length && plan.blocks[i].type === 'finding') run.push(plan.blocks[i++] as FindingBlock);
      i--;
      rendered.push(<FindingMatrix key={`f-${i}`} findings={run} commenting={commenting} onStatus={onFindingStatus} />);
    } else if (b.type === 'check') {
      const start = i;
      const run: CheckBlock[] = [];
      while (i < plan.blocks.length && plan.blocks[i].type === 'check') run.push(plan.blocks[i++] as CheckBlock);
      i--;
      rendered.push(<CheckList key={`c-${start}`} checks={run} commenting={commenting} onToggle={onCheckToggle} />);
    } else if (b.type === 'question') {
      rendered.push(
        <div key={`q-${i}`}>
          <QuestionCard q={b} commenting={commenting} onAnswer={onAnswer} />
        </div>,
      );
    } else {
      rendered.push(
        <div key={`m-${i}`} data-block-index={i}>
          <Markdown source={b.text} commentMeta={commentMeta} />
        </div>,
      );
    }
  }

  const openCount = plan.blocks.filter((b) => b.type === 'question' && b.status === 'open').length;

  return (
    <div className="ip-app">
      <header className={`ip-header ${scrolled ? 'ip-header-compact' : ''}`}>
        <div className="ip-header-main">
          <h1>{plan.title ?? 'Plan'}</h1>
          <div className="ip-preamble">
            {plan.preamble.map((kv) => (
              <span key={kv.key} className="ip-meta">
                <b>{kv.key}:</b> {kv.value}
              </span>
            ))}
          </div>
        </div>
        <div className="ip-header-side">
          {openCount > 0 && <span className="ip-openq">{openCount} open question{openCount > 1 ? 's' : ''}</span>}
          <span className="ip-path" title={path}>
            {path.split('/').slice(-1)[0]}
          </span>
        </div>
      </header>

      {toast && <div className="ip-toast">{toast}</div>}
      {conflict && (
        <div className="ip-conflict">
          ⚠️ This plan changed on disk while you were editing — the newest on-disk version is shown.{' '}
          {pending != null && (
            <button
              className="ip-btn ip-btn-ghost"
              onClick={() => {
                const mine = pending;
                setConflict(false);
                setPending(null);
                commit(mine);
              }}
            >
              Overwrite with my version
            </button>
          )}{' '}
          <button
            className="ip-btn ip-btn-ghost"
            onClick={() => {
              setConflict(false);
              setPending(null);
            }}
          >
            Discard my change
          </button>
        </div>
      )}

      <div className="ip-layout">
        <main className="ip-main" ref={mainRef} onClick={onMainClick} onMouseUp={captureSelection}>
          {rendered}
        </main>
        <CommentRail
          comments={comments}
          activeId={activeComment}
          onReply={onReply}
          onResolve={onResolve}
          onReopen={onReopen}
          onActivate={activateComment}
          onEditNote={onEditNote}
          onDeleteThread={onDeleteThread}
        />
      </div>

      {sel && !composer && (
        <button
          className="ip-sel-btn"
          style={{ left: sel.x, top: sel.y }}
          onMouseDown={(e) => {
            e.preventDefault();
            setElComposer(null); // close any open element composer
            setComposer({ sel, text: '' });
          }}
        >
          💬 Comment
        </button>
      )}
      {composer && (
        <div className="ip-composer" style={{ left: composer.sel.x, top: composer.sel.y + 24 }}>
          <div className="ip-composer-quote">“{composer.sel.text.slice(0, 80)}”</div>
          <textarea
            className="ip-textarea"
            autoFocus
            placeholder="Comment…"
            value={composer.text}
            onChange={(e) => setComposer({ ...composer, text: e.target.value })}
          />
          <div className="ip-actions">
            <button
              className="ip-btn ip-btn-primary"
              disabled={!composer.text.trim()}
              onClick={() => createComment(composer.sel, composer.text.trim())}
            >
              Add comment
            </button>
            <button className="ip-btn ip-btn-ghost" onClick={() => setComposer(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {elComposer && (
        <div className="ip-composer" style={{ left: elComposer.x, top: elComposer.y + 16 }}>
          <div className="ip-composer-quote">
            Comment on {elComposer.block.type}
            {'id' in elComposer.block ? ` ${(elComposer.block as { id: string }).id}` : ''}
          </div>
          <textarea
            className="ip-textarea"
            autoFocus
            placeholder="Comment…"
            value={elComposer.text}
            onChange={(e) => setElComposer({ ...elComposer, text: e.target.value })}
          />
          <div className="ip-actions">
            <button
              className="ip-btn ip-btn-primary"
              disabled={!elComposer.text.trim()}
              onClick={() => addElementComment(elComposer.block, elComposer.text.trim())}
            >
              Add comment
            </button>
            <button className="ip-btn ip-btn-ghost" onClick={() => setElComposer(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
