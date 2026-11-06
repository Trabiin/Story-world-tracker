/**
 * MK-23: one-click fixes for map warnings. Each fix returns the world as it would be, so the app
 * can preview it on the map before anything changes.
 */
import type { LatLng } from '../globe';
import type { Id, MapFeature, Place, RecordBase, World } from '../model';
import { TerrainReader, hasTerrain } from '../terrain';
import { featureAnchor, traceRiver } from './rivers';
import { densify, type FixKind } from './water';

export const FIX_LABEL: Record<FixKind['kind'], string> = {
  'trace-outlet': 'Add an outlet river at the lowest point of the shore',
  'mark-salt': 'Make it a salt lake (no outlet)',
  'retrace-river': 'Reroute it downhill from its source',
  'mark-basin': 'Mark it as ending in an inland basin',
  'mark-fork': 'Mark the split as intended',
  'mark-spring': 'Mark its source as a spring',
  'mark-crossing': 'Mark the crossing as intended (gorge, aqueduct)',
};

/** Fields every new record needs (id, dates…), made by the app. */
export type NewRecord = () => RecordBase;

const setFeature = (w: World, id: Id, patch: Partial<MapFeature>): World => ({ ...w, mapFeatures: w.mapFeatures.map((f) => (f.id === id ? { ...f, ...patch } : f)) });

/** The lowest point on a lake's shore, where its outlet should leave. */
export function lowestShorePoint(world: World, lake: MapFeature): LatLng | undefined {
  if (!hasTerrain(world.terrain)) return undefined;
  const reader = new TerrainReader(world.terrain);
  const shore = densify([...lake.points, lake.points[0]], Math.max(1, world.terrain.cellDeg * ((Math.PI * world.settings.radiusKm) / 180)), world.settings.radiusKm);
  // The shore cell itself may be inside the lake bed: look a little outside, along the shore.
  let best: { p: LatLng; e: number } | undefined;
  for (const p of shore) {
    const e = reader.elevation(p);
    if (!best || e < best.e) best = { p, e };
  }
  return best?.p;
}

export function applyFix(world: World, fix: FixKind, make: NewRecord): World | null {
  switch (fix.kind) {
    case 'mark-salt': return setFeature(world, fix.lakeId, { salt: true, outletId: undefined });
    case 'mark-basin': return setFeature(world, fix.riverId, { endsInBasin: true });
    case 'mark-fork': return setFeature(world, fix.riverId, { fork: 'intentional' });
    case 'mark-spring': return setFeature(world, fix.riverId, { spring: true });
    case 'mark-crossing': return setFeature(world, fix.riverId, { crossingOk: true });
    case 'retrace-river': {
      const r = world.mapFeatures.find((f) => f.id === fix.riverId);
      if (!r || !hasTerrain(world.terrain)) return null;
      const t = traceRiver(world, r.points[0], r.id);
      if (t.points.length < 2) return null;
      return { ...setFeature(world, r.id, { points: t.points, joinsId: t.joinsId, endsInBasin: t.endsInBasin || undefined, handEdited: undefined, roughPoints: undefined }), terrain: t.terrain };
    }
    case 'trace-outlet': {
      const lake = world.mapFeatures.find((f) => f.id === fix.lakeId);
      if (!lake) return null;
      const src = lowestShorePoint(world, lake);
      if (!src) return null;
      const t = traceRiver(world, src);
      if (t.points.length < 2) return null;
      const base = make();
      const name = lake.name ? `${lake.name} outflow` : 'Outflow';
      const river: MapFeature = { ...base, shape: 'line', kind: 'river', name, points: t.points, auto: true, joinsId: t.joinsId, endsInBasin: t.endsInBasin || undefined, layerId: lake.layerId, notes: '' };
      const place: Place = { ...make(), name, aliases: [], kind: 'river', location: featureAnchor(river), notes: '', isPlaceholder: false };
      river.placeId = place.id;
      const w = setFeature(world, lake.id, { outletId: river.id });
      return { ...w, mapFeatures: [...w.mapFeatures, river], places: [...w.places, place], terrain: t.terrain };
    }
  }
}

/** Features a fix changes or adds, for drawing the preview. */
export function changedFeatures(before: World, after: World): { removed: MapFeature[]; added: MapFeature[] } {
  const old = new Map(before.mapFeatures.map((f) => [f.id, f]));
  const removed: MapFeature[] = [], added: MapFeature[] = [];
  for (const f of after.mapFeatures) {
    const o = old.get(f.id);
    if (!o) added.push(f);
    else if (o.points !== f.points) { removed.push(o); added.push(f); }
  }
  return { removed, added };
}
