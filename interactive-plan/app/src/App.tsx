import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadPlan, openInEditor, planPathFromUrl, savePlan, watchPlan } from './api';
import { encodeEntities, parsePlan, replaceBlock, serializeBlock } from './parser';
import { DecisionStack, FindingMatrix, QuestionCard } from './blocks';
import { CommentRail } from './comments';
import { Markdown } from './markdown';
import type { Block, CommentBlock, DecisionBlock, FindingBlock, QuestionBlock } from './types';

const nowStamp = () => new Date().toISOString().slice(0, 16);
const today = () => new Date().toISOString().slice(0, 10);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// User text is stored RAW (so reopening an answer doesn't double-escape). It is
// rendered through the escaping path in <Markdown escapeHtml> and is harmless to
// the doc parse because note/answer bodies live inside a comment/question block.

interface SelInfo {
  text: string;
  blockIndex: number;
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

  // ---- new comment from a text selection ----
  function captureSelection() {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !s.toString().trim()) {
      setSel(null);
      return;
    }
    const text = s.toString().trim();
    const anchorEl = (s.anchorNode?.parentElement ?? null)?.closest('[data-block-index]') as HTMLElement | null;
    if (!anchorEl) {
      setSel(null);
      return;
    }
    const rect = s.getRangeAt(0).getBoundingClientRect();
    setSel({ text, blockIndex: Number(anchorEl.dataset.blockIndex), x: rect.left, y: rect.top - 8 });
  }

  function createComment(info: SelInfo, commentText: string) {
    if (content == null || !plan) return;
    const block = plan.blocks[info.blockIndex];
    if (!block) return;
    const ids = plan.blocks.filter((b) => b.type === 'comment').map((b) => Number(/(\d+)/.exec(b.id)?.[1] ?? 0));
    const id = `c${Math.max(0, ...ids) + 1}`;
    const slice = content.slice(block.range.start, block.range.end);
    // whitespace-tolerant search for the selected text within the block source
    const re = new RegExp(escapeRe(info.text).replace(/\s+/g, '\\s+'));
    const m = re.exec(slice);
    if (!m) {
      setToast('Could not anchor the highlight to that selection — try selecting plain prose.');
      setTimeout(() => setToast(null), 3000);
      return;
    }
    const wrapped =
      slice.slice(0, m.index) +
      `<user-highlight comment="${id}">` +
      slice.slice(m.index, m.index + m[0].length) +
      `</user-highlight>` +
      slice.slice(m.index + m[0].length);
    const commentBlock = `\n\n<comment id="${id}" status="open" kind="clarify">\n  <note by="user" at="${nowStamp()}">${encodeEntities(commentText)}</note>\n</comment>`;
    const newContent =
      content.slice(0, block.range.start) + wrapped + commentBlock + content.slice(block.range.end);
    commit(newContent);
    setActiveComment(id);
    setComposer(null);
    setSel(null);
  }

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

  // group consecutive decisions / findings; render the rest inline
  const rendered: JSX.Element[] = [];
  for (let i = 0; i < plan.blocks.length; i++) {
    const b = plan.blocks[i];
    if (b.type === 'comment') continue;
    if (b.type === 'decision') {
      const run: DecisionBlock[] = [];
      while (i < plan.blocks.length && plan.blocks[i].type === 'decision') run.push(plan.blocks[i++] as DecisionBlock);
      i--;
      rendered.push(<DecisionStack key={`d-${i}`} decisions={run} onStatus={onDecisionStatus} />);
    } else if (b.type === 'finding') {
      const run: FindingBlock[] = [];
      while (i < plan.blocks.length && plan.blocks[i].type === 'finding') run.push(plan.blocks[i++] as FindingBlock);
      i--;
      rendered.push(<FindingMatrix key={`f-${i}`} findings={run} onStatus={onFindingStatus} />);
    } else if (b.type === 'question') {
      rendered.push(
        <div key={`q-${i}`} data-block-index={i}>
          <QuestionCard q={b} onAnswer={onAnswer} />
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
        />
      </div>

      {sel && !composer && (
        <button
          className="ip-sel-btn"
          style={{ left: sel.x, top: sel.y }}
          onMouseDown={(e) => {
            e.preventDefault();
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
    </div>
  );
}
