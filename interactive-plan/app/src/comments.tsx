import { useState } from 'react';
import { Markdown } from './markdown';
import type { CommentBlock } from './types';

function CommentCard({
  c,
  active,
  onReply,
  onResolve,
  onReopen,
  onActivate,
}: {
  c: CommentBlock;
  active: boolean;
  onReply: (c: CommentBlock, text: string) => void;
  onResolve: (c: CommentBlock) => void;
  onReopen: (c: CommentBlock) => void;
  onActivate: (id: string) => void;
}) {
  const [reply, setReply] = useState('');
  return (
    <div
      className={`ip-comment ip-status-${c.status} ${active ? 'ip-comment-active' : ''} ${c.kind ? `ip-kind-${c.kind}` : ''}`}
      id={`comment-${c.id}`}
      onClick={() => onActivate(c.id)}
    >
      <header className="ip-comment-head">
        {c.kind && <span className={`ip-kind-tag ip-kind-${c.kind}`}>{c.kind}</span>}
        {c.status === 'resolved' && (
          <span className="ip-resolved-tag">
            Resolved{c.resolvedBy ? ` by ${c.resolvedBy === 'user' ? 'you' : c.resolvedBy}` : ''}
          </span>
        )}
      </header>
      <div className="ip-notes">
        {c.notes.map((n, i) => (
          <div key={i} className={`ip-note ip-by-${n.by}`}>
            <div className="ip-note-meta">
              <span className="ip-note-by">{n.by}</span>
              {n.at && <span className="ip-note-at">{n.at}</span>}
            </div>
            <Markdown source={n.body} escapeHtml />
          </div>
        ))}
      </div>
      {c.status === 'open' ? (
        <div className="ip-comment-actions">
          <textarea
            className="ip-textarea ip-reply"
            placeholder="Reply…"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onClick={(e) => e.stopPropagation()}
          />
          <div className="ip-actions">
            <button
              className="ip-btn ip-btn-primary"
              disabled={!reply.trim()}
              onClick={(e) => {
                e.stopPropagation();
                onReply(c, reply.trim());
                setReply('');
              }}
            >
              Reply
            </button>
            <button
              className="ip-btn ip-btn-ghost"
              onClick={(e) => {
                e.stopPropagation();
                onResolve(c);
              }}
            >
              ✓ Resolve
            </button>
          </div>
        </div>
      ) : (
        <button
          className="ip-btn ip-btn-ghost"
          onClick={(e) => {
            e.stopPropagation();
            onReopen(c);
          }}
        >
          Reopen
        </button>
      )}
    </div>
  );
}

export function CommentRail({
  comments,
  activeId,
  onReply,
  onResolve,
  onReopen,
  onActivate,
}: {
  comments: CommentBlock[];
  activeId: string | null;
  onReply: (c: CommentBlock, text: string) => void;
  onResolve: (c: CommentBlock) => void;
  onReopen: (c: CommentBlock) => void;
  onActivate: (id: string) => void;
}) {
  const [showResolved, setShowResolved] = useState(false);
  const openComments = comments.filter((c) => c.status === 'open');
  const resolved = comments.filter((c) => c.status === 'resolved');
  return (
    <aside className="ip-rail">
      {openComments.map((c) => (
        <CommentCard
          key={c.id}
          c={c}
          active={c.id === activeId}
          onReply={onReply}
          onResolve={onResolve}
          onReopen={onReopen}
          onActivate={onActivate}
        />
      ))}
      {resolved.length > 0 && (
        <div className="ip-resolved-section">
          <button className="ip-btn ip-btn-ghost ip-show-resolved" onClick={() => setShowResolved((s) => !s)}>
            {showResolved ? 'Hide' : 'Show'} {resolved.length} resolved
          </button>
          {showResolved &&
            resolved.map((c) => (
              <CommentCard
                key={c.id}
                c={c}
                active={c.id === activeId}
                onReply={onReply}
                onResolve={onResolve}
                onReopen={onReopen}
                onActivate={onActivate}
              />
            ))}
        </div>
      )}
      {openComments.length === 0 && resolved.length === 0 && (
        <div className="ip-rail-empty">Select any text in the plan to add a comment.</div>
      )}
    </aside>
  );
}
