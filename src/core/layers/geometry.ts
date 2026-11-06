/**
 * Region shapes (LY-5, LY-6): multipolygons in longitude/latitude, drawn on the equirectangular map.
 * Adding, cutting and overlapping shapes uses polygon-clipping (MIT). Longitudes may run past ±180
 * so a realm can cross the date line; every operation also tries the copies one turn east and west.
 */
import * as clipNs from 'polygon-clipping';
import type { LatLng } from '../globe';
import type { GeoMultiPolygon, GeoPolygon, GeoRing } from '../model';

type Clip = typeof clipNs;
const pc: Clip = ((clipNs as unknown as { default?: Clip }).default ?? clipNs) as Clip;

const round = (v: number) => Math.round(v * 1e5) / 1e5;

function bboxOf(poly: GeoPolygon): { w: number; e: number; s: number; n: number } {
  let w = Infinity, e = -Infinity, s = Infinity, n = -Infinity;
  for (const [x, y] of poly[0] ?? []) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  return { w, e, s, n };
}

function shiftPoly(poly: GeoPolygon, dx: number): GeoPolygon {
  return dx === 0 ? poly : poly.map((r) => r.map(([x, y]) => [x + dx, y] as [number, number]));
}

function shiftMulti(mp: GeoMultiPolygon, dx: number): GeoMultiPolygon {
  return dx === 0 ? mp : mp.map((p) => shiftPoly(p, dx));
}

/** Each polygon moved by whole turns so its middle lies between -180 and 180; tiny slivers dropped. */
export function normalizeArea(mp: GeoMultiPolygon): GeoMultiPolygon {
  const out: GeoMultiPolygon = [];
  for (const poly of mp) {
    if (!poly[0] || poly[0].length < 4) continue;
    if (Math.abs(ringArea(poly[0])) < 1e-8) continue;
    const b = bboxOf(poly);
    const mid = (b.w + b.e) / 2;
    const k = Math.round(mid / 360);
    out.push(shiftPoly(poly, -k * 360).map((r) => r.map(([x, y]) => [round(x), round(Math.max(-90, Math.min(90, y)))] as [number, number])));
  }
  return out;
}

/** Copies of b one turn east and west, for operations near the date line. */
function wrapped(b: GeoMultiPolygon): GeoMultiPolygon {
  return [...b, ...shiftMulti(b, 360), ...shiftMulti(b, -360)];
}

/** A closed ring from points (polygon-clipping wants the first point repeated at the end). */
export function ringFromPoints(pts: LatLng[]): GeoRing {
  const ring: GeoRing = [];
  let prev: number | undefined;
  for (const p of pts) {
    let x = p.lng;
    if (prev !== undefined) { while (x - prev > 180) x -= 360; while (x - prev < -180) x += 360; }
    ring.push([x, p.lat]);
    prev = x;
  }
  if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) ring.push([ring[0][0], ring[0][1]]);
  return ring;
}

export function polygonFromPoints(pts: LatLng[]): GeoMultiPolygon {
  if (pts.length < 3) return [];
  // Self-crossing outlines are cleaned up by a union with nothing.
  return normalizeArea(safe(() => pc.union([ringFromPoints(pts)]), [[ringFromPoints(pts)]]));
}

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

const isEmpty = (mp: GeoMultiPolygon) => mp.length === 0;

export function unionArea(a: GeoMultiPolygon, b: GeoMultiPolygon): GeoMultiPolygon {
  if (isEmpty(b)) return a;
  if (isEmpty(a)) return normalizeArea(b);
  // Bring b next to a so the union does not leave a copy a whole turn away.
  const ca = (bboxOf(a[0]).w + bboxOf(a[0]).e) / 2;
  const moved = b.map((p) => { const bb = bboxOf(p); return shiftPoly(p, Math.round((ca - (bb.w + bb.e) / 2) / 360) * 360); });
  return normalizeArea(safe(() => pc.union(a, moved), [...a, ...moved]));
}

export function subtractArea(a: GeoMultiPolygon, b: GeoMultiPolygon): GeoMultiPolygon {
  if (isEmpty(a) || isEmpty(b)) return a;
  return normalizeArea(safe(() => pc.difference(a, wrapped(b)), a));
}

export function intersectArea(a: GeoMultiPolygon, b: GeoMultiPolygon): GeoMultiPolygon {
  if (isEmpty(a) || isEmpty(b)) return [];
  return normalizeArea(safe(() => pc.intersection(a, wrapped(b)), []));
}

function ringArea(r: GeoRing): number {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
  return s / 2;
}

