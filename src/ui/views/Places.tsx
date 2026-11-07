/** Places (WH-4, MP-5, DM-2): nest physically, positioned in lat/long on the globe. */
import { useMemo, useState } from 'react';
import { ask } from '../components/Dialogs';
import { RevealField } from '../components/RevealField';
import { LayerIndex, OPEN_END, TerrainReader, hasTerrain, localSeasons, Place, PlaceKind, PlaceVisit, formatDayNumber, formatFuzzy, placeVisits, wrapLng, clampLat } from '../../core';
import { recordBase } from '../../storage';
import { DateInput } from '../components/DateInput';
import { Field } from '../components/Modal';
import { PlaceSelect, placeOptions } from '../components/Pickers';
import { useApp } from '../context';
import { TodosFor } from '../components/Refs';
import { Research } from '../components/Research';
import { Pictures } from '../components/Pictures';
import { DeleteDialog, MergeDialog } from '../components/RecordTools';
import { CommaInput } from './Characters';
import { Backlinks } from '../components/Backlinks';
import { subjectName } from '../util';
import { RenameButton } from '../components/Rename';

export const PLACE_KINDS: PlaceKind[] = ['capital', 'city', 'town', 'village', 'castle', 'port', 'temple', 'ruin', 'battle-site', 'building', 'room', 'region', 'landmark', 'river', 'lake', 'road', 'area', 'other', 'unknown'];
export const PLACE_ICON: Record<PlaceKind, string> = { city: '◉', town: '●', village: '•', castle: '♜', port: '⚓', temple: '⛩', ruin: '⌂', 'battle-site': '⚔', building: '▪', room: '▫', region: '◌', landmark: '▲', other: '◆', unknown: '?', capital: '✪', river: '〰', lake: '◍', road: '═', area: '▧' };

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
  const journeys = world.journeys.filter((j) => j.originId === p.id || j.destinationId === p.id || j.waypointIds.includes(p.id));
  const [dialog, setDialog] = useState<'delete' | 'merge' | null>(null);
  return (
    <div className="page">
      <div className="page-head">
        <h1>{PLACE_ICON[p.kind]} {p.name}</h1>
        <div className="row">
          <button onClick={onAddChild}>+ Place inside</button>
          <button onClick={() => edit({ kind: 'stay', preset: { placeId: p.id } })}>+ Stay here</button>
          {p.id !== 'unknown-place' && !p.isPlaceholder && <button onClick={() => setDialog('merge')} title="EU-20: for a place made twice">Merge into…</button>}
          {p.id !== 'unknown-place' && <button className="danger" onClick={() => setDialog('delete')}>Delete</button>}
        </div>
      </div>
      {dialog === 'delete' && <DeleteDialog collection="places" id={p.id} onClose={() => setDialog(null)} onDone={() => select(undefined)} />}
      {dialog === 'merge' && <MergeDialog collection="places" id={p.id} onClose={() => setDialog(null)} onDone={(keep) => select(keep)} />}
      <div className="two-col">
        <div className="form-grid">
          <Field label="Name"><input value={p.name} onChange={(e) => set({ name: e.target.value })} /><RenameButton kind="place" id={p.id} /></Field>
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
          <RevealField value={p.revealedIn} onChange={(revealedIn) => set({ revealedIn })} />
        </div>
        <div>
          <RealmHistory p={p} />
          <SeasonsHere p={p} />
          {children.length > 0 && (
            <>
              <h2>Inside {p.name}</h2>
              <ul className="plain">{children.map((c) => <li key={c.id}><button className="link" onClick={() => select(c.id)}>{PLACE_ICON[c.kind]} {c.name}</button></li>)}</ul>
            </>
          )}
          <WhoWasHere p={p} />
          <Backlinks kind="place" id={p.id} title="Manuscript and scenes" only={['passage', 'scene']} />
          <TodosFor kind="place" id={p.id} />
          <Research kind="place" id={p.id} />
          <Pictures value={p.images} onChange={(images) => set({ images })} />
        </div>
      </div>
    </div>
  );
}

/** LY-12, LY-9: a place's realm over time, worked out from the Political layer, and every region covering it now. */
function RealmHistory({ p }: { p: Place }) {
  const { world, ix, moment, go } = useApp();
  const lix = useMemo(() => new LayerIndex(world), [world]);
  const loc = ix.locationOf(p.id);
  const history = useMemo(() => (loc ? lix.realmHistory(loc) : []), [lix, loc]);
  const here = useMemo(() => (loc ? lix.regionsAt(loc, moment) : []), [lix, loc, moment]);
  if (!loc || p.isPlaceholder || (!history.length && !here.length)) return null;
  const name = (chain: { region: { id: string; name: string } }[]) => (
    <>
      <button className="link" onClick={() => go('layers', chain[chain.length - 1].region.id)}>{chain[chain.length - 1].region.name}</button>
      {chain.length > 1 && <span className="muted"> ({chain.slice(0, -1).map((c) => c.region.name).join(', ')})</span>}
    </>
  );
  return (
    <>
      <h2>Realm</h2>
      {history.length === 0 ? <p className="muted">Not inside any realm on the Political layer.</p> : (
        <ul className="plain realm-history">
          {history.map((h) => (
            <li key={h.key + (h.startDay ?? '')}>
              {name(h.chain)}
              <span className="muted"> · {h.startLabel ?? 'from the beginning'} – {h.endLabel ?? 'now'}</span>
            </li>
          ))}
        </ul>
      )}
      {here.length > 0 && (
        <p className="small">
          <span className="muted">On this date: </span>
          {here.map((x, i) => <span key={x.layer.id}>{i > 0 && ' · '}{x.hits.map((h) => `${h.region.name}${h.intensity < 100 ? ` ${h.intensity}%` : ''}`).join(' + ')}</span>)}
        </p>
      )}
    </>
  );
}

