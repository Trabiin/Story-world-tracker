/** Side-panel card for a selected map feature (river, lake, road, area): name, dates, river and lake options. */
import type { MapFeature } from '../../core';
import { featureWithDetail, featureWithoutDetail, polylineKm, snapMouths, traceRiver } from '../../core';
import { ask } from '../components/Dialogs';
import { DateInput } from '../components/DateInput';
import { useApp } from '../context';
import { KIND_NAME } from './featureRender';

type Store = ReturnType<typeof useApp>['store'];
type World = ReturnType<typeof useApp>['world'];

/** Delete a feature after asking; its place goes too unless stays or journeys use it. True when deleted. */
export async function deleteFeature(world: World, store: Store, f: MapFeature): Promise<boolean> {
  const used = f.placeId
    ? world.stays.filter((s) => s.placeId === f.placeId).length +
      world.journeys.filter((j) => j.originId === f.placeId || j.destinationId === f.placeId || j.waypointIds.includes(f.placeId!)).length
    : 0;
  const msg = used
    ? `Delete ${f.name || 'this feature'}? Its place is used by ${used} stay(s) or journey(s), so the place is kept.`
    : `Delete ${f.name || 'this feature'}?`;
  if (!(await ask.confirm(msg, { okLabel: 'Delete', danger: true }))) return false;
  store.update((w) => ({
    ...w,
    mapFeatures: w.mapFeatures
      .filter((x) => x.id !== f.id)
      .map((x) => (x.joinsId === f.id ? { ...x, joinsId: undefined } : x.outletId === f.id ? { ...x, outletId: undefined } : x)),
    places: used || !f.placeId ? w.places : w.places.filter((p) => p.id !== f.placeId),
  }));
  return true;
}

export function FeatureCard({ feature: f, onClose, onZoom }: { feature: MapFeature; onClose: () => void; onZoom?: () => void }) {
  const { world, store, go } = useApp();
  const R = world.settings.radiusKm;
  const set = (patch: Partial<MapFeature>) => {
    store.update((w) => ({
      ...w,
      mapFeatures: w.mapFeatures.map((x) => (x.id === f.id ? { ...x, ...patch } : x)),
      // keep the linked place's name and dates in step (MP-8, MP-9)
      places: f.placeId && ('name' in patch || 'start' in patch || 'end' in patch)
        ? w.places.map((p) => (p.id === f.placeId ? {
          ...p,
          ...('name' in patch ? { name: patch.name! } : {}),
          ...('start' in patch ? { start: patch.start } : {}),
          ...('end' in patch ? { end: patch.end } : {}),
        } : p))
        : w.places,
    }));
  };
  const rivers = world.mapFeatures.filter((x) => x.kind === 'river' && x.id !== f.id);
  const km = f.shape === 'line' ? polylineKm(f.points, R) : polylineKm([...f.points, f.points[0]], R);

  const remove = async () => { if (await deleteFeature(world, store, f)) onClose(); };

  return (
    <div className="card feature-card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3>{KIND_NAME[f.kind] ?? f.kind}</h3>
        <div className="row">
          {onZoom && <button className="small" onClick={onZoom} title="Frame it on the map">Zoom to</button>}
          <button className="small" onClick={onClose} aria-label="Close">✕</button>
        </div>
      </div>
      <label className="field"><span className="label">Name</span>
        <input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Unnamed" />
      </label>
      <p className="muted small">
        {f.shape === 'line' ? 'Length' : 'Shoreline'} about {Math.round(km).toLocaleString()} km
        {f.auto ? (f.handEdited ? ' · traced automatically, then reshaped by hand' : ' · traced automatically; follows the land when it changes') : ''}
      </p>
      <p className="muted small">Drag the white squares on the map to reshape it. Shift-click a square to remove that point.</p>
      <label className="field"><span className="label">Exists from <span className="muted">(empty = always)</span></span>
        <DateInput value={f.start} onChange={(start) => set({ start })} />
      </label>
      <label className="field"><span className="label">Exists until</span>
        <DateInput value={f.end} onChange={(end) => set({ end })} />
      </label>
      {f.kind === 'river' && (
        <>
          <label className="field"><span className="label">Flows into</span>
            <select value={f.joinsId ?? ''} onChange={(e) => set({ joinsId: e.target.value || undefined })}>
              <option value="">The sea or a lake (where it ends)</option>
              {rivers.map((r) => <option key={r.id} value={r.id}>{r.name || 'Unnamed river'}</option>)}
            </select>
          </label>
          <label className="checkbox small"><input type="checkbox" checked={!!f.endsInBasin} onChange={(e) => set({ endsInBasin: e.target.checked || undefined })} /> Ends in a dry basin or sinks into the ground (no dead-end warning)</label>
          <label className="field"><span className="label">If another river splits from it</span>
            <select value={f.fork ?? ''} onChange={(e) => set({ fork: (e.target.value || undefined) as MapFeature['fork'] })}>
              <option value="">Warn me (rivers rarely split)</option>
              <option value="delta">It is a delta near the sea</option>
              <option value="intentional">Intentional, don't warn</option>
            </select>
          </label>
          <label className="checkbox small"><input type="checkbox" checked={!!f.spring} onChange={(e) => set({ spring: e.target.checked || undefined })} /> Rises at a spring (a source anywhere is fine)</label>
          <label className="checkbox small"><input type="checkbox" checked={!!f.crossingOk} onChange={(e) => set({ crossingOk: e.target.checked || undefined })} /> Crossing mountains or another river is intended (gorge, aqueduct)</label>
        </>
      )}
      {f.kind === 'lake' && (
        <>
          <label className="checkbox small"><input type="checkbox" checked={!!f.salt} onChange={(e) => set({ salt: e.target.checked || undefined })} /> Salt lake (no outlet needed)</label>
          <label className="field"><span className="label">Outlet river</span>
            <select value={f.outletId ?? ''} onChange={(e) => set({ outletId: e.target.value || undefined })}>
              <option value="">None</option>
              {rivers.map((r) => <option key={r.id} value={r.id}>{r.name || 'Unnamed river'}</option>)}
            </select>
          </label>
        </>
      )}
      <label className="field"><span className="label">Notes</span>
        <textarea rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} />
      </label>
      <div className="row wrap">
        {f.placeId && <button className="small" onClick={() => go('places', f.placeId)}>Open place</button>}
        {f.kind === 'river' && f.auto && (
          <button className="small" title="Find the way downhill again from the same source" onClick={() => {
            const t = traceRiver(world, f.points[0], f.id);
            if (t.points.length < 2) return;
            store.update((w) => ({ ...w, terrain: t.terrain, mapFeatures: w.mapFeatures.map((x) => (x.id === f.id ? { ...x, points: t.points, joinsId: t.joinsId, endsInBasin: t.endsInBasin || undefined, handEdited: undefined } : x)) }));
          }}>Trace again</button>
        )}
        {f.roughPoints
          ? <button className="small" title="MK-21: back to the line as drawn" onClick={() => store.update((w) => ({ ...w, mapFeatures: snapMouths(w.mapFeatures.map((x) => (x.id === f.id ? featureWithoutDetail(x) : x)), R) }))}>Remove detail</button>
          : (f.kind !== 'river' || !f.auto) && f.kind !== 'road' && <button className="small" title="MK-21: give the line natural wiggles; can be removed again" onClick={() => store.update((w) => ({ ...w, mapFeatures: snapMouths(w.mapFeatures.map((x) => (x.id === f.id ? featureWithDetail(x, R) : x)), R) }))}>Add detail</button>}
        <button className="small danger" onClick={remove}>Delete</button>
      </div>
    </div>
  );
}
