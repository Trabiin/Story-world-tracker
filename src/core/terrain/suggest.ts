/**
 * MK-20: terrain suggestions. Once the land and heights exist, propose a terrain type for every
 * land cell from its climate band (RC-7), how far it is from the sea, the dry belts around 20–30°
 * and rain shadows (RC-9). The author accepts the proposal and repaints what they like.
 */
import type { Biome, ClimateBand } from './climate';
import { climateBand } from './climate';
import { upwindRidge, windFrom, SHADOW_RISE_M } from './rainShadow';
import { Terrain, TerrainEditor, TerrainReader, cellCenter, forEachCell, grid } from './terrain';

export interface BiomeSuggestion {
  terrain: Terrain;
  /** Cells given a (new) terrain type. */
  cells: number;
  /** Cells per suggested terrain type id. */
  byBiome: Map<number, number>;
}

/** Finds a terrain type in the world's list by name, so renamed or extra types still work. */
function pick(biomes: Biome[], ...patterns: RegExp[]): number {
  for (const re of patterns) {
    const b = biomes.find((x) => re.test(x.name));
    if (b) return b.id;
  }
  return 0;
}

export interface SuggestOptions {
  tiltDeg: number;
  radiusKm: number;
  winds: 'earth' | number;
  /** true: only land with no terrain type yet. false: propose for all land. */
  onlyUnpainted: boolean;
}

/** Distance (km) from every land cell to the sea, on a coarse grid of about 20 km cells. */
function coastDistance(reader: TerrainReader, terrain: Terrain, radiusKm: number) {
  const g = reader.g;
  const f = Math.max(1, Math.round(0.2 / g.cellDeg));
  const cw = Math.ceil(g.width / f), ch = Math.ceil(g.height / f);
  const kmPerCell = f * g.cellDeg * ((Math.PI * radiusKm) / 180);
  const dist = new Map<number, number>();
  const land = new Set<number>();
  forEachCell(terrain, (gx, gy, elev) => {
    if (elev > 0) land.add(Math.floor(gy / f) * cw + Math.floor(gx / f));
  });
  // BFS from coarse sea cells next to land.
  let frontier: number[] = [];
  for (const c of land) {
    const cy = Math.floor(c / cw), cx = c % cw;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ny = cy + dy;
      if (ny < 0 || ny >= ch) continue;
      const n = ny * cw + ((cx + dx + cw) % cw);
      if (!land.has(n)) { dist.set(c, kmPerCell); frontier.push(c); break; }
    }
  }
  for (let d = 2; frontier.length; d++) {
    const next: number[] = [];
    for (const c of frontier) {
      const cy = Math.floor(c / cw), cx = c % cw;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ny = cy + dy;
        if (ny < 0 || ny >= ch) continue;
        const n = ny * cw + ((cx + dx + cw) % cw);
        if (!land.has(n) || dist.has(n)) continue;
        dist.set(n, d * kmPerCell);
        next.push(n);
      }
    }
    frontier = next;
  }
  return (gx: number, gy: number) => dist.get(Math.floor(gy / f) * cw + Math.floor(gx / f)) ?? 0;
}

export function suggestBiomes(terrain: Terrain, biomes: Biome[], o: SuggestOptions): BiomeSuggestion {
  const reader = new TerrainReader(terrain);
  const g = grid(terrain.cellDeg);
  const ids = {
    ice: pick(biomes, /ice|glacier|snow/i),
    tundra: pick(biomes, /tundra/i),
    pine: pick(biomes, /pine|taiga|conifer/i),
    forest: pick(biomes, /^forest$/i, /forest|wood/i),
    grass: pick(biomes, /grass|steppe|prairie|savann?a/i),
    desert: pick(biomes, /desert|dune/i),
    rain: pick(biomes, /rainforest|jungle/i),
    rock: pick(biomes, /rock|stone|mountain/i),
  };
  const toCoast = coastDistance(reader, terrain, o.radiusKm);
  const stepKm = Math.max(20, 4 * g.cellDeg * ((Math.PI * o.radiusKm) / 180));
  const shadowMemo = new Map<number, boolean>();
  const shadowed = (gx: number, gy: number, elev: number) => {
    const k = Math.floor(gy / 8) * g.width + Math.floor(gx / 8);
    let v = shadowMemo.get(k);
    if (v === undefined) {
      const c = cellCenter(g, gx, gy);
      const ridge = upwindRidge(reader, c, windFrom(c.lat, o.winds), o.radiusKm, stepKm);
      v = ridge >= SHADOW_RISE_M && ridge - Math.max(0, elev) >= SHADOW_RISE_M;
      shadowMemo.set(k, v);
    }
    return v;
  };
  const t = Math.max(1, Math.min(44, o.tiltDeg));
  const choose = (lat: number, elev: number, band: ClimateBand, coastKm: number, shadow: boolean): number => {
    const a = Math.abs(lat);
    if (elev > 4500) return ids.ice || ids.rock;
    if (elev > 3000) return ids.rock || ids.tundra;
    const dryBelt = a > t - 8 && a < t + 12; // subtropical highs, where the great deserts lie
    const dry = shadow || coastKm > 900 || (dryBelt && coastKm > 250);
    const moist = !shadow && coastKm < 500;
    switch (band) {
      case 'polar': return a > 80 || elev > 1000 ? ids.ice || ids.tundra : ids.tundra || ids.ice;
      case 'subarctic': return moist || coastKm < 900 ? ids.pine || ids.forest || ids.tundra : ids.tundra || ids.grass;
      case 'temperate': return dry ? (dryBelt ? ids.desert || ids.grass : ids.grass) : moist ? ids.forest || ids.grass : ids.grass || ids.forest;
      case 'subtropical': return dry ? ids.desert || ids.grass : moist ? ids.forest || ids.grass : ids.grass;
      case 'tropical': return dry ? (dryBelt ? ids.desert || ids.grass : ids.grass) : moist ? ids.rain || ids.forest : ids.grass;
    }
  };
  const ed = new TerrainEditor(terrain);
  const byBiome = new Map<number, number>();
  let cells = 0;
  forEachCell(terrain, (gx, gy, elev, biome) => {
    if (elev <= 0 || (o.onlyUnpainted && biome)) return;
    const lat = 90 - (gy + 0.5) * g.cellDeg;
    const band = climateBand(lat, elev, o.tiltDeg);
    const id = choose(lat, elev, band, toCoast(gx, gy), shadowed(gx, gy, elev));
    if (!id || id === biome) return;
    ed.setCell(gx, gy, undefined, id);
    cells++;
    byBiome.set(id, (byBiome.get(id) ?? 0) + 1);
  });
  return { terrain: cells ? ed.commit() : terrain, cells, byBiome };
}
