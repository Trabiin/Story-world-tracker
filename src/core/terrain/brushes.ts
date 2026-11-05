/**
 * Brushes that paint real data into the terrain grid (MK-4, MK-5, MK-7, MK-18).
 * Brush sizes are in km on the globe, so a brush near a pole covers more degrees of longitude:
 * drawing accounts for projection stretch (MK-27).
 */
import { greatCircleKm, interpolateGreatCircle, type LatLng } from '../globe';
import { NEW_LAND_M, NEW_WATER_M, TerrainEditor, cellCenter, cellOf, fbm } from './terrain';

export type BrushTool =
  | 'land' | 'water' // MK-4
  | 'smooth' | 'roughen' // MK-4 coastline
  | 'raise' | 'lower' | 'set-height' | 'flatten' // MK-5
  | 'mountains' | 'hills' // MK-18 smart brushes
  | 'biome' | 'erase-biome'; // MK-7

export interface BrushParams {
  tool: BrushTool;
  radiusKm: number;
  /** 0..1 */
  strength: number;
  /** Target height for set-height and flatten, in metres. */
  height?: number;
  /** Terrain type id for the biome brush. */
  biome?: number;
  planetRadiusKm: number;
}

/** Cells under a brush with their falloff weight (1 at the centre, 0 at the rim). */
export function cellsInRadius(ed: TerrainEditor, center: LatLng, radiusKm: number, planetRadiusKm: number): { gx: number; gy: number; w: number }[] {
  const g = ed.g;
  const kmPerDeg = (Math.PI * planetRadiusKm) / 180;
  const dLat = radiusKm / kmPerDeg;
  const top = cellOf(g, { lat: Math.min(90, center.lat + dLat), lng: center.lng }).gy;
  const bottom = cellOf(g, { lat: Math.max(-90, center.lat - dLat), lng: center.lng }).gy;
  const out: { gx: number; gy: number; w: number }[] = [];
  for (let gy = top; gy <= bottom; gy++) {
    const rowLat = 90 - (gy + 0.5) * g.cellDeg;
    const cos = Math.cos((rowLat * Math.PI) / 180);
    const nearPole = Math.abs(center.lat) + dLat >= 89.9;
    const halfLng = nearPole || cos < 1e-3 ? 180 : Math.min(180, dLat / cos);
    const cells = Math.ceil(halfLng / g.cellDeg);
    const c = cellOf(g, { lat: rowLat, lng: center.lng }).gx;
    const span = Math.min(cells, Math.floor(g.width / 2));
    for (let dx = -span; dx <= span; dx++) {
      if (dx === span && 2 * span + 1 > g.width) break; // don't visit a column twice
      const gx = c + dx;
      const d = greatCircleKm(center, cellCenter(g, gx, gy), planetRadiusKm);
      if (d > radiusKm) continue;
      const f = 1 - (d / radiusKm) ** 2;
      out.push({ gx, gy, w: f * f });
    }
  }
  return out;
}

