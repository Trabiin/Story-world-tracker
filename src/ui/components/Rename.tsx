/**
 * RV-1: rename everywhere. The new name, then every mention it would change in every book (scene text,
 * scene and chapter titles, summaries and notes), each one ticked; untick any that mean something else.
 */
import { useMemo, useState } from 'react';
import { Id, RenameKind, RenameMention, findMentions, planReplace, recordName, renameFields, renameRecord } from '../../core';
import { useApp } from '../context';
import { applyTextChanges } from '../revise/actions';
import { useOpenRef } from './Refs';

export function RenameEverywhere({ target, onDone, onCancel }: { target: { kind: RenameKind; id: Id }; onDone?: (msg: string) => void; onCancel?: () => void }) {
  const { world, store } = useApp();
  const openRef = useOpenRef();
  const oldName = recordName(world, target.kind, target.id) ?? '';
  const [name, setName] = useState(oldName);
  const [keepAlias, setKeepAlias] = useState(false);
  const [off, setOff] = useState<Set<string>>(new Set());
  const mentions = useMemo(() => (name.trim() && name.trim() !== oldName ? findMentions(world, target, name.trim()) : []), [world, target.kind, target.id, name, oldName]); // eslint-disable-line react-hooks/exhaustive-deps
  // Words shared with other names start unticked.
  const isOff = (m: RenameMention) => (off.has(m.key) ? true : !!m.shared && !off.has(`on:${m.key}`));
  const toggle = (m: RenameMention) => {
    const next = new Set(off);
    if (m.shared) { if (next.has(`on:${m.key}`)) next.delete(`on:${m.key}`); else next.add(`on:${m.key}`); }
    else if (next.has(m.key)) next.delete(m.key); else next.add(m.key);
    setOff(next);
  };
  const chosen = mentions.filter((m) => !isOff(m));
  const aliasable = target.kind === 'character' || target.kind === 'place';
  const sceneTitle = (id: Id) => world.scenes.find((s) => s.id === id)?.title ?? '?';

  const apply = async () => {
    const newName = name.trim();
    if (!newName || newName === oldName) return;
    const changes = planReplace(store.world, chosen.flatMap((m) => (m.where.kind === 'text' ? [{ ...m.where.hit, text: m.to }] : [])));
    // The record and the fields are one undo step; the text keeps "Before renaming" versions.
    store.update((w) => renameFields(renameRecord(w, target, newName, keepAlias && aliasable), chosen), true);
    if (changes.length) await applyTextChanges(store, changes, `renaming ${oldName} to ${newName}`);
    onDone?.(`Renamed ${oldName} to ${newName}: ${chosen.length} mention${chosen.length === 1 ? '' : 's'} changed${changes.length ? ` in ${changes.length} scene${changes.length === 1 ? '' : 's'} (each keeps a version from before)` : ''}.`);
  };

  return (
    <div className="rename-box">
      <div className="row">
        <label className="grow"><span>New name for <b>{oldName}</b></span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') onCancel?.(); }} />
        </label>
        {aliasable && <label className="checkbox small" title="So name spotting and @ links still know the old name"><input type="checkbox" checked={keepAlias} onChange={(e) => setKeepAlias(e.target.checked)} /> Keep “{oldName}” as an alias</label>}
      </div>
      {name.trim() && name.trim() !== oldName && (
        <>
          <p className="muted small">{mentions.length ? `${mentions.length} mention${mentions.length === 1 ? '' : 's'} found. Untick any that are about something else.` : 'No mentions in the text, titles or notes: only the record is renamed.'}</p>
          <ul className="rename-list">
            {mentions.map((m) => (
              <li key={m.key} className={isOff(m) ? 'off' : ''}>
                <label className="checkbox">
                  <input type="checkbox" checked={!isOff(m)} onChange={() => toggle(m)} />
                  <span className="where">{m.where.kind === 'text' ? <button className="link" onClick={(e) => { e.preventDefault(); openRef({ kind: 'scene', id: (m.where as { hit: { sceneId: Id } }).hit.sceneId }); }}>{sceneTitle(m.where.hit.sceneId)}</button> : m.where.label}</span>
                  <span className="ctx">
                    {m.where.kind === 'text' ? m.where.hit.before : m.where.before}
                    <del className="diff-del">{m.from}</del><ins className="diff-ins">{m.to}</ins>
                    {m.where.kind === 'text' ? m.where.hit.after : m.where.after}
                  </span>
                </label>
                {m.shared && <span className="muted small"> “{m.from}” is also in {m.shared}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="row">
        <button className="primary" disabled={!name.trim() || name.trim() === oldName || store.readOnly} onClick={() => void apply()}>Rename{chosen.length ? ` and change ${chosen.length}` : ''}</button>
        {onCancel && <button onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}

/** A small "Rename everywhere" button for record pages, opening the box in a dialog. */
export function RenameButton({ kind, id }: { kind: RenameKind; id: Id }) {
  const { store } = useApp();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState('');
  if (store.readOnly) return null;
  return (
    <>
      <button className="link small" onClick={() => { setOpen(true); setMsg(''); }} title="RV-1: rename and change every mention in every book, with a preview">Rename everywhere…</button>
      {msg && <span className="muted small"> {msg}</span>}
      {open && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="modal rename-modal" role="dialog" aria-label="Rename everywhere">
            <header><h2>Rename everywhere</h2><button className="icon" onClick={() => setOpen(false)} aria-label="Close">×</button></header>
            <RenameEverywhere target={{ kind, id }} onCancel={() => setOpen(false)} onDone={(m) => { setOpen(false); setMsg(m); }} />
          </div>
        </div>
      )}
    </>
  );
}
