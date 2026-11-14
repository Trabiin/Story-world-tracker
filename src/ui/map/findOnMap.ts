/**
 * Find on the map (MK-30): every place, feature, realm and character that has a spot on the map
 * on the current date, searched by name or alias, and the view that shows it.
 */
import type { GeoMultiPolygon, Id, LatLng } from '../../core';
import { clampView, Size } from './navigate';
import { ViewState } from './projection';

export interface Bounds { north: number; south: number; west: number; east: number }
export type FindKind = 'place' | 'feature' | 'region' | 'character';
export interface FindEntry {
  kind: FindKind;
  id: Id;
  name: string;
  aliases?: string[];
  /** Shown after the name: the place kind, the layer, "now at …". */
  note: string;
  at: LatLng;
  /** For lines, areas and realms: what to frame. */
  bounds?: Bounds;
}

/** The box around some points. Longitudes are taken as given (callers keep a line on one side of the date line). */
export function boundsOf(pts: LatLng[]): Bounds | undefined {
  if (!pts.length) return undefined;
  let north = -90, south = 90, west = Infinity, east = -Infinity;
  for (const p of pts) {
    if (p.lat > north) north = p.lat;
    if (p.lat < south) south = p.lat;
    if (p.lng < west) west = p.lng;
    if (p.lng > east) east = p.lng;
  }
  return { north, south, west, east };
}

export function boundsOfArea(mp: GeoMultiPolygon): Bounds | undefined {
  return boundsOf(mp.flatMap((poly) => (poly[0] ?? []).map(([lng, lat]) => ({ lat, lng }))));
}

/** The view that frames a box with some room around it, never closer than `maxScale`. */
export function viewForBounds(b: Bounds, size: Size, maxScale = 400): ViewState {
  const w = Math.max(0.01, b.east - b.west), h = Math.max(0.01, b.north - b.south);
  const scale = Math.min(maxScale, Math.min(size.w / w, size.h / h) * 0.75);
  return clampView({ centerLat: (b.north + b.south) / 2, centerLng: (b.west + b.east) / 2, scale });
}

/** The view for an entry: its box when it has one, otherwise its spot, zoomed in at least to `closeScale`. */
export function viewForEntry(e: FindEntry, current: ViewState, size: Size, closeScale = 60): ViewState {
  if (e.bounds && (e.bounds.east - e.bounds.west > 0.05 || e.bounds.north - e.bounds.south > 0.05)) return viewForBounds(e.bounds, size);
  return clampView({ centerLat: e.at.lat, centerLng: e.at.lng, scale: Math.max(current.scale, closeScale) });
}

/** Best matches first: a name that starts with the text, then a word that does, then anywhere; aliases count too. */
export function findMatches(entries: FindEntry[], text: string, limit = 8): FindEntry[] {
  const q = text.trim().toLowerCase();
  if (!q) return [];
  const rank = (s: string) => {
    const l = s.toLowerCase();
    if (l === q) return 0;
    if (l.startsWith(q)) return 1;
    if (l.split(/[\s\-'’(),]+/).some((w) => w.startsWith(q))) return 2;
    return l.includes(q) ? 3 : 9;
  };
  return entries
    .map((e) => ({ e, r: Math.min(rank(e.name), ...(e.aliases ?? []).map((a) => rank(a) + 0.5)) }))
    .filter((x) => x.r < 9)
    .sort((a, b) => a.r - b.r || a.e.name.localeCompare(b.e.name))
    .slice(0, limit)
    .map((x) => x.e);
}
