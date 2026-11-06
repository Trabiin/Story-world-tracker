/**
 * More realism checks on drawn water and settlements:
 * RC-4 a lake drains through one outlet (unless it is a salt lake),
 * RC-5 rivers don't cross mountain ridges or each other,
 * RC-6 river sources sit somewhere plausible,
 * RC-11 large towns and cities lie near a river, lake or coast.
 */
import { greatCircleKm, type LatLng } from '../globe';
import type { Id, MapFeature, Place, World } from '../model';
import { TerrainReader, hasTerrain } from '../terrain';
import { connectKm, insideArea, nearestOnPolyline } from './rivers';

export type WaterRule = 'lake-outlet' | 'river-crossing' | 'river-source' | 'settlement-water';

export interface WaterIssue {
  rule: WaterRule;
  key: string;
  message: string;
  at: LatLng;
  featureId?: Id;
  placeId?: Id;
  /** MK-23: what a one-click fix would do. */
  fix?: FixKind;
}

export type FixKind =
  | { kind: 'trace-outlet'; lakeId: Id }
  | { kind: 'mark-salt'; lakeId: Id }
  | { kind: 'retrace-river'; riverId: Id }
  | { kind: 'mark-basin'; riverId: Id }
  | { kind: 'mark-fork'; riverId: Id }
  | { kind: 'mark-spring'; riverId: Id }
  | { kind: 'mark-crossing'; riverId: Id };

const where = (p: LatLng) => `${Math.abs(p.lat).toFixed(1)}°${p.lat >= 0 ? 'N' : 'S'}, ${Math.abs(p.lng).toFixed(1)}°${p.lng >= 0 ? 'E' : 'W'}`;
const ring = (pts: LatLng[]) => [...pts, pts[0]];
const nameOf = (f: MapFeature, what = 'river') => f.name || `An unnamed ${what}`;

/** Points along a line no more than `stepKm` apart. */
export function densify(pts: LatLng[], stepKm: number, R: number): LatLng[] {
  if (pts.length < 2) return pts.slice();
  const out: LatLng[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const km = greatCircleKm(pts[i - 1], pts[i], R);
    const n = Math.max(1, Math.ceil(km / stepKm));
    const a = pts[i - 1], b = pts[i];
    let dl = b.lng - a.lng;
    if (dl > 180) dl -= 360;
    if (dl < -180) dl += 360;
    for (let k = 1; k <= n; k++) out.push({ lat: a.lat + ((b.lat - a.lat) * k) / n, lng: a.lng + (dl * k) / n });
  }
  return out;
}

const nearLine = (p: LatLng, pts: LatLng[], R: number, km: number) => (nearestOnPolyline(p, pts, R)?.km ?? Infinity) <= km;
const atLake = (p: LatLng, lake: MapFeature, R: number, tol: number) => insideArea(p, lake.points) || nearLine(p, ring(lake.points), R, tol);

/** RC-4: rivers that leave a lake (start in it) and that end in it. */
export function lakeRivers(world: World, lake: MapFeature): { outlets: MapFeature[]; inflows: MapFeature[] } {
  const R = world.settings.radiusKm, tol = connectKm(world);
  const rivers = world.mapFeatures.filter((f) => f.kind === 'river' && f.points.length >= 2);
  const outlets = rivers.filter((r) => r.id === lake.outletId || atLake(r.points[0], lake, R, tol));
  const inflows = rivers.filter((r) => !outlets.includes(r) && atLake(r.points[r.points.length - 1], lake, R, tol));
  return { outlets, inflows };
}

