/** WH-6: side card while drawing a journey's route on the map. */
import type { Journey, LatLng } from '../../core';
import { networkFor, pathLengthKm, travelDays } from '../../core';
import { useApp } from '../context';

export function RouteCard({ journey: j, points, follow, onFollow, onUndo, onFinish, onCancel, onClear }: {
  journey: Journey;
  points: LatLng[];
  follow: boolean;
  onFollow: (v: boolean) => void;
  onUndo: () => void;
  onFinish: () => void;
  onCancel: () => void;
  onClear: () => void;
}) {
  const { world, ix } = useApp();
  const km = pathLengthKm(points, world.settings.radiusKm);
  const mode = world.settings.travelModes.find((m) => m.id === j.modeId);
  const who = j.subject.kind === 'character' ? ix.characters.get(j.subject.id)?.name : world.groups.find((g) => g.id === j.subject.id)?.name;
  const net = networkFor(j.modeId);
  return (
    <div className="card">
      <h3>Route: {ix.places.get(j.originId)?.name} → {ix.places.get(j.destinationId)?.name}</h3>
      <p className="muted small">{who} by {mode?.name.toLowerCase() ?? j.modeId}. Click points along the way; the route ends at the destination when you finish.</p>
      <label className="checkbox small">
        <input type="checkbox" checked={follow} disabled={net === 'none'} onChange={(e) => onFollow(e.target.checked)} />{' '}
        {net === 'water' ? 'Follow sea lanes and rivers between clicks' : net === 'land' ? 'Follow roads and trade routes between clicks' : 'Flying goes straight between clicks'}
      </label>
      <p>So far {Math.round(km).toLocaleString()} km{mode && km > 0 ? ` ≈ ${travelDays(km, mode.speedKmPerDay, 1)} day(s)` : ''}.</p>
      <div className="row wrap">
        <button className="small primary" onClick={onFinish}>Finish (Enter)</button>
        <button className="small" disabled={points.length < 2} onClick={onUndo}>Undo (Backspace)</button>
        <button className="small" disabled={points.length < 2} onClick={onClear}>Start over</button>
        <button className="small" onClick={onCancel}>Cancel (Esc)</button>
      </div>
    </div>
  );
}
