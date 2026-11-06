/**
 * WH-9 (optional): terrain, season, danger and river current change travel time. Each one is
 * switched on in World settings; the factor multiplies the travel days of the mode's plain speed.
 */
import { seasonBands } from '../events/sky';
import { networkFor } from '../features/routing';
import { nearestOnPolyline } from '../features/rivers';
import { LatLng, greatCircleKm } from '../globe';
import { LayerIndex } from '../layers';
import type { TravelModifiers, World } from '../model';
import { TerrainReader, hasTerrain } from '../terrain';

export interface TravelFactor {
  factor: number;
  /** "mountains ×1.4", "winter ×1.3"… */
  parts: { reason: string; factor: number }[];
}

export const NO_MODIFIERS: TravelModifiers = { terrain: false, season: false, danger: false, river: false };
const STEP_KM = 10;

/** Points every ~10 km along a path. */
function samples(path: LatLng[], R: number): { p: LatLng; dir: number }[] {
  const out: { p: LatLng; dir: number }[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const n = Math.max(1, Math.ceil(greatCircleKm(a, b, R) / STEP_KM));
    for (let k = 0; k < n; k++) out.push({ p: { lat: a.lat + ((b.lat - a.lat) * (k + 0.5)) / n, lng: a.lng + ((b.lng - a.lng) * (k + 0.5)) / n }, dir: i - 1 });
  }
  return out;
}

const round = (x: number) => Math.round(x * 100) / 100;

export function travelFactor(world: World, path: LatLng[] | undefined, modeId: string, departDay: number, cache: { reader?: TerrainReader; layers?: LayerIndex } = {}): TravelFactor {
  const m = world.settings.travelModifiers;
  if (!m || !path || path.length < 2 || (!m.terrain && !m.season && !m.danger && !m.river)) return { factor: 1, parts: [] };
  const R = world.settings.radiusKm;
  const net = networkFor(modeId);
  const pts = samples(path, R);
  const parts: TravelFactor['parts'] = [];
  if (m.terrain && net === 'land' && hasTerrain(world.terrain)) {
    const reader = (cache.reader ??= new TerrainReader(world.terrain));
    let sum = 0;
    let steep = 0;
    for (const s of pts) {
      const e = reader.elevation(s.p);
      const f = e > 2500 ? 2 : e > 1500 ? 1.6 : e > 600 ? 1.25 : 1;
      if (f > 1) steep++;
      sum += f;
    }
    const f = sum / pts.length;
    if (f > 1.01) parts.push({ reason: steep / pts.length > 0.5 ? 'mountains' : 'hills', factor: round(f) });
  }
  if (m.season && net !== 'none') {
    const mid = path[Math.floor(path.length / 2)];
    const band = seasonBands(departDay, departDay, { hemisphere: world.settings.hemisphereForSeasons, lat: mid.lat, tiltDeg: world.settings.axialTiltDeg })[0];
    if (band?.season === 'winter') parts.push({ reason: net === 'water' ? 'winter storms' : 'winter', factor: net === 'water' ? 1.15 : 1.35 });
  }
  if (m.danger) {
    const layers = (cache.layers ??= new LayerIndex(world));
    const danger = world.regionLayers.filter((l) => l.type === 'danger').map((l) => l.id);
    if (danger.length) {
      let sum = 0;
      for (const s of pts) {
        let worst = 0;
        for (const id of danger) for (const hit of layers.regionsAt(s.p, departDay, id)) for (const h of hit.hits) worst = Math.max(worst, h.intensity);
        sum += 1 + (0.5 * worst) / 100;
      }
      const f = sum / pts.length;
      if (f > 1.01) parts.push({ reason: 'danger', factor: round(f) });
    }
  }
  if (m.river && net === 'water') {
    const rivers = world.mapFeatures.filter((f) => f.kind === 'river' && f.points.length >= 2);
    let down = 0, up = 0;
    for (const s of pts) {
      const next = path[s.dir + 1];
      for (const r of rivers) {
        const a = nearestOnPolyline(s.p, r.points, R);
        if (!a || a.km > 3) continue;
        const b = nearestOnPolyline(next, r.points, R);
        if (!b) continue;
        // Rivers are drawn from source to mouth: moving to a later point is downstream.
        const pa = a.seg + a.t, pb = b.seg + b.t;
        if (pb > pa + 1e-6) down++; else if (pb < pa - 1e-6) up++;
        break;
      }
    }
    const n = pts.length;
    if (down + up > 0) {
      const f = (down * 0.75 + up * 1.4 + (n - down - up)) / n;
      if (Math.abs(f - 1) > 0.01) parts.push({ reason: f < 1 ? 'downstream' : 'upstream', factor: round(f) });
    }
  }
  const factor = parts.reduce((x, p) => x * p.factor, 1);
  return { factor: round(factor), parts };
}

export function describeFactor(t: TravelFactor): string {
  return t.parts.map((p) => `${p.reason} ×${p.factor}`).join(', ');
}
