/** EU-14: to-dos and plot holes, each linked to the records it concerns. */
import { useMemo, useState } from 'react';
import { Todo, commentQuote, quoted } from '../../core';
import { requestComment } from '../writing/Comments';
import { recordBase } from '../../storage';
import { ask } from '../components/Dialogs';
import { Field } from '../components/Modal';
import { RefChip, RefPicker } from '../components/Refs';
import { useApp } from '../context';

type Show = 'open' | 'holes' | 'done' | 'all';

export function Todos() {
  const { world, store, selected, select } = useApp();
  const [show, setShow] = useState<Show>('open');
  const [q, setQ] = useState('');
  const list = useMemo(() => world.todos
    .filter((t) => (show === 'open' ? !t.done : show === 'holes' ? t.kind === 'plot-hole' && !t.done : show === 'done' ? t.done : true))
    .filter((t) => !q || `${t.title} ${t.note}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(a.done) - Number(b.done) || b.createdAt.localeCompare(a.createdAt)), [world.todos, show, q]);
  const add = (kind: Todo['kind']) => {
    const t: Todo = { ...recordBase(), title: kind === 'plot-hole' ? 'New plot hole' : 'New to-do', note: '', kind, done: false, refs: [] };
    store.upsert('todos', t);
    select(t.id);
  };
  const cur = world.todos.find((t) => t.id === selected);
  const count = (f: (t: Todo) => boolean) => world.todos.filter(f).length;
  return (
    <div className="master-detail">
      <aside className="master">
        <div className="master-tools">
          <div className="row"><button className="primary grow" onClick={() => add('todo')}>+ To-do</button><button className="grow" onClick={() => add('plot-hole')}>+ Plot hole</button></div>
          <select value={show} onChange={(e) => setShow(e.target.value as Show)}>
            <option value="open">Open ({count((t) => !t.done)})</option>
            <option value="holes">Open plot holes ({count((t) => !t.done && t.kind === 'plot-hole')})</option>
            <option value="done">Done ({count((t) => t.done)})</option>
            <option value="all">Everything ({world.todos.length})</option>
          </select>
          <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <ul className="list">
          {list.map((t) => (
            <li key={t.id} className={`${t.id === selected ? 'active' : ''} ${t.done ? 'later' : ''}`} onClick={() => select(t.id)}>
              <input type="checkbox" checked={t.done} onClick={(e) => e.stopPropagation()} onChange={(e) => store.upsert('todos', { ...t, done: e.target.checked })} aria-label="Done" /> {t.title}
              {t.kind === 'plot-hole' && <span className="tag warn">plot hole</span>}
              {t.refs.length > 0 && <div className="muted small">{t.refs.length} linked</div>}
            </li>
          ))}
        </ul>
      </aside>
      <section className="detail">
        {cur ? <TodoDetail key={cur.id} t={cur} /> : <div className="empty">Notes to yourself: things to look up, scenes to fix, and plot holes, the bits of the story that don't add up yet. Link each one to the characters, places or scenes it is about, and it shows on their pages too.</div>}
      </section>
    </div>
  );
}

function TodoDetail({ t }: { t: Todo }) {
  const { store, select, world, go } = useApp();
  // NT-1: made from a margin comment.
  const from = t.comment && world.sceneTexts.find((x) => x.sceneId === t.comment!.sceneId);
  const comment = from && from.comments?.find((c) => c.id === t.comment!.commentId);
  const scene = t.comment && world.scenes.find((s) => s.id === t.comment!.sceneId);
  const set = (p: Partial<Todo>) => store.upsert('todos', { ...t, ...p });
  const remove = async () => {
    if (!(await ask.confirm(`Delete “${t.title}”?`, { okLabel: 'Delete', danger: true }))) return;
    store.removeMany([{ c: 'todos', id: t.id }]);
    select(undefined);
  };
  return (
    <div className="page narrow">
      <div className="page-head">
        <h1>{t.kind === 'plot-hole' ? 'Plot hole' : 'To-do'}</h1>
        <div className="row"><button className="danger" onClick={remove}>Delete</button></div>
      </div>
      {t.comment && (
        <div className="comment-source">
          {comment && from ? (
            <>
              <div className="muted small">From a margin comment in <b>{scene?.title ?? 'a scene'}</b>{comment.resolved ? ' (resolved)' : ''}</div>
              <blockquote>{quoted(commentQuote(from.doc, comment.id) || '…')}</blockquote>
              <div><b>{comment.author || 'Comment'}:</b> {comment.text}</div>
              <button className="small" onClick={() => { requestComment(t.comment!.sceneId, comment.id); go('write', t.comment!.sceneId); }}>Show in the text</button>
            </>
          ) : <div className="muted small">Made from a margin comment that has since been deleted.</div>}
        </div>
      )}
      <div className="form-grid">
        <Field label="What"><input value={t.title} onChange={(e) => set({ title: e.target.value })} /></Field>
        <div className="seg">
          <button className={t.kind === 'todo' ? 'on' : ''} onClick={() => set({ kind: 'todo' })}>To-do</button>
          <button className={t.kind === 'plot-hole' ? 'on' : ''} onClick={() => set({ kind: 'plot-hole' })}>Plot hole</button>
        </div>
        <Field label="Notes"><textarea rows={6} value={t.note} onChange={(e) => set({ note: e.target.value })} /></Field>
        <Field label="About" hint="Linked records show this on their pages.">
          <div className="stack">
            {t.refs.length > 0 && <div className="row wrap">{t.refs.map((r, i) => <RefChip key={r.kind + r.id} r={r} onRemove={() => set({ refs: t.refs.filter((_, k) => k !== i) })} />)}</div>}
            <RefPicker exclude={t.refs} onPick={(r) => set({ refs: [...t.refs, r] })} />
          </div>
        </Field>
        <label className="checkbox"><input type="checkbox" checked={t.done} onChange={(e) => set({ done: e.target.checked })} /> Done</label>
      </div>
    </div>
  );
}
