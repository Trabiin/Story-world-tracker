/** Side-panel card for a selected map feature (river, lake, road, area): name, dates, river and lake options. */
import type { MapFeature } from '../../core';
import { polylineKm } from '../../core';
import { ask } from '../components/Dialogs';
import { DateInput } from '../components/DateInput';
import { useApp } from '../context';
import { KIND_NAME } from './featureRender';

export function FeatureCard({ feature: f, onClose }: { feature: MapFeature; onClose: () => void }) {
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

  const remove = async () => {
    const used = f.placeId
      ? world.stays.filter((s) => s.placeId === f.placeId).length +
        world.journeys.filter((j) => j.originId === f.placeId || j.destinationId === f.placeId || j.waypointIds.includes(f.placeId!)).length
      : 0;
    const msg = used
      ? `Delete ${f.name || 'this feature'}? Its place is used by ${used} stay(s) or journey(s), so the place is kept.`
      : `Delete ${f.name || 'this feature'}?`;
    if (!(await ask.confirm(msg, { okLabel: 'Delete', danger: true }))) return;
    store.update((w) => ({
      ...w,
      mapFeatures: w.mapFeatures
        .filter((x) => x.id !== f.id)
        .map((x) => (x.joinsId === f.id ? { ...x, joinsId: undefined } : x.outletId === f.id ? { ...x, outletId: undefined } : x)),
      places: used || !f.placeId ? w.places : w.places.filter((p) => p.id !== f.placeId),
    }));
    onClose();
  };

  return (
    <div className="card feature-card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3>{KIND_NAME[f.kind] ?? f.kind}</h3>
        <button className="small" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <label className="field"><span className="label">Name</span>
        <input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Unnamed" />
      </label>
      <p className="muted small">
        {f.shape === 'line' ? 'Length' : 'Shoreline'} about {Math.round(km).toLocaleString()} km
        {f.auto ? ' · traced downhill automatically' : ''}
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
        <button className="small danger" onClick={remove}>Delete</button>
      </div>
    </div>
  );
}
