/** Equirectangular projection that wraps east–west (DM-3). */
import type { LatLng } from '../../core';

export interface ViewState {
  centerLat: number;
  centerLng: number;
  /** Screen pixels per degree. */
  scale: number;
}

export function toScreen(v: ViewState, w: number, h: number, p: LatLng, wrapOffset = 0) {
  return { x: (p.lng + wrapOffset - v.centerLng) * v.scale + w / 2, y: (v.centerLat - p.lat) * v.scale + h / 2 };
}

export function toLatLng(v: ViewState, w: number, h: number, x: number, y: number): LatLng {
  const lng = (x - w / 2) / v.scale + v.centerLng;
  const lat = v.centerLat - (y - h / 2) / v.scale;
  return { lat, lng };
}

/** Longitude offsets (multiples of 360) whose copy of the world is visible. */
export function wrapOffsets(v: ViewState, w: number): number[] {
  const halfSpan = w / 2 / v.scale;
  const minLng = v.centerLng - halfSpan, maxLng = v.centerLng + halfSpan;
  const out: number[] = [];
  for (let k = Math.floor((minLng - 180) / 360); k <= Math.ceil((maxLng + 180) / 360); k++) {
    const o = k * 360;
    if (180 + o >= minLng && -180 + o <= maxLng) out.push(o);
  }
  return out;
}

/** Given two calibration points (image pixel → lat/lng), solve the image's corner bounds (MP-2). */
export function boundsFromTwoPoints(
  a: { px: number; py: number; lat: number; lng: number },
  b: { px: number; py: number; lat: number; lng: number },
  width: number,
  height: number,
): { north: number; south: number; west: number; east: number } | null {
  if (Math.abs(a.px - b.px) < 1 || Math.abs(a.py - b.py) < 1) return null;
  const degPerPxX = (b.lng - a.lng) / (b.px - a.px);
  const degPerPxY = (b.lat - a.lat) / (b.py - a.py); // negative for north-up images
  const west = a.lng - a.px * degPerPxX;
  const east = west + width * degPerPxX;
  const north = a.lat - a.py * degPerPxY;
  const south = north + height * degPerPxY;
  return { north, south, west, east };
}