/** 2D segment intersection in local lng/lat (longitudes unwrapped); returns the crossing point. */
function cross(a: LatLng, b: LatLng, c: LatLng, d: LatLng): LatLng | null {
  const un = (p: LatLng, o: LatLng) => { let lng = p.lng; while (lng - o.lng > 180) lng -= 360; while (lng - o.lng < -180) lng += 360; return { x: lng, y: p.lat }; };
  const A = un(a, a), B = un(b, a), C = un(c, a), D = un(d, a);
  const r = { x: B.x - A.x, y: B.y - A.y }, s = { x: D.x - C.x, y: D.y - C.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((C.x - A.x) * s.y - (C.y - A.y) * s.x) / den;
  const u = ((C.x - A.x) * r.y - (C.y - A.y) * r.x) / den;
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null;
  return { lat: A.y + t * r.y, lng: A.x + t * r.x };
}

/** Biome ids whose names suggest wet ground (a plausible river source). */
function wetBiomes(world: World): Set<number> {
  return new Set(world.settings.biomes.filter((b) => /swamp|marsh|bog|fen|wetland|rainforest|jungle/i.test(b.name)).map((b) => b.id));
}

/** RC-6: how high counts as "high ground" for a source: 300 m, or well above the river's mouth. */
export const SOURCE_HIGH_M = 300;
export const SOURCE_ABOVE_MOUTH_M = 150;
/** RC-11: default distance from water before a town is flagged. */
export const SETTLEMENT_WATER_KM = 15;
const BIG_PLACES = new Set(['capital', 'city', 'town', 'port']);

export function checkWater(world: World): WaterIssue[] {
  const R = world.settings.radiusKm;
  const tol = connectKm(world);
  const features = world.mapFeatures;
  const rivers = features.filter((f) => f.kind === 'river' && f.points.length >= 2);
  const lakes = features.filter((f) => (f.kind === 'lake') && f.points.length >= 3);
  const seas = features.filter((f) => f.kind === 'sea' && f.points.length >= 3);
  const mountains = features.filter((f) => f.kind === 'mountains' && f.points.length >= 3);
  const terrainOn = hasTerrain(world.terrain);
  const reader = new TerrainReader(world.terrain);
  const out: WaterIssue[] = [];

  // RC-4
  for (const lake of lakes) {
    const { outlets, inflows } = lakeRivers(world, lake);
    const c = lake.points[0];
    if (lake.salt) {
      if (outlets.length) out.push({ rule: 'lake-outlet', key: `lake-outlet:${lake.id}:salt`, featureId: lake.id, at: c, message: `${nameOf(lake, 'lake')} is marked as a salt lake, but ${outlets.map((o) => o.name || 'a river').join(' and ')} flows out of it. Salt lakes have no outlet.` });
      continue;
    }
    if (outlets.length === 0 && (inflows.length > 0 || terrainOn)) {
      out.push({
        rule: 'lake-outlet', key: `lake-outlet:${lake.id}:none`, featureId: lake.id, at: c,
        message: `${nameOf(lake, 'lake')} has no outlet${inflows.length ? `, though ${inflows.length === 1 ? 'a river flows' : `${inflows.length} rivers flow`} into it` : ''}. A fresh lake drains through one river; a lake with no outlet turns salty.`,
        fix: terrainOn ? { kind: 'trace-outlet', lakeId: lake.id } : { kind: 'mark-salt', lakeId: lake.id },
      });
    } else if (outlets.length > 1) {
      out.push({
        rule: 'lake-outlet', key: `lake-outlet:${lake.id}:many`, featureId: lake.id, at: c,
        message: `${nameOf(lake, 'lake')} drains through ${outlets.length} rivers (${outlets.map((o) => o.name || 'unnamed').join(', ')}). Lakes almost always have a single outlet, at the lowest point of their rim.`,
      });
    }
  }

  // RC-5: crossing mountains. Leaving the mountains is natural; entering them from lower ground is not.
  for (const r of rivers) {
    if (r.crossingOk || !mountains.length) continue;
    const pts = densify(r.points, Math.max(2, tol), R);
    let hit: { m: MapFeature; p: LatLng } | undefined;
    for (const m of mountains) {
      let wasOut = false;
      for (const p of pts) {
        const inside = insideArea(p, m.points);
        if (!inside) wasOut = true;
        else if (wasOut) { hit = { m, p }; break; }
      }
      if (hit) break;
    }
    if (hit) out.push({
      rule: 'river-crossing', key: `river-crossing:${r.id}:${hit.m.id}`, featureId: r.id, at: hit.p,
      message: `${nameOf(r)} runs into ${hit.m.name || 'a mountain range'} near ${where(hit.p)}. Rivers flow away from mountains, not through them. Reroute it, or mark the crossing as intended (a gorge).`,
      fix: terrainOn && r.auto ? { kind: 'retrace-river', riverId: r.id } : { kind: 'mark-crossing', riverId: r.id },
    });
  }

  // RC-5: rivers crossing each other (meeting at a mouth or a source is joining, not crossing).
  for (let i = 0; i < rivers.length; i++) {
    for (let j = i + 1; j < rivers.length; j++) {
      const a = rivers[i], b = rivers[j];
      if (a.crossingOk && b.crossingOk) continue;
      let at: LatLng | null = null;
      for (let s = 1; s < a.points.length && !at; s++) {
        for (let t = 1; t < b.points.length && !at; t++) {
          const p = cross(a.points[s - 1], a.points[s], b.points[t - 1], b.points[t]);
          if (!p) continue;
          const ends = [a.points[0], a.points[a.points.length - 1], b.points[0], b.points[b.points.length - 1]];
          if (ends.some((e) => greatCircleKm(e, p, R) <= tol)) continue;
          at = p;
        }
      }
      if (at) out.push({
        rule: 'river-crossing', key: `river-crossing:${[a.id, b.id].sort().join('+')}`, featureId: a.id, at,
        message: `${nameOf(a)} and ${b.name || 'another river'} cross near ${where(at)}. Rivers that meet join into one; they can't flow through each other.`,
        fix: { kind: 'mark-crossing', riverId: a.id },
      });
    }
  }

  // RC-6: river sources.
  const wet = wetBiomes(world);
  for (const r of rivers) {
    if (r.spring || r.fork) continue;
    const src = r.points[0], mouth = r.points[r.points.length - 1];
    if (lakes.some((l) => atLake(src, l, R, tol))) continue;
    if (mountains.some((m) => insideArea(src, m.points) || nearLine(src, ring(m.points), R, tol))) continue;
    if (rivers.some((q) => q.id !== r.id && nearLine(src, q.points, R, tol))) continue; // RC-3 handles forks
    if (!terrainOn) continue;
    const h = reader.elevation(src), hm = reader.elevation(mouth);
    if (h >= SOURCE_HIGH_M || h - hm >= SOURCE_ABOVE_MOUTH_M) continue;
    if (wet.has(reader.biome(src))) continue;
    out.push({
      rule: 'river-source', key: `river-source:${r.id}`, featureId: r.id, at: src,
      message: `${nameOf(r)} rises on low, dry ground (${Math.round(h)} m) near ${where(src)}. Rivers usually start in hills or mountains, at a lake, a spring or in wet ground. Move its source, or mark it as a spring.`,
      fix: { kind: 'mark-spring', riverId: r.id },
    });
  }

  // RC-11: large settlements with no water nearby.
  const maxKm = world.settings.settlementWaterKm ?? SETTLEMENT_WATER_KM;
  const placeById = new Map(world.places.map((p) => [p.id, p]));
  const locate = (p: Place): LatLng | undefined => {
    let q: Place | undefined = p;
    for (let n = 0; q && n < 30; n++) { if (q.location) return q.location; q = q.parentId ? placeById.get(q.parentId) : undefined; }
    return undefined;
  };
  const waterKnown = terrainOn || rivers.length || lakes.length || seas.length;
  if (waterKnown) {
    for (const p of world.places) {
      if (!BIG_PLACES.has(p.kind) || p.isPlaceholder) continue;
      const at = locate(p);
      if (!at) continue;
      const nearWater =
        rivers.some((r) => nearLine(at, r.points, R, maxKm)) ||
        [...lakes, ...seas].some((l) => atLake(at, l, R, maxKm)) ||
        (terrainOn && seaWithin(reader, at, maxKm, R));
      if (nearWater) continue;
      out.push({
        rule: 'settlement-water', key: `settlement-water:${p.id}`, placeId: p.id, at,
        message: `${p.name} is a ${p.kind} with no river, lake or coast within ${maxKm} km. Large towns grow up by water; give it a river or a well-known reason (springs, aqueducts).`,
      });
    }
  }
  return out;
}

/** Any sea (height at or below 0) within km of p, sampled on rings. */
export function seaWithin(reader: TerrainReader, p: LatLng, km: number, R: number): boolean {
  if (reader.elevation(p) <= 0) return true;
  const kmPerDeg = (Math.PI * R) / 180;
  const cellKm = reader.g.cellDeg * kmPerDeg;
  const rings = Math.max(1, Math.ceil(km / Math.max(cellKm, km / 6)));
  for (let k = 1; k <= rings; k++) {
    const d = (km * k) / rings / kmPerDeg;
    const n = 8 + 4 * k;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const q = { lat: p.lat + Math.sin(a) * d, lng: p.lng + (Math.cos(a) * d) / Math.max(0.1, Math.cos((p.lat * Math.PI) / 180)) };
      if (reader.elevation(q) <= 0) return true;
    }
  }
  return false;
}
