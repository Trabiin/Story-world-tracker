/** EU-20: merge a duplicate into another record, or delete one after seeing what depends on it. */
import { useMemo, useState } from 'react';
import { DataCollection, Id, countText, deleteImpact, deleteRecord, mergeRecords } from '../../core';
import { Modal } from './Modal';
import { useApp } from '../context';

type Mergeable = 'characters' | 'places' | 'groups' | 'events';

const options = (world: ReturnType<typeof useApp>['world'], c: Mergeable, not: Id) =>
  (world[c] as unknown as { id: Id; name: string; isPlaceholder?: boolean }[]).filter((r) => r.id !== not && !r.isPlaceholder).sort((a, b) => a.name.localeCompare(b.name));

const summary = (list: { collection: DataCollection }[]) => {
  const by = new Map<DataCollection, number>();
  for (const d of list) by.set(d.collection, (by.get(d.collection) ?? 0) + 1);
  return [...by].map(([c, n]) => countText(n, c)).join(', ');
};

/** EU-20: fold this record into another. */
export function MergeDialog({ collection, id, onClose, onDone }: { collection: Mergeable; id: Id; onClose: () => void; onDone: (keepId: Id) => void }) {
  const { world, store } = useApp();
  const me = (world[collection] as unknown as { id: Id; name: string }[]).find((r) => r.id === id)!;
  const [into, setInto] = useState<Id>('');
  const moving = useMemo(() => { const i = deleteImpact(world, collection, id); return [...i.goes, ...i.unlinked]; }, [world, collection, id]);
  const target = (world[collection] as unknown as { id: Id; name: string }[]).find((r) => r.id === into);
  const merge = () => { store.update((w) => mergeRecords(w, collection, into, id)); onDone(into); };
  return (
    <Modal title={`Merge ${me.name} into…`} onClose={onClose} footer={<><span className="spacer" /><button onClick={onClose}>Cancel</button><button className="primary" disabled={!into} onClick={merge}>Merge</button></>}>
      <p>For a record made twice by mistake. Everything that refers to {me.name} moves to the one you choose, and “{me.name}” becomes one of its aliases. You can undo this.</p>
      <select value={into} onChange={(e) => setInto(e.target.value)} autoFocus>
        <option value="">Choose who or what to keep…</option>
        {options(world, collection, id).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      {target && <p className="muted">{moving.length ? `Moves to ${target.name}: ${summary(moving)}.` : `Nothing refers to ${me.name}, so only the name is kept as an alias.`} Notes and tags are combined; dates and positions {target.name} lacks are taken from {me.name}.</p>}
    </Modal>
  );
}

/** EU-20: delete, showing what depends on the record, with the choice to hand it all to another record. */
export function DeleteDialog({ collection, id, onClose, onDone, extra }: { collection: Mergeable; id: Id; onClose: () => void; onDone: () => void; extra?: string }) {
  const { world, store } = useApp();
  const me = (world[collection] as unknown as { id: Id; name: string }[]).find((r) => r.id === id)!;
  const impact = useMemo(() => deleteImpact(world, collection, id), [world, collection, id]);
  const [mode, setMode] = useState<'remove' | 'reassign'>('remove');
  const [to, setTo] = useState<Id>('');
  const nothing = !impact.goes.length && !impact.unlinked.length;
  const run = () => {
    store.update((w) => deleteRecord(w, collection, id, mode === 'reassign' ? { kind: 'reassign', to } : { kind: 'remove' }));
    onDone();
  };
  const show = (list: typeof impact.goes) => (
    <ul className="plain dep-list">{list.slice(0, 8).map((d) => <li key={d.collection + d.id}><span className="muted small">{countText(1, d.collection).replace(/^1 /, '')}</span> {d.label}</li>)}{list.length > 8 && <li className="muted">and {list.length - 8} more</li>}</ul>
  );
  return (
    <Modal title={`Delete ${me.name}?`} onClose={onClose} footer={<><span className="spacer" /><button onClick={onClose}>Cancel</button><button className="primary danger-bg" disabled={mode === 'reassign' && !to} onClick={run}>{mode === 'reassign' ? 'Move and delete' : 'Delete'}</button></>}>
      {extra && <p className="muted">{extra}</p>}
      {nothing ? <p>Nothing else refers to {me.name}. You can undo this.</p> : (
        <>
          {impact.goes.length > 0 && <><p><b>Depends on {me.name}</b> ({summary(impact.goes)}):</p>{show(impact.goes)}</>}
          {impact.unlinked.length > 0 && <><p><b>Mentions {me.name}</b> ({summary(impact.unlinked)}):</p>{show(impact.unlinked)}</>}
          <div className="stack">
            <label className="checkbox"><input type="radio" checked={mode === 'remove'} onChange={() => setMode('remove')} /> Delete what depends on it, and take it out of the rest{collection === 'places' ? ' (places inside move up a level)' : ''}</label>
            <label className="checkbox"><input type="radio" checked={mode === 'reassign'} onChange={() => setMode('reassign')} /> Hand all of it to another {collection.slice(0, -1)} first:</label>
            {mode === 'reassign' && (
              <select value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">Choose…</option>
                {options(world, collection, id).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            )}
          </div>
          <p className="muted small">You can undo this.</p>
        </>
      )}
    </Modal>
  );
}
