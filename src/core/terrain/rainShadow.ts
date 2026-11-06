/**
 * RC-9 (optional): rain shadow. Wet winds drop their rain on the windward side of a mountain range,
 * so lush terrain (rainforest, swamp) just downwind of high mountains is unlikely.
 * Winds: Earth-like belts by latitude (trade winds from the east below 30°, westerlies to 60°,
 * polar easterlies beyond), or one direction for the whole world.
 */
import type { LatLng } from '../globe';
import type { Biome } from './climate';
import { Terrain, TerrainReader, cellAreaKm2, cellCenter, forEachCell, grid, wrapX } from './terrain';

/** Direction the wind blows from, degrees clockwise from north. */
export function windFrom(lat: number, setting: 'earth' | number): number {
  if (setting !== 'earth') return ((setting % 360) + 360) % 360;
  const a = Math.abs(lat);
  return a < 30 ? 90 : a < 60 ? 270 : 90;
}

export function windName(deg: number): string {
  return ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(deg / 45) % 8];
}

export const SHADOW_SEARCH_KM = 500;
/** Mountains this much higher than the lush ground, and at least this high, cast a rain shadow. */
export const SHADOW_RISE_M = 1500;

export interface RainShadowIssue {
  key: string;
  biomeId: number;
  areaKm2: number;
  center: LatLng;
  ridgeM: number;
  windFromDeg: number;
}

export function lushBiomes(biomes: Biome[]): Set<number> {
  return new Set(biomes.filter((b) => /rainforest|jungle|swamp|marsh|bog|fen|wetland/i.test(b.name)).map((b) => b.id));
}

/** Highest ground within SHADOW_SEARCH_KM upwind of a point. */
export function upwindRidge(reader: TerrainReader, p: LatLng, fromDeg: number, R: number, stepKm: number): number {
  const kmPerDeg = (Math.PI * R) / 180;
  const a = (fromDeg * Math.PI) / 180;
  const dLat = Math.cos(a) / kmPerDeg, dLng = Math.sin(a) / (kmPerDeg * Math.max(0.1, Math.cos((p.lat * Math.PI) / 180)));
  let top = -Infinity;
  for (let km = stepKm; km <= SHADOW_SEARCH_KM; km += stepKm) {
    const e = reader.elevation({ lat: p.lat + dLat * km, lng: p.lng + dLng * km });
    if (e > top) top = e;
  }
  return top;
}

export function findRainShadows(terrain: Terrain, biomes: Biome[], winds: 'earth' | number, R: number): RainShadowIssue[] {
  const lush = lushBiomes(biomes);
  if (!lush.size) return [];
  const g = grid(terrain.cellDeg);
  const reader = new TerrainReader(terrain);
  const stepKm = Math.max(10, 2 * g.cellDeg * ((Math.PI * R) / 180));
  const bad = new Map<number, { biome: number; ridge: number }>();
  // Look up every other cell and spread the answer, which keeps big jungles quick.
  const memo = new Map<number, number>();
  forEachCell(terrain, (gx, gy, elev, biome) => {
    if (!lush.has(biome) || elev <= 0) return;
    const key = (gy >> 1) * g.width + (gx >> 1);
    let ridge = memo.get(key);
    if (ridge === undefined) {
      const c = cellCenter(g, gx, gy);
      ridge = upwindRidge(reader, c, windFrom(c.lat, winds), R, stepKm);
      memo.set(key, ridge);
    }
    if (ridge >= SHADOW_RISE_M && ridge - elev >= SHADOW_RISE_M) bad.set(gy * g.width + gx, { biome, ridge });
  });
  const seen = new Set<number>();
  const out: RainShadowIssue[] = [];
  for (const start of [...bad.keys()].sort((a, b) => a - b)) {
    if (seen.has(start)) continue;
    const biome = bad.get(start)!.biome;
    const stack = [start];
    seen.add(start);
    let area = 0, sx = 0, sy = 0, sz = 0, ridge = 0;
    while (stack.length) {
      const idx = stack.pop()!;
      const gy = Math.floor(idx / g.width), gx = idx % g.width;
      area += cellAreaKm2(g, gy, R);
      ridge = Math.max(ridge, bad.get(idx)!.ridge);
      const c = cellCenter(g, gx, gy);
      const la = (c.lat * Math.PI) / 180, ln = (c.lng * Math.PI) / 180;
      sx += Math.cos(la) * Math.cos(ln); sy += Math.cos(la) * Math.sin(ln); sz += Math.sin(la);
      const nbrs = [gy * g.width + wrapX(g, gx + 1), gy * g.width + wrapX(g, gx - 1)];
      if (gy > 0) nbrs.push((gy - 1) * g.width + gx);
      if (gy < g.height - 1) nbrs.push((gy + 1) * g.width + gx);
      for (const n of nbrs) {
        if (seen.has(n) || bad.get(n)?.biome !== biome) continue;
        seen.add(n);
        stack.push(n);
      }
    }
    const center = { lat: (Math.atan2(sz, Math.hypot(sx, sy)) * 180) / Math.PI, lng: (Math.atan2(sy, sx) * 180) / Math.PI };
    out.push({ key: `rain-shadow:${biome}:${Math.round(center.lat / 5)}:${Math.round(center.lng / 5)}`, biomeId: biome, areaKm2: area, center, ridgeM: ridge, windFromDeg: windFrom(center.lat, winds) });
  }
  return out;
}
