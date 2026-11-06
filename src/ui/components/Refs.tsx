/** Open any record by kind and id; pick records by typing (EU-14 to-dos); to-dos on a record's page. */
import { useMemo, useState } from 'react';
import { Id, RefKind, Todo, TodoRef, globalSearch, refLabel } from '../../core';
import { recordBase } from '../../storage';
import { useApp } from '../context';

export const REF_LABEL: Record<RefKind, string> = {
  character: 'character', place: 'place', group: 'group', stay: 'stay', journey: 'journey', book: 'book', chapter: 'chapter', scene: 'scene',
  event: 'event', secret: 'secret', region: 'region', thread: 'thread', manuscript: 'manuscript', relationship: 'relationship',
};

export function useOpenRef() {
  const { go, edit, world, openPassage } = useApp();
  return (r: { kind: RefKind; id: Id; paraIndex?: number }) => {
    switch (r.kind) {
      case 'character': return go('characters', r.id);
      case 'place': return go('places', r.id);
      case 'group': return go('groups', r.id);
      case 'event': case 'secret': return go('events', r.id);
      case 'region': return go('layers', r.id);
      case 'book': case 'chapter': case 'scene': case 'thread': return go('story', r.id);
      case 'stay': case 'journey': return edit({ kind: r.kind, id: r.id });
      case 'manuscript': {
        // Jump to the paragraph: the nearest link in it, or just the manuscript.
        const l = r.paraIndex !== undefined ? world.links.find((x) => x.manuscriptId === r.id && x.anchor.paraIndex === r.paraIndex) : undefined;
        return openPassage(r.id, l?.id);
      }
      case 'relationship': {
        const rel = world.relationships.find((x) => x.id === r.id);
        return rel && go('characters', rel.aId);
      }
    }
  };
}

/** Type to find a record to link. */
export function RefPicker({ onPick, placeholder = '+ Link a character, place, scene…', exclude = [] }: { onPick: (r: TodoRef) => void; placeholder?: string; exclude?: TodoRef[] }) {
  const { world } = useApp();
  const [q, setQ] = useState('');
  const hits = useMemo(() => globalSearch(world, q, 30).filter((h) => h.kind !== 'manuscript' && !exclude.some((e) => e.kind === h.kind && e.id === h.id)).slice(0, 8), [world, q, exclude]);
  return (
    <div className="ref-picker">
      <input value={q} placeholder={placeholder} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) { onPick({ kind: hits[0].kind, id: hits[0].id }); setQ(''); } }} />
      {hits.length > 0 && (
        <ul className="ref-hits">
          {hits.map((h) => <li key={h.kind + h.id} onMouseDown={(e) => { e.preventDefault(); onPick({ kind: h.kind, id: h.id }); setQ(''); }}><span>{h.title}</span> <small className="muted">{h.sub}</small></li>)}
        </ul>
      )}
    </div>
  );
}

export function RefChip({ r, onRemove }: { r: TodoRef; onRemove?: () => void }) {
  const { world } = useApp();
  const open = useOpenRef();
  const label = refLabel(world, r.kind, r.id);
  return (
    <span className="chip">
      <button className="link" onClick={() => open(r)} disabled={!label}><span className="muted small">{REF_LABEL[r.kind]}</span> {label ?? '(deleted)'}</button>
      {onRemove && <button className="icon" aria-label="Remove" onClick={onRemove}>×</button>}
    </span>
  );
}

/** EU-14: open to-dos about this record, and a quick way to add one. */
export function TodosFor({ kind, id }: { kind: RefKind; id: Id }) {
  const { world, store, go } = useApp();
  const list = world.todos.filter((t) => t.refs.some((r) => r.kind === kind && r.id === id));
  const [adding, setAdding] = useState('');
  const add = (asHole: boolean) => {
    if (!adding.trim()) return;
    const t: Todo = { ...recordBase(), title: adding.trim(), note: '', kind: asHole ? 'plot-hole' : 'todo', done: false, refs: [{ kind, id }] };
    store.upsert('todos', t);
    setAdding('');
  };
  const open = list.filter((t) => !t.done);
  return (
    <section className="todos-for">
      <h2>To-dos {open.length > 0 && <span className="muted">({open.length})</span>}</h2>
      <ul className="plain">
        {list.map((t) => (
          <li key={t.id} className={t.done ? 'later' : ''}>
            <label className="checkbox"><input type="checkbox" checked={t.done} onChange={(e) => store.upsert('todos', { ...t, done: e.target.checked })} /> {t.kind === 'plot-hole' && <span className="tag warn">plot hole</span>} {t.title}</label>
            <button className="link small" onClick={() => go('todos', t.id)}>open</button>
          </li>
        ))}
      </ul>
      <div className="row">
        <input className="grow" value={adding} placeholder="Something to check or fix here…" onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add(false)} />
        <button className="small" disabled={!adding.trim()} onClick={() => add(false)}>+ To-do</button>
        <button className="small" disabled={!adding.trim()} onClick={() => add(true)} title="Something in the story that doesn't add up">+ Plot hole</button>
      </div>
    </section>
  );
}