/** Apply one dab of a brush. pressure (0..1) comes from a pen tablet; mouse = 1. */
export function applyDab(ed: TerrainEditor, center: LatLng, p: BrushParams, pressure = 1) {
  const cells = cellsInRadius(ed, center, p.radiusKm, p.planetRadiusKm);
  const s = Math.max(0, Math.min(1, p.strength)) * Math.max(0.05, Math.min(1, pressure));
  // Read everything first so the dab doesn't see its own writes.
  const cur = cells.map((c) => ed.elevAt(c.gx, c.gy));
  switch (p.tool) {
    case 'land':
      cells.forEach((c, i) => { if (cur[i] <= 0) ed.setCell(c.gx, c.gy, NEW_LAND_M); });
      break;
    case 'water':
      cells.forEach((c, i) => { if (cur[i] > 0) ed.setCell(c.gx, c.gy, NEW_WATER_M, 0); });
      break;
    case 'raise':
    case 'lower': {
      const sign = p.tool === 'raise' ? 1 : -1;
      cells.forEach((c, i) => ed.setCell(c.gx, c.gy, cur[i] + sign * 150 * s * c.w));
      break;
    }
    case 'set-height':
    case 'flatten': {
      const h = p.height ?? 0;
      cells.forEach((c, i) => ed.setCell(c.gx, c.gy, cur[i] + (h - cur[i]) * Math.min(1, s * c.w * 1.6)));
      break;
    }
    case 'smooth': {
      const next = cells.map((c) => {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += ed.elevAt(c.gx + dx, c.gy + dy);
        return sum / 9;
      });
      cells.forEach((c, i) => ed.setCell(c.gx, c.gy, cur[i] + (next[i] - cur[i]) * Math.min(1, s * c.w * 1.5)));
      break;
    }
    case 'roughen':
      cells.forEach((c, i) => {
        const n = fbm(c.gx / 5, c.gy / 5, 4, 7) - 0.5;
        ed.setCell(c.gx, c.gy, cur[i] + n * 2 * 140 * s * c.w);
      });
      break;
    case 'mountains':
      cells.forEach((c, i) => {
        const ridged = 1 - Math.abs(2 * fbm(c.gx / 4, c.gy / 4, 4, 3) - 1);
        const base = Math.max(cur[i], NEW_LAND_M);
        ed.setCell(c.gx, c.gy, base + 420 * s * c.w * (0.25 + ridged * ridged));
      });
      break;
    case 'hills':
      cells.forEach((c, i) => {
        const n = fbm(c.gx / 3, c.gy / 3, 3, 11);
        const base = Math.max(cur[i], NEW_LAND_M);
        // Hills stay hills: growth slows above ~800 m.
        const room = Math.max(0, 1 - base / 900);
        ed.setCell(c.gx, c.gy, base + 90 * s * c.w * (0.4 + n) * room);
      });
      break;
    case 'biome':
      cells.forEach((c, i) => { if (cur[i] > 0) ed.setCell(c.gx, c.gy, undefined, p.biome ?? 0); });
      break;
    case 'erase-biome':
      cells.forEach((c) => ed.setCell(c.gx, c.gy, undefined, 0));
      break;
  }
}

/** Points to dab between two pointer positions, spaced along the great circle. */
export function dabsBetween(a: LatLng, b: LatLng, spacingKm: number, planetRadiusKm: number): LatLng[] {
  const d = greatCircleKm(a, b, planetRadiusKm);
  const n = Math.floor(d / Math.max(spacingKm, 1e-6));
  if (n < 1) return [];
  const pts = interpolateGreatCircle(a, b, n);
  return pts.slice(1);
}

/** MK-4 polygon tool: fill a polygon (drawn on the flat map) with land, water or a terrain type. */
export function fillPolygon(ed: TerrainEditor, pts: LatLng[], mode: 'land' | 'water' | 'biome', biome = 0) {
  if (pts.length < 3) return;
  const g = ed.g;
  // Unwrap longitudes so a polygon across the date line stays one shape.
  const poly: LatLng[] = [];
  for (const p of pts) {
    const prev = poly[poly.length - 1];
    let lng = p.lng;
    if (prev) while (lng - prev.lng > 180) lng -= 360;
    if (prev) while (lng - prev.lng < -180) lng += 360;
    poly.push({ lat: p.lat, lng });
  }
  const lats = poly.map((p) => p.lat), lngs = poly.map((p) => p.lng);
  const north = Math.min(90, Math.max(...lats)), south = Math.max(-90, Math.min(...lats));
  const west = Math.min(...lngs), east = Math.max(...lngs);
  const gy0 = Math.max(0, Math.floor((90 - north) / g.cellDeg)), gy1 = Math.min(g.height - 1, Math.floor((90 - south) / g.cellDeg));
  const gx0 = Math.floor((west + 180) / g.cellDeg), gx1 = Math.floor((east + 180) / g.cellDeg);
  for (let gy = gy0; gy <= gy1; gy++) {
    const lat = 90 - (gy + 0.5) * g.cellDeg;
    for (let gx = gx0; gx <= gx1; gx++) {
      const lng = -180 + (gx + 0.5) * g.cellDeg;
      if (!pointInPolygon(lat, lng, poly)) continue;
      const e = ed.elevAt(gx, gy);
      if (mode === 'land') { if (e <= 0) ed.setCell(gx, gy, NEW_LAND_M); }
      else if (mode === 'water') { if (e > 0) ed.setCell(gx, gy, NEW_WATER_M, 0); }
      else if (e > 0) ed.setCell(gx, gy, undefined, biome);
    }
  }
}

export function pointInPolygon(lat: number, lng: number, poly: LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.lat > lat) !== (b.lat > lat) && lng < ((b.lng - a.lng) * (lat - a.lat)) / (b.lat - a.lat) + a.lng) inside = !inside;
  }
  return inside;
}
