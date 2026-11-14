/** EC-1: side card while drawing an eclipse's shadow path on the map. */
import type { EclipseShadow, LatLng, WorldEvent } from '../../core';
import { newShadow, pathLengthKm } from '../../core';
import { useApp } from '../context';

export function EclipseCard({ event: e, points, onUndo, onFinish, onCancel, onClear }: {
  event: WorldEvent;
  points: LatLng[];
  onUndo: () => void;
  onFinish: () => void;
  onCancel: () => void;
  onClear: () => void;
}) {
  const { world, store } = useApp();
  const s = e.shadow ?? newShadow();
  const set = (p: Partial<EclipseShadow>) => store.upsert('events', { ...e, shadow: { ...s, track: s.track, ...p } });
  const km = pathLengthKm(points, world.settings.radiusKm);
  return (
    <div className="card">
      <h3>☀ Shadow path: {e.name}</h3>
      <p className="muted small">Click along the middle of the shadow's daily path, from where it first touches land to where it leaves. The band and the partial zone are drawn around the line as you go.</p>
      <div className="form-grid compact">
        <label className="small">Kind{' '}
          <select value={s.kind} onChange={(x) => set({ kind: x.target.value as EclipseShadow['kind'] })}>
            <option value="annular">Annular (a ring of light)</option>
            <option value="total">Total</option>
          </select>
        </label>
        <label className="small">{s.kind === 'annular' ? 'Annular band' : 'Total band'} width (km){' '}
          <input type="number" min={1} step={10} style={{ width: 90 }} value={s.bandKm} onChange={(x) => set({ bandKm: Math.max(1, Number(x.target.value) || 1) })} />
        </label>
        <label className="small">Partial zone width (km){' '}
          <input type="number" min={1} step={50} style={{ width: 90 }} value={s.partialKm} onChange={(x) => set({ partialKm: Math.max(1, Number(x.target.value) || 1) })} />
        </label>
      </div>
      {s.partialKm < s.bandKm && <p className="small error">The partial zone is narrower than the band, so there is no partial zone.</p>}
      <p>{points.length} {points.length === 1 ? 'point' : 'points'}{points.length > 1 ? ` · ${Math.round(km).toLocaleString()} km long` : ''}</p>
      <div className="row wrap">
        <button className="small primary" disabled={!points.length} onClick={onFinish}>Finish (Enter)</button>
        <button className="small" disabled={!points.length} onClick={onUndo}>Undo (Backspace)</button>
        <button className="small" disabled={!points.length} onClick={onClear}>Start over</button>
        <button className="small" onClick={onCancel}>Cancel (Esc)</button>
      </div>
    </div>
  );
}
