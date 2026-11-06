/**
 * MK-21: detail on demand for drawn lines and outlines (rivers, roads, lakes, areas). Each segment
 * gets midpoints nudged sideways, a few times over, so a rough line meanders naturally. The line as
 * drawn is kept (roughPoints), so the detail can be removed again.
 */
import { greatCircleKm, type LatLng } from '../globe';
import type { MapFeature, World } from '../model';
import { hash2 } from '../terrain';
import { nearestOnPolyline } from './rivers';

/** Detail never goes finer than this (km between points). */
export const LINE_DETAIL_MIN_KM = 1.5;

export function wiggleLine(pts: LatLng[], R: number, closed: boolean, seed = 1, levels = 3, minKm = LINE_DETAIL_MIN_KM): LatLng[] {
  let cur = closed && pts.length > 2 ? [...pts, pts[0]] : pts.slice();
  for (let lv = 0; lv < levels; lv++) {
    const next: LatLng[] = [cur[0]];
    for (let i = 1; i < cur.length; i++) {
      const a = cur[i - 1], b = cur[i];
      const km = greatCircleKm(a, b, R);
      if (km >= 2 * minKm) {
        let dl = b.lng - a.lng;
        if (dl > 180) dl -= 360;
        if (dl < -180) dl += 360;
        const cos = Math.max(0.1, Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180));
        // Sideways unit vector in degrees (lat, lng), scaled so the nudge is in km.
        const ex = dl * cos, ey = b.lat - a.lat;
        const len = Math.hypot(ex, ey) || 1;
        const kmPerDeg = (Math.PI * R) / 180;
        const h = hash2(Math.round(a.lat * 1000) + i * 7919, Math.round(a.lng * 1000) + lv * 104729, seed) - 0.5;
        const off = Math.max(-2.5, Math.min(2.5, h * 0.5 * km)); // up to a quarter of the segment, at most 2.5 km, either way
        const nLat = (ex / len) * (off / kmPerDeg), nLng = (-ey / len) * (off / kmPerDeg) / cos;
        next.push({ lat: (a.lat + b.lat) / 2 + nLat, lng: a.lng + dl / 2 + nLng });
      }
      next.push(b);
    }
    cur = next;
  }
  return closed && pts.length > 2 ? cur.slice(0, -1) : cur;
}

export function featureWithDetail(f: MapFeature, R: number, seed = 1): MapFeature {
  const rough = f.roughPoints ?? f.points;
  return { ...f, roughPoints: rough, points: wiggleLine(rough, R, f.shape === 'area', seed) };
}

export function featureWithoutDetail(f: MapFeature): MapFeature {
  if (!f.roughPoints) return f;
  const { roughPoints, ...rest } = f;
  return { ...rest, points: roughPoints };
}

/** Which features "add detail" applies to everywhere: hand-drawn rivers, lakes, seas and other areas. Automatic rivers already follow the land. */
export function detailable(f: MapFeature): boolean {
  if (f.kind === 'river') return !f.auto || !!f.handEdited;
  return f.shape === 'area'; // roads keep their vertices: each one may be snapped to a place
}

export function addDetailToFeatures(world: World, seed = 1): World {
  const R = world.settings.radiusKm;
  const features = world.mapFeatures.map((f) => (detailable(f) ? featureWithDetail(f, R, seed) : f));
  return { ...world, mapFeatures: snapMouths(features, R) };
}

export function removeDetailFromFeatures(world: World): World {
  return { ...world, mapFeatures: snapMouths(world.mapFeatures.map(featureWithoutDetail), R0(world)) };
}

const R0 = (w: World) => w.settings.radiusKm;

/** Tributaries end on their main river again after it moved. */
export function snapMouths(features: MapFeature[], R: number): MapFeature[] {
  const byId = new Map(features.map((f) => [f.id, f]));
  return features.map((f) => {
    const parent = f.kind === 'river' && f.joinsId ? byId.get(f.joinsId) : undefined;
    if (!parent || f.points.length < 2) return f;
    const n = nearestOnPolyline(f.points[f.points.length - 1], parent.points, R);
    if (!n || n.km < 0.01) return f;
    return { ...f, points: [...f.points.slice(0, -1), n.point] };
  });
}
