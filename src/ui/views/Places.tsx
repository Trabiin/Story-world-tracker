/** Places (WH-4, MP-5, DM-2): nest physically, positioned in lat/long on the globe. */
import { useMemo, useState } from 'react';
import { ask } from '../components/Dialogs';
import { Place, PlaceKind, formatFuzzy, wrapLng, clampLat } from '../../core';
import { recordBase } from '../../storage';
import { DateInput } from '../components/DateInput';
import { Field } from '../components/Modal';
import { PlaceSelect, placeOptions } from '../components/Pickers';
import { useApp } from '../context';
import { CommaInput } from './Characters';
import { subjectName } from '../util';

export const PLACE_KINDS: PlaceKind[] = ['city', 'town', 'village', 'castle', 'port', 'temple', 'ruin', 'battle-site', 'building', 'room', 'region', 'landmark', 'other', 'unknown'];
export const PLACE_ICON: Record<PlaceKind, string> = { city: '◉', town: '●', village: '•', castle: '♜', port: '⚓', temple: '⛩', ruin: '⌂', 'battle-site': '⚔', building: '▪', room: '▫', region: '◌', landmark: '▲', other: '◆', unknown: '?' };

export function Places() {
  const { world, store, selected, select } = useApp();
  const [q, setQ] = useState('');
  const opts = useMemo(() => placeOptions(world), [world]);
  const filtered = q ? opts.filter((o) => {
    const p = world.places.find((x) => x.id === o.id)!;
    const s = q.toLowerCase();
    return p.name.toLowerCase().includes(s) || p.aliases.some((a) => a.toLowerCase().includes(s));
  }) : opts;
  const current = world.places.find((p) => p.id === selected);
  const add = (parentId?: string) => {
    const p: Place = { ...recordBase(), name: 'New place', aliases: [], kind: parentId ? 'building' : 'city', parentId, notes: '', isPlaceholder: false };
    store.upsert('places', p);
    select(p.id);
  };
  return (
    <div className="master-detail">
      <aside className="master">
        <div className="master-tools">
          <input placeholder="Search places" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="primary" onClick={() => add()}>+ New place</button>
        </div>
        <ul className="list">
          {filtered.map((o) => {
            const p = world.places.find((x) => x.id === o.id)!;
            return (
              <li key={o.id} className={o.id === selected ? 'active' : ''} onClick={() => select(o.id)}>
                <span className="muted">{PLACE_ICON[p.kind]}</span> {q ? p.name : o.label}
                {!p.location && !p.parentId && !p.isPlaceholder && <span className="tag warn" title="No position on the map">no position</span>}
              </li>
            );
          })}
        </ul>
      </aside>
      <section className="detail">{current ? <PlaceDetail key={current.id} p={current} onAddChild={() => add(current.id)} /> : <div className="empty">Select or add a place.</div>}</section>
    </div>
  );
}