const VISIT_WORD: Record<PlaceVisit['kind'], string> = { stay: 'stays', arrives: 'arrives', departs: 'leaves', passes: 'passes through' };

/** VW-4: everyone who was here (or anywhere inside), over time, with the current moment marked. */
function WhoWasHere({ p }: { p: Place }) {
  const { world, ix, moment, edit, go } = useApp();
  const visits = useMemo(() => placeVisits(ix, p.id), [ix, p.id]);
  if (!visits.length) return <><h2>Who was here</h2><p className="muted">Nobody yet.</p></>;
  const who = [...new Set(visits.map((v) => v.subject.id))];
  const finite = visits.flatMap((v) => [v.start, v.end]).filter((n) => n !== OPEN_END);
  const lo = Math.min(...finite, moment);
  const hi = Math.max(...finite, moment, lo + 1);
  const W = 520, L = 110, R = 10, rowH = 20, top = 6;
  const x = (d: number) => L + ((Math.min(d, hi) - lo) / (hi - lo)) * (W - L - R);
  const H = top + who.length * rowH + 18;
  const char = (id: string) => ix.characters.get(id);
  const open = (v: PlaceVisit) => edit({ kind: v.kind === 'stay' ? 'stay' : 'journey', id: v.recordId });
  return (
    <>
      <h2>Who was here</h2>
      <svg className="visit-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Who was at ${p.name} over time`}>
        {who.map((id, r) => {
          const c = char(id);
          const y = top + r * rowH;
          return (
            <g key={id}>
              <text x={0} y={y + 13} style={{ cursor: 'pointer' }} onClick={() => go('characters', id)}>{(c?.name ?? '?').slice(0, 16)}</text>
              <line x1={L} x2={W - R} y1={y + 9} y2={y + 9} stroke="var(--line)" />
              {visits.filter((v) => v.subject.id === id).map((v, n) => v.kind === 'stay'
                ? <rect key={n} x={x(v.start)} y={y + 3} width={Math.max(3, x(v.end === OPEN_END ? hi : v.end) - x(v.start))} height={12} rx={3} fill={c?.color ?? '#888'} opacity={v.viaGroupId ? 0.55 : 0.9} style={{ cursor: 'pointer' }} onClick={() => open(v)}><title>{`${c?.name} ${VISIT_WORD[v.kind]} ${formatDayNumber(v.start)} – ${v.end === OPEN_END ? '…' : formatDayNumber(v.end)}`}</title></rect>
                : <path key={n} d={`M${x(v.start)} ${y + 2} l4 7 l-4 7 l-4 -7 z`} fill="var(--bg)" stroke={c?.color ?? '#888'} strokeWidth={1.5} style={{ cursor: 'pointer' }} onClick={() => open(v)}><title>{`${c?.name} ${VISIT_WORD[v.kind]} ${formatDayNumber(v.start)}`}</title></path>)}
            </g>
          );
        })}
        <line x1={x(moment)} x2={x(moment)} y1={0} y2={H - 16} stroke="var(--accent)" strokeWidth={1.5} />
        <text x={L} y={H - 3}>{formatDayNumber(lo)}</text>
        <text x={W - R} y={H - 3} textAnchor="end">{formatDayNumber(hi)}</text>
      </svg>
      <ul className="visit-list">
        {visits.map((v, n) => {
          const now = v.start <= moment && moment <= (v.end === OPEN_END ? Infinity : v.end);
          const group = v.viaGroupId ? world.groups.find((g) => g.id === v.viaGroupId)?.name : undefined;
          return (
            <li key={n} className={now && v.kind === 'stay' ? 'now' : ''} onClick={() => open(v)}>
              <span className="when">{formatDayNumber(v.start)}{v.kind === 'stay' && <> – {v.end === OPEN_END ? '…' : formatDayNumber(v.end)}</>}</span>{' '}
              <b style={{ color: char(v.subject.id)?.color }}>{char(v.subject.id)?.name}</b> {VISIT_WORD[v.kind]}
              {v.placeId !== p.id && <> at {world.places.find((x2) => x2.id === v.placeId)?.name}</>}
              {group && <span className="tag">with {group}</span>}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** RC-10: how long winter and summer last here, from latitude, height and the axial tilt. */
function SeasonsHere({ p }: { p: Place }) {
  const { world, ix } = useApp();
  const at = ix.locationOf(p.id);
  const info = useMemo(() => {
    if (!at) return undefined;
    const elev = hasTerrain(world.terrain) ? Math.max(0, new TerrainReader(world.terrain).elevation(at)) : 0;
    return { elev, s: localSeasons(at.lat, elev, world.settings.axialTiltDeg) };
  }, [at, world.terrain, world.settings.axialTiltDeg]);
  if (!info) return null;
  return (
    <>
      <h2>Seasons here</h2>
      <p>{info.s.text}</p>
      <p className="muted small">About {Math.round(info.s.meanC)} °C on average, {Math.round(info.s.meanC - info.s.swingC)} °C in midwinter and {Math.round(info.s.meanC + info.s.swingC)} °C in midsummer{info.elev ? `, at ${Math.round(info.elev).toLocaleString()} m` : ''}.</p>
    </>
  );
}
