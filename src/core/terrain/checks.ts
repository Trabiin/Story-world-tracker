/** RC-8: terrain types that clash with the temperature band where they are painted. */
import type { LatLng } from '../globe';
import { Biome, BAND_INFO, ClimateBand, climateBand } from './climate';
import { Terrain, cellAreaKm2, cellCenter, forEachCell, grid, wrapX } from './terrain';

export interface BiomeClash {
  key: string;
  biomeId: number;
  band: ClimateBand;
  cells: number;
  areaKm2: number;
  center: LatLng;
}

/** Connected patches of cells whose terrain type is implausible in their band. */
export function findBiomeClashes(terrain: Terrain, biomes: Biome[], tiltDeg: number, planetRadiusKm: number): BiomeClash[] {
  const g = grid(terrain.cellDeg);
  const allowed = new Map(biomes.map((b) => [b.id, new Set(b.bands)]));
  // Band per row at sea level shifts with height, so check each cell.
  const bad = new Map<number, ClimateBand>(); // global cell index → band
  const biomeOf = new Map<number, number>();
  forEachCell(terrain, (gx, gy, elev, biome) => {
    if (!biome || elev <= 0) return;
    const ok = allowed.get(biome);
    if (!ok) return;
    const lat = 90 - (gy + 0.5) * g.cellDeg;
    const band = climateBand(lat, elev, tiltDeg);
    if (ok.has(band)) return;
    const idx = gy * g.width + gx;
    bad.set(idx, band);
    biomeOf.set(idx, biome);
  });
  if (bad.size === 0) return [];
  const seen = new Set<number>();
  const out: BiomeClash[] = [];
  for (const start of [...bad.keys()].sort((a, b) => a - b)) {
    if (seen.has(start)) continue;
    const biome = biomeOf.get(start)!;
    const band = bad.get(start)!;
    // Flood fill over 4-neighbours with the same terrain type and band.
    const stack = [start];
    seen.add(start);
    let cells = 0, area = 0, sx = 0, sy = 0, sz = 0;
    while (stack.length) {
      const idx = stack.pop()!;
      const gy = Math.floor(idx / g.width), gx = idx % g.width;
      cells++;
      area += cellAreaKm2(g, gy, planetRadiusKm);
      const c = cellCenter(g, gx, gy);
      const la = (c.lat * Math.PI) / 180, ln = (c.lng * Math.PI) / 180;
      sx += Math.cos(la) * Math.cos(ln); sy += Math.cos(la) * Math.sin(ln); sz += Math.sin(la);
      const nbrs = [gy * g.width + wrapX(g, gx + 1), gy * g.width + wrapX(g, gx - 1)];
      if (gy > 0) nbrs.push((gy - 1) * g.width + gx);
      if (gy < g.height - 1) nbrs.push((gy + 1) * g.width + gx);
      for (const n of nbrs) {
        if (seen.has(n) || biomeOf.get(n) !== biome || bad.get(n) !== band) continue;
        seen.add(n);
        stack.push(n);
      }
    }
    const center = { lat: (Math.atan2(sz, Math.hypot(sx, sy)) * 180) / Math.PI, lng: (Math.atan2(sy, sx) * 180) / Math.PI };
    // Key on terrain type, band and a coarse (5°) anchor, so it survives small repaints.
    const key = `biome-climate:${biome}:${band}:${Math.round(center.lat / 5)}:${Math.round(center.lng / 5)}`;
    out.push({ key, biomeId: biome, band, cells, areaKm2: area, center });
  }
  return out;
}

export function describeClash(c: BiomeClash, biomes: Biome[]): string {
  const b = biomes.find((x) => x.id === c.biomeId);
  const where = `${Math.abs(c.center.lat).toFixed(1)}°${c.center.lat >= 0 ? 'N' : 'S'}, ${Math.abs(c.center.lng).toFixed(1)}°${c.center.lng >= 0 ? 'E' : 'W'}`;
  const area = `about ${(c.areaKm2 >= 1000 ? Math.round(c.areaKm2 / 100) * 100 : Math.max(1, Math.round(c.areaKm2))).toLocaleString()} km²`;
  const ok = b ? b.bands.map((x) => BAND_INFO[x].name.toLowerCase()).join(', ') : '';
  return `${b?.name ?? 'Terrain'} in a ${BAND_INFO[c.band].name.toLowerCase()} zone near ${where} (${area}). ${b?.name ?? 'It'} usually belongs in: ${ok || 'nowhere'}.`;
}
