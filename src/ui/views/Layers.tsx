/**
 * Realms and layers (LY-1, LY-2, LY-6, LY-10): every region with its encyclopedia entry, its place in the
 * realm hierarchy over time (duchy → kingdom → empire, vassals), characters tied to it and its border history.
 */
import { useMemo, useState } from 'react';
import { FuzzyDate, Id, LAYER_TYPES, LayerIndex, Region, RegionOverlord, RegionTie, areaContains, describeChain, formatDayNumber, formatFuzzy, labelPoint, toWindow } from '../../core';
import { newId } from '../../storage';
import { ask } from '../components/Dialogs';
import { DateInput } from '../components/DateInput';
import { Field } from '../components/Modal';
import { useApp } from '../context';
import { BorderHistory, RegionLayerList, sortedLayers } from '../map/RegionsPanel';
import { PLACE_ICON } from './Places';

const ROLES = ['ruler', 'heir', 'regent', 'founder', 'high priest', 'prophet', 'general', 'governor', 'member'];

const span = (s: { start?: FuzzyDate; end?: FuzzyDate }) => (s.start || s.end ? `${s.start ? formatFuzzy(s.start) : '…'} – ${s.end ? formatFuzzy(s.end) : '…'}` : 'always');

export function Layers() {
  const { world, selected, select } = useApp();
  const [q, setQ] = useState('');
  const ix = useMemo(() => new LayerIndex(world), [world]);
  const current = world.regions.find((r) => r.id === selected);
  return (
    <div className="master-detail">
      <aside className="master">
        <div className="master-tools">
          <input placeholder="Search realms and regions" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <ul className="list">
          {sortedLayers(world.regionLayers).map((l) => {
            const regions = ix.regionsOf(l.id).filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()));
            return (
              <li key={l.id} className="list-group" onClick={(e) => e.stopPropagation()}>
                <h4 className="list-heading">{l.name}</h4>
                {regions.length === 0 && <div className="muted small" style={{ padding: '0 12px' }}>{q ? 'No match' : 'None yet: draw them on the map (▦ Layers)'}</div>}
                <ul className="list">
                  {regions.map((r) => (
                    <li key={r.id} className={r.id === selected ? 'active' : ''} onClick={() => select(r.id)}>
                      <span className="sw" style={{ background: r.color }} /> {r.name}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      </aside>
      <section className="detail">
        {current ? <RegionPage key={current.id} r={current} ix={ix} /> : (
          <div className="page">
            <h1>Realms and layers</h1>
            <p className="muted">Kingdoms, cultures, religions, languages and any other regions, with borders that change over time. Draw and change them on the map with <b>▦ Layers</b>; a place's realm on any date is worked out from the Political layer.</p>
            <div style={{ maxWidth: 420 }}><RegionLayerList editing={false} /></div>
          </div>
        )}
      </section>
    </div>
  );
}

function RegionPage({ r, ix }: { r: Region; ix: LayerIndex }) {
  const { world, store, moment, select, showOnMap, go } = useApp();
  const set = (patch: Partial<Region>) => store.upsert('regions', { ...r, ...patch });
  const layer = ix.layer(r.layerId);
  const political = layer?.type === 'political';
  const chain = ix.chain(r.id, moment);
  const win = (d: FuzzyDate) => toWindow(d, world.settings.hemisphereForSeasons);
  const members = world.regions.filter((x) => x.overlords.some((o) => o.regionId === r.id));
  const now = ix.versionAt(r, moment);
  const placesInside = now ? world.places.filter((p) => !p.isPlaceholder && p.location && !['river', 'lake', 'road', 'area'].includes(p.kind) && areaContains(now.area, p.location)) : [];
  const setOverlord = (o: RegionOverlord, patch: Partial<RegionOverlord>) => set({ overlords: r.overlords.map((x) => (x.id === o.id ? { ...x, ...patch } : x)) });
  const setTie = (t: RegionTie, patch: Partial<RegionTie>) => set({ ties: r.ties.map((x) => (x.id === t.id ? { ...x, ...patch } : x)) });
  const setVersion = (id: Id, patch: Partial<Region['versions'][number]>) => {
    const vs = r.versions.map((v) => (v.id === id ? { ...v, ...patch } : v));
    vs.sort((a, b) => (a.start ? win(a.start).earliest : -Infinity) - (b.start ? win(b.start).earliest : -Infinity));
    set({ versions: vs });
  };
  const remove = async () => {
    if (!(await ask.confirm(`Delete ${r.name} with its whole border history?`, { okLabel: 'Delete', danger: true }))) return;
    store.update((w) => ({
      ...w,
      regions: w.regions.filter((x) => x.id !== r.id).map((x) => (x.overlords.some((o) => o.regionId === r.id) ? { ...x, overlords: x.overlords.filter((o) => o.regionId !== r.id) } : x)),
    }));
    select(undefined);
  };
  const lp = (r.versions.find((v) => v === now) ?? r.versions.find((v) => v.area.length))?.area;
  const others = world.regions.filter((x) => x.id !== r.id && x.layerId === r.layerId);
  const characters = [...world.characters].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="page">
      <div className="page-head">
        <h1><span className="sw big" style={{ background: r.color }} /> {r.name}</h1>
        <div className="row">
          {lp && <button onClick={() => { const at = labelPoint(lp)?.at; if (at) showOnMap(at); }}>Show on map</button>}
          <button className="danger" onClick={remove}>Delete</button>
        </div>
      </div>
      <p className="muted">{layer?.name}{chain.length > 1 && ` · ${describeChain(chain)}`} · on {formatDayNumber(moment)}</p>
      <div className="two-col">
        <div className="form-grid">
          <Field label="Name"><input value={r.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Layer">
            <select value={r.layerId} onChange={(e) => set({ layerId: e.target.value, overlords: [] })}>
              {sortedLayers(world.regionLayers).map((l) => <option key={l.id} value={l.id}>{l.name} ({LAYER_TYPES[l.type].name})</option>)}
            </select>
          </Field>
          <Field label="Colour"><input type="color" value={r.color} onChange={(e) => set({ color: e.target.value })} /></Field>
          <Field label="Exists from" hint="Founded, or first known"><DateInput value={r.start} onChange={(start) => set({ start })} placeholder="always" /></Field>
          <Field label="Exists until" hint="Fell, merged or died out"><DateInput value={r.end} onChange={(end) => set({ end })} placeholder="still exists" /></Field>
          <Field label={political ? 'Encyclopedia: rulers, laws, history' : 'Encyclopedia: tenets, customs, history'}>
            <textarea rows={10} value={r.entry} onChange={(e) => set({ entry: e.target.value })} placeholder={political ? 'Founded by … The crown passes to …' : 'Believers hold that …'} />
          </Field>
        </div>
        <div>
          {political && (
            <>
              <div className="section-head">
                <h2>Part of / vassal of</h2>
                <button className="small" disabled={!others.length} onClick={() => set({ overlords: [...r.overlords, { id: newId(), regionId: others[0].id, relation: 'part' }] })}>+ Add</button>
              </div>
              <p className="muted small">A duchy inside a kingdom, or a vassal of an empire. Give dates when it changes hands; the realm of every place inside follows.</p>
              {r.overlords.length === 0 && <p className="muted">Independent.</p>}
              {r.overlords.map((o) => (
                <div key={o.id} className="card tight">
                  <div className="row wrap">
                    <select value={o.relation} onChange={(e) => setOverlord(o, { relation: e.target.value as RegionOverlord['relation'] })}>
                      <option value="part">Part of</option>
                      <option value="vassal">Vassal of</option>
                    </select>
                    <select value={o.regionId} onChange={(e) => setOverlord(o, { regionId: e.target.value })}>
                      {others.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                    </select>
                    <button className="icon" title="Remove" onClick={() => set({ overlords: r.overlords.filter((x) => x.id !== o.id) })}>×</button>
                  </div>
                  <div className="row wrap small">
                    <span>from</span><DateInput value={o.start} onChange={(start) => setOverlord(o, { start })} placeholder="always" />
                    <span>until</span><DateInput value={o.end} onChange={(end) => setOverlord(o, { end })} placeholder="still" />
                  </div>
                </div>
              ))}
              {members.length > 0 && (
                <>
                  <h2>Duchies and vassals</h2>
                  <ul className="plain">
                    {members.map((m) => m.overlords.filter((o) => o.regionId === r.id).map((o) => (
                      <li key={o.id}><button className="link" onClick={() => select(m.id)}>{m.name}</button> <span className="muted">· {o.relation === 'vassal' ? 'vassal' : 'part'} · {span(o)}</span></li>
                    )))}
                  </ul>
                </>
              )}
            </>
          )}
          <div className="section-head">
            <h2>{political ? 'Rulers and people' : 'People'}</h2>
            <button className="small" disabled={!characters.length} onClick={() => set({ ties: [...r.ties, { id: newId(), characterId: characters[0].id, role: political ? 'ruler' : 'member' }] })}>+ Tie a character</button>
          </div>
          {r.ties.length === 0 && <p className="muted">Nobody tied to it yet.</p>}
          {r.ties.map((t) => (
            <div key={t.id} className="card tight">
              <div className="row wrap">
                <select value={t.characterId} onChange={(e) => setTie(t, { characterId: e.target.value })}>
                  {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <input list="region-roles" value={t.role} onChange={(e) => setTie(t, { role: e.target.value })} style={{ width: 120 }} aria-label="Role" />
                <button className="link small" onClick={() => go('characters', t.characterId)}>open</button>
                <button className="icon" title="Remove" onClick={() => set({ ties: r.ties.filter((x) => x.id !== t.id) })}>×</button>
              </div>
              <div className="row wrap small">
                <span>from</span><DateInput value={t.start} onChange={(start) => setTie(t, { start })} placeholder="always" />
                <span>until</span><DateInput value={t.end} onChange={(end) => setTie(t, { end })} placeholder="still" />
              </div>
            </div>
          ))}
          <datalist id="region-roles">{ROLES.map((x) => <option key={x} value={x} />)}</datalist>
          <h2>Border history</h2>
          <BorderHistory region={r} current={ix.versionIndexAt(r, moment)} />
          {r.versions.length > 0 && (
            <details>
              <summary className="small muted">Edit dates and notes</summary>
              {r.versions.map((v, i) => (
                <div key={v.id} className="card tight">
                  <div className="row wrap small">
                    <span>From</span>
                    <DateInput value={v.start} onChange={(start) => setVersion(v.id, { start })} placeholder={i === 0 ? 'the beginning' : 'date needed'} allowEmpty={i === 0} />
                    {i > 0 && <button className="icon" title="Remove this change" onClick={() => set({ versions: r.versions.filter((x) => x.id !== v.id) })}>×</button>}
                  </div>
                  <input value={v.note ?? ''} placeholder="What happened" onChange={(e) => setVersion(v.id, { note: e.target.value || undefined })} />
                </div>
              ))}
            </details>
          )}
          {placesInside.length > 0 && (
            <>
              <h2>Places inside now</h2>
              <ul className="plain">{placesInside.map((p) => <li key={p.id}><button className="link" onClick={() => go('places', p.id)}>{PLACE_ICON[p.kind]} {p.name}</button></li>)}</ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