function PlaceDetail({ p, onAddChild }: { p: Place; onAddChild: () => void }) {
  const { world, store, ix, go, select, edit, startPick } = useApp();
  const set = (patch: Partial<Place>) => store.upsert('places', { ...p, ...patch });
  const inherited = !p.location ? ix.locationOf(p.id) : undefined;
  const children = world.places.filter((x) => x.parentId === p.id);
  const stays = world.stays.filter((s) => s.placeId === p.id || ix.ancestors(s.placeId).includes(p.id));
  const journeys = world.journeys.filter((j) => j.originId === p.id || j.destinationId === p.id || j.waypointIds.includes(p.id));
  const remove = async () => {
    const direct = world.stays.filter((s) => s.placeId === p.id).length + journeys.length;
    if (direct > 0) {
      void ask.alert(`${p.name} is used by ${direct} stay(s) or journey(s). Move those to another place first.`);
      return;
    }
    if (!(await ask.confirm(`Delete ${p.name}?${children.length ? ` Its ${children.length} sub-place(s) will move up one level.` : ''}`, { okLabel: 'Delete', danger: true }))) return;
    store.update((w) => ({ ...w, places: w.places.filter((x) => x.id !== p.id).map((x) => (x.parentId === p.id ? { ...x, parentId: p.parentId } : x)) }));
    select(undefined);
  };
  return (
    <div className="page">
      <div className="page-head">
        <h1>{PLACE_ICON[p.kind]} {p.name}</h1>
        <div className="row">
          <button onClick={onAddChild}>+ Place inside</button>
          <button onClick={() => edit({ kind: 'stay', preset: { placeId: p.id } })}>+ Stay here</button>
          {p.id !== 'unknown-place' && <button className="danger" onClick={remove}>Delete</button>}
        </div>
      </div>
      <div className="two-col">
        <div className="form-grid">
          <Field label="Name"><input value={p.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Other names" hint="Comma separated"><CommaInput value={p.aliases} onChange={(aliases) => set({ aliases })} /></Field>
          <Field label="Kind">
            <select value={p.kind} onChange={(e) => set({ kind: e.target.value as PlaceKind })}>
              {PLACE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </Field>
          <Field label="Inside" hint="Physical nesting only: room → castle → city. Kingdoms come later as map layers.">
            <PlaceSelect world={world} value={p.parentId} exclude={p.id} allowNone="(top level)" onChange={(parentId) => {
              if (parentId && (parentId === p.id || ix.ancestors(parentId).includes(p.id))) return void ask.alert('A place cannot be inside itself.');
              set({ parentId });
            }} />
          </Field>
          <Field label="Position (latitude, longitude)" hint={inherited ? `Inherited from parent: ${inherited.lat.toFixed(3)}, ${inherited.lng.toFixed(3)}` : 'North and east are positive. Or pick it on the map.'}>
            <div className="row">
              <input type="number" step="0.01" placeholder="lat" style={{ width: 100 }} value={p.location?.lat ?? ''} onChange={(e) => {
                if (e.target.value === '') return set({ location: undefined });
                set({ location: { lat: clampLat(Number(e.target.value)), lng: p.location?.lng ?? 0 } });
              }} />
              <input type="number" step="0.01" placeholder="long" style={{ width: 100 }} value={p.location?.lng ?? ''} onChange={(e) => {
                if (e.target.value === '') return set({ location: undefined });
                set({ location: { lat: p.location?.lat ?? 0, lng: wrapLng(Number(e.target.value)) } });
              }} />
              <button onClick={() => { startPick(p.id); go('map'); }}>Pick on map</button>
              {p.location && <button className="small" onClick={() => set({ location: undefined })}>Clear</button>}
            </div>
          </Field>
          <Field label="Exists from"><DateInput value={p.start} onChange={(start) => set({ start })} placeholder="always" /></Field>
          <Field label="Exists until"><DateInput value={p.end} onChange={(end) => set({ end })} placeholder="still exists" /></Field>
          <label className="checkbox"><input type="checkbox" checked={p.isPlaceholder} onChange={(e) => set({ isPlaceholder: e.target.checked })} /> Placeholder for vague whereabouts (counts as accounted for)</label>
          <Field label="Notes"><textarea rows={6} value={p.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
        </div>
        <div>
          {children.length > 0 && (
            <>
              <h2>Inside {p.name}</h2>
              <ul className="plain">{children.map((c) => <li key={c.id}><button className="link" onClick={() => select(c.id)}>{PLACE_ICON[c.kind]} {c.name}</button></li>)}</ul>
            </>
          )}
          <h2>Who stays here</h2>
          {stays.length === 0 ? <p className="muted">Nobody yet.</p> : (
            <ul className="plain">
              {stays.map((s) => (
                <li key={s.id}>
                  <button className="link" onClick={() => edit({ kind: 'stay', id: s.id })}>
                    {subjectName(world, s.subject)}: {formatFuzzy(s.arrival)} – {s.departure ? formatFuzzy(s.departure) : '…'}
                    {s.placeId !== p.id && <span className="muted"> ({world.places.find((x) => x.id === s.placeId)?.name})</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {journeys.length > 0 && (
            <>
              <h2>Journeys</h2>
              <ul className="plain">
                {journeys.map((j) => (
                  <li key={j.id}><button className="link" onClick={() => edit({ kind: 'journey', id: j.id })}>{subjectName(world, j.subject)}: {formatFuzzy(j.departure)}, {world.places.find((x) => x.id === j.originId)?.name} → {world.places.find((x) => x.id === j.destinationId)?.name}</button></li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