function inRing(x: number, y: number, r: GeoRing): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(x: number, y: number, poly: GeoPolygon): boolean {
  if (!poly[0] || !inRing(x, y, poly[0])) return false;
  for (let h = 1; h < poly.length; h++) if (inRing(x, y, poly[h])) return false;
  return true;
}

/** LY-9: is the point inside the shape (holes excluded)? */
export function areaContains(mp: GeoMultiPolygon, p: LatLng): boolean {
  for (const poly of mp) {
    const b = bboxOf(poly);
    if (p.lat < b.s || p.lat > b.n) continue;
    for (const dx of [0, 360, -360]) {
      const x = p.lng + dx;
      if (x >= b.w && x <= b.e && inPolygon(x, p.lat, poly)) return true;
    }
  }
  return false;
}

/** Spherical area in km² (holes subtracted). */
export function areaKm2(mp: GeoMultiPolygon, radiusKm: number): number {
  const rad = Math.PI / 180;
  const ring = (r: GeoRing) => {
    let s = 0;
    for (let i = 0; i < r.length - 1; i++) s += (r[i + 1][0] - r[i][0]) * rad * (2 + Math.sin(r[i][1] * rad) + Math.sin(r[i + 1][1] * rad));
    return Math.abs((s * radiusKm * radiusKm) / 2);
  };
  let total = 0;
  for (const poly of mp) poly.forEach((r, i) => (total += i === 0 ? ring(r) : -ring(r)));
  return Math.max(0, total);
}

/** Where to put a label: inside the largest piece, in the middle of its widest stretch across. */
export function labelPoint(mp: GeoMultiPolygon): { at: LatLng; widthDeg: number; heightDeg: number } | null {
  let best: GeoPolygon | null = null, bestA = 0;
  for (const poly of mp) { const a = Math.abs(ringArea(poly[0])); if (a > bestA) { bestA = a; best = poly; } }
  if (!best) return null;
  const b = bboxOf(best);
  let pick: { at: LatLng; width: number } | null = null;
  for (const f of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) {
    const y = b.s + (b.n - b.s) * f;
    const xs: number[] = [];
    for (const r of best) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > y) !== (yj > y)) xs.push(((xj - xi) * (y - yi)) / (yj - yi) + xi);
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const width = xs[i + 1] - xs[i];
      if (!pick || width > pick.width * 1.15) pick = { at: { lat: y, lng: (xs[i] + xs[i + 1]) / 2 }, width };
    }
    if (pick && f === 0.5 && pick.width > (b.e - b.w) * 0.5) break;
  }
  return pick ? { at: pick.at, widthDeg: pick.width, heightDeg: b.n - b.s } : null;
}

/** A circle on the globe as a polygon (for the region brush). */
export function circleArea(c: LatLng, radiusKm: number, planetKm: number, sides = 20): GeoMultiPolygon {
  const dLat = (radiusKm / planetKm) * (180 / Math.PI);
  const dLng = dLat / Math.max(0.05, Math.cos((c.lat * Math.PI) / 180));
  const ring: GeoRing = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    ring.push([c.lng + Math.cos(a) * dLng, Math.max(-90, Math.min(90, c.lat + Math.sin(a) * dLat))]);
  }
  ring.push([ring[0][0], ring[0][1]]);
  return [[ring]];
}

/** LY-5 freehand brush: the area swept by a round brush along a stroke. */
export function strokeArea(pts: LatLng[], radiusKm: number, planetKm: number): GeoMultiPolygon {
  if (!pts.length) return [];
  const dabs: GeoMultiPolygon = [];
  const stepDeg = (radiusKm * 0.5 / planetKm) * (180 / Math.PI);
  let last: LatLng | null = null;
  for (const p of pts) {
    if (last) {
      let dx = p.lng - last.lng;
      if (dx > 180) dx -= 360; if (dx < -180) dx += 360;
      const n = Math.ceil(Math.hypot(dx * Math.cos((p.lat * Math.PI) / 180), p.lat - last.lat) / stepDeg);
      for (let i = 1; i <= n; i++) dabs.push(...circleArea({ lat: last.lat + ((p.lat - last.lat) * i) / n, lng: last.lng + (dx * i) / n }, radiusKm, planetKm));
    } else dabs.push(...circleArea(p, radiusKm, planetKm));
    last = p;
  }
  // Bring every dab next to the first so the union stays in one piece across the date line.
  const x0 = dabs[0][0][0][0];
  const near = dabs.map((poly) => shiftPoly(poly, Math.round((x0 - poly[0][0][0]) / 360) * 360));
  return normalizeArea(safe(() => pc.union(near[0], ...near.slice(1)), near));
}

/** All edges of a shape, for snapping new outlines to existing borders. */
export function areaRings(mp: GeoMultiPolygon): GeoRing[] {
  return mp.flatMap((p) => p);
}
