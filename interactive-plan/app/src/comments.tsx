import { useState } from 'react';
import { Markdown } from './markdown';
import type { CommentBlock, Note } from './types';

function NoteView({
  note,
  index,
  canEdit,
  onEdit,
}: {
  note: Note;
  index: number;
  canEdit: boolean;
  onEdit: (index: number, body: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  return (
    <div className={`ip-note ip-by-${note.by}`}>
      <div className="ip-note-meta">
        <span className="ip-note-by">{note.by}</span>
        {note.at && <span className="ip-note-at">{note.at}</span>}
        {canEdit && !editing && (
          <button
            className="ip-note-edit"
            title="Edit"
            onClick={(e) => {
              e.stopPropagation();
              setDraft(note.body);
              setEditing(true);
            }}
          >
            ✎ Edit
          </button>
        )}
      </div>
      {editing ? (
        <div onClick={(e) => e.stopPropagation()}>
          <textarea className="ip-textarea" value={draft} autoFocus onChange={(e) => setDraft(e.target.value)} />
          <div className="ip-actions">
            <button
              className="ip-btn ip-btn-primary"
              disabled={!draft.trim() || draft === note.body}
              onClick={() => {
                onEdit(index, draft.trim());
                setEditing(false);
              }}
            >
              Save
            </button>
            <button className="ip-btn ip-btn-ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <Markdown source={note.body} escapeHtml />
      )}
    </div>
  );
}

function CommentCard({
  c,
  active,
  onReply,
  onResolve,
  onReopen,
  onActivate,
  onEditNote,
  onDeleteThread,
}: {
  c: CommentBlock;
  active: boolean;
  onReply: (c: CommentBlock, text: string) => void;
  onResolve: (c: CommentBlock) => void;
  onReopen: (c: CommentBlock) => void;
  onActivate: (id: string) => void;
  onEditNote: (c: CommentBlock, noteIndex: number, body: string) => void;
  onDeleteThread: (c: CommentBlock) => void;
}) {
  const [reply, setReply] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
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
        {confirmDelete ? (
          <span className="ip-del-confirm" onClick={(e) => e.stopPropagation()}>
            Delete thread?
            <button
              className="ip-btn ip-btn-danger"
              onClick={() => {
                onDeleteThread(c);
                setConfirmDelete(false);
              }}
            >
              Delete
            </button>
            <button className="ip-btn ip-btn-ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </span>
        ) : (
          <button
            className="ip-thread-del"
            title="Delete this comment thread"
            onClick={(e) => {
              e.stopPropagation();
              setConfirmDelete(true);
            }}
          >
            🗑
          </button>
        )}
      </header>
      <div className="ip-notes">
        {c.notes.map((n, i) => (
          <NoteView
            key={i}
            note={n}
            index={i}
            canEdit={n.by === 'user'}
            onEdit={(idx, body) => onEditNote(c, idx, body)}
          />
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
  onEditNote,
  onDeleteThread,
}: {
  comments: CommentBlock[];
  activeId: string | null;
  onReply: (c: CommentBlock, text: string) => void;
  onResolve: (c: CommentBlock) => void;
  onReopen: (c: CommentBlock) => void;
  onActivate: (id: string) => void;
  onEditNote: (c: CommentBlock, noteIndex: number, body: string) => void;
  onDeleteThread: (c: CommentBlock) => void;
}) {
  const [showResolved, setShowResolved] = useState(false);
  const openComments = comments.filter((c) => c.status === 'open');
  const resolved = comments.filter((c) => c.status === 'resolved');
  const cardProps = { onReply, onResolve, onReopen, onActivate, onEditNote, onDeleteThread };
  return (
    <aside className="ip-rail">
      {openComments.map((c) => (
        <CommentCard key={c.id} c={c} active={c.id === activeId} {...cardProps} />
      ))}
      {resolved.length > 0 && (
        <div className="ip-resolved-section">
          <button className="ip-btn ip-btn-ghost ip-show-resolved" onClick={() => setShowResolved((s) => !s)}>
            {showResolved ? 'Hide' : 'Show'} {resolved.length} resolved
          </button>
          {showResolved &&
            resolved.map((c) => <CommentCard key={c.id} c={c} active={c.id === activeId} {...cardProps} />)}
        </div>
      )}
      {openComments.length === 0 && resolved.length === 0 && (
        <div className="ip-rail-empty">Select any text in the plan to add a comment.</div>
      )}
    </aside>
  );
}
