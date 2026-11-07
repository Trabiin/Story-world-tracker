/**
 * NT-1: margin comments on the scene text. Select words and press Comment (Ctrl+Alt+M): a card
 * opens in the margin beside them. A card can be edited, resolved, deleted, or turned into a to-do
 * in one click; the to-do links back to the comment.
 */
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Id, SceneText, TextComment, TextNode, commentTodo, dmy, removeCommentMarks, todoForComment } from '../../core';
import { newId, nowIso, recordBase } from '../../storage';
import { useApp } from '../context';
import type { WorldStore } from '../store';
import { commitText } from './SceneEditor';
import { schema } from './schema';

/** Change one scene's comment list (not an undo step: comments belong to the text, which has its own undo). */
export function setComments(store: WorldStore, sceneId: Id, fn: (c: TextComment[]) => TextComment[]) {
  store.update((w) => ({ ...w, sceneTexts: w.sceneTexts.map((t) => (t.sceneId === sceneId ? { ...t, comments: fn(t.comments ?? []), updatedAt: nowIso() } : t)) }), false);
}

/** The selected words, or the word at the cursor. */
function commentRange(v: EditorView): { from: number; to: number } | null {
  const { from, to, empty, $from } = v.state.selection;
  if (!empty) return { from, to };
  const text = $from.parent.textContent;
  const off = $from.parentOffset;
  const left = /[\p{L}\p{N}’'-]*$/u.exec(text.slice(0, off))?.[0].length ?? 0;
  const right = /^[\p{L}\p{N}’'-]*/u.exec(text.slice(off))?.[0].length ?? 0;
  return left + right ? { from: from - left, to: from + right } : null;
}

/** Put a new, empty comment on the selection. Returns its id, or null when nothing is selected. */
export function addComment(store: WorldStore, sceneId: Id, v: EditorView, author: string): Id | null {
  const r = commentRange(v);
  if (!r) return null;
  const id = newId();
  const tr = v.state.tr.addMark(r.from, r.to, schema.marks.comment.create({ id }));
  v.dispatch(tr.setSelection(TextSelection.create(tr.doc, r.to)));
  commitText(store, sceneId, v.state.doc.toJSON() as TextNode, (cs) => [...cs, { id, author, date: nowIso(), text: '' }]);
  return id;
}

/** Delete a comment and its mark (through the editor when it is open, so unsaved typing keeps it off too). */
export function deleteComment(store: WorldStore, sceneId: Id, v: EditorView | undefined, id: Id) {
  if (v) {
    v.dispatch(v.state.tr.removeMark(0, v.state.doc.content.size, schema.marks.comment.create({ id })).setMeta('addToHistory', false));
    commitText(store, sceneId, v.state.doc.toJSON() as TextNode, (cs) => cs.filter((c) => c.id !== id));
  } else {
    store.update((w) => ({ ...w, sceneTexts: w.sceneTexts.map((t) => (t.sceneId === sceneId ? { ...t, doc: removeCommentMarks(t.doc, id), comments: (t.comments ?? []).filter((c) => c.id !== id), updatedAt: nowIso() } : t)) }), false);
  }
}

/** Where each comment first appears in the text (document order). */
function commentOrder(doc: TextNode | undefined): Map<Id, number> {
  const out = new Map<Id, number>();
  let i = 0;
  const walk = (n: TextNode) => {
    for (const m of n.marks ?? []) if (m.type === 'comment' && !out.has(m.attrs?.id as Id)) out.set(m.attrs!.id as Id, i);
    i++;
    n.content?.forEach(walk);
  };
  if (doc) walk(doc);
  return out;
}

/** The extent of a comment's mark in the editor. */
function markRange(v: EditorView, id: Id): { from: number; to: number } | null {
  let from = -1, to = -1;
  v.state.doc.descendants((n, pos) => {
    if (n.isText && n.marks.some((m) => m.type === schema.marks.comment && m.attrs.id === id)) {
      if (from < 0) from = pos;
      to = pos + n.nodeSize;
    }
  });
  return from < 0 ? null : { from, to };
}

/** Light up the commented words while the card is hovered. */
function highlight(sceneId: Id, id: Id, on: boolean) {
  document.querySelectorAll(`#scene-${CSS.escape(sceneId)} [data-comment="${CSS.escape(id)}"]`).forEach((el) => el.classList.toggle('hl', on));
}

interface Props {
  sceneId: Id;
  text: SceneText | undefined;
  getView: () => EditorView | undefined;
  /** Beside the text (there is room) or under the scene. */
  side: boolean;
  editing: Id | undefined;
  setEditing: (id: Id | undefined) => void;
}

export function CommentMargin({ sceneId, text, getView, side, editing, setEditing }: Props) {
  const { store, world, go } = useApp();
  const [showResolved, setShowResolved] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const order = useMemo(() => commentOrder(text?.doc), [text?.doc]);
  const all = useMemo(() => [...(text?.comments ?? [])].sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9)), [text?.comments, order]);
  const open = all.filter((c) => !c.resolved || c.id === editing);
  const resolved = all.filter((c) => c.resolved && c.id !== editing);
  const shown = showResolved ? all : open;

  useEffect(() => {
    const r = () => redraw();
    window.addEventListener('resize', r);
    return () => window.removeEventListener('resize', r);
  }, []);
  // Beside the text: each card at the height of its words, pushed down when cards would overlap.
  useLayoutEffect(() => {
    const el = host.current;
    if (!el || !side) return;
    const v = getView();
    const top0 = el.getBoundingClientRect().top;
    let bottom = 0;
    el.querySelectorAll<HTMLElement>('.comment-card').forEach((card, i) => {
      let y = i * 8;
      const r = v && markRange(v, card.dataset.id!);
      if (v && r) { try { y = v.coordsAtPos(r.from).top - top0; } catch { /* not drawn */ } }
      const top = Math.max(y, bottom);
      card.style.top = `${top}px`;
      bottom = top + card.offsetHeight + 6;
    });
    el.style.minHeight = `${bottom}px`;
  });

  if (!all.length) return null;
  const author = world.settings.writing?.authorName || 'Me';
  const select = (c: TextComment) => {
    const v = getView();
    const r = v && markRange(v, c.id);
    if (!v || !r) return;
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, r.from, r.to)).scrollIntoView());
    v.focus();
  };
  const finish = (c: TextComment, value: string) => {
    setEditing(undefined);
    if (!value.trim()) deleteComment(store, sceneId, getView(), c.id);
  };
  const toTodo = (c: TextComment) => {
    if (!text) return;
    const t = commentTodo(text, c, recordBase());
    store.upsert('todos', t);
  };
  return (
    <div className={`comment-margin ${side ? 'side' : 'below'}`} ref={host} onMouseDown={(e) => e.stopPropagation()}>
      {shown.map((c) => {
        const todo = todoForComment(world, c.id);
        return (
          <div key={c.id} data-id={c.id} className={`comment-card ${c.resolved ? 'resolved' : ''}`} onMouseEnter={() => highlight(sceneId, c.id, true)} onMouseLeave={() => highlight(sceneId, c.id, false)} onClick={(e) => { if (!(e.target as HTMLElement).closest('button, textarea')) select(c); }}>
            <div className="comment-head"><b>{c.author || author}</b>{c.date && <span className="muted"> · {dmy(c.date)}</span>}{c.resolved && <span className="muted"> · resolved</span>}</div>
            {editing === c.id ? (
              <textarea autoFocus rows={3} defaultValue={c.text} placeholder="Your comment"
                onChange={(e) => { const value = e.target.value; setComments(store, sceneId, (cs) => cs.map((x) => (x.id === c.id ? { ...x, text: value } : x))); }}
                onBlur={(e) => finish(c, e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); e.stopPropagation(); (e.target as HTMLTextAreaElement).blur(); getView()?.focus(); } }} />
            ) : (
              <div className="comment-text" onDoubleClick={() => !store.readOnly && setEditing(c.id)}>{c.text || <span className="muted">(empty)</span>}</div>
            )}
            {!store.readOnly && editing !== c.id && (
              <div className="comment-actions">
                {todo
                  ? <button className="link" onClick={() => go('todos', todo.id)} title="Open the to-do made from this comment">{todo.done ? '✓ To-do done' : 'To-do'}</button>
                  : <button className="link" onClick={() => toTodo(c)} title="NT-1: add a to-do about this scene that links back to this comment">Make to-do</button>}
                <button className="link" onClick={() => setEditing(c.id)}>Edit</button>
                <button className="link" onClick={() => setComments(store, sceneId, (cs) => cs.map((x) => (x.id === c.id ? { ...x, resolved: x.resolved ? undefined : true } : x)))}>{c.resolved ? 'Reopen' : 'Resolve'}</button>
                <button className="link" onClick={() => deleteComment(store, sceneId, getView(), c.id)}>Delete</button>
              </div>
            )}
          </div>
        );
      })}
      {resolved.length > 0 && <div className="comment-card comment-resolved-toggle"><button className="link small" onClick={() => setShowResolved(!showResolved)}>{showResolved ? 'Hide resolved' : `${resolved.length} resolved`}</button></div>}
    </div>
  );
}

/** A to-do or search result asked to show a comment: Write picks this up when it opens the scene. */
let pendingComment: { sceneId: Id; commentId: Id } | undefined;
export function requestComment(sceneId: Id, commentId: Id) { pendingComment = { sceneId, commentId }; }
export function takeCommentRequest(sceneId: Id | undefined) {
  if (!pendingComment || pendingComment.sceneId !== sceneId) return undefined;
  const id = pendingComment.commentId;
  pendingComment = undefined;
  return id;
}
