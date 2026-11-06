/**
 * MK-21: detail on demand for painted coastlines. Draw roughly, then "add detail": cells near the
 * coast get a fractal height nudge, so the coastline wiggles naturally. The nudge is kept per cell
 * (TerrainTile.detail), so "remove detail" takes exactly that much off again, even after other edits.
 */
import { TILE_CELLS, Terrain, TerrainTile, cloneTile, fbm, grid, parseTileKey, TerrainReader } from './terrain';

/** How far (in cells) from the coastline detail reaches, and how strong it is. */
export const DETAIL_REACH_CELLS = 4;
export const DETAIL_AMP_M = 120;

export function hasCoastDetail(t: Terrain): boolean {
  return Object.values(t.tiles).some((x) => !!x.detail);
}

export function addCoastDetail(t: Terrain, seed = 1, ampM = DETAIL_AMP_M): Terrain {
  const base = hasCoastDetail(t) ? removeCoastDetail(t) : t;
  const reader = new TerrainReader(base);
  const g = grid(base.cellDeg);
  const r = DETAIL_REACH_CELLS;
  const tiles: Record<string, TerrainTile> = { ...base.tiles };
  // Scale the noise to about 30 km features whatever the grid size.
  const scale = Math.max(0.02, g.cellDeg / 0.25);
  for (const [k, tile] of Object.entries(base.tiles)) {
    const [tx, ty] = parseTileKey(k);
    let out: TerrainTile | undefined;
    for (let cy = 0; cy < TILE_CELLS; cy++) {
      const gy = ty * TILE_CELLS + cy;
      if (gy >= g.height) break;
      for (let cx = 0; cx < TILE_CELLS; cx++) {
        const gx = tx * TILE_CELLS + cx;
        if (gx >= g.width) break;
        const i = cy * TILE_CELLS + cx;
        const e = tile.elev[i];
        if (Math.abs(e) > ampM * 4) continue;
        // Near the coast: some cell within reach is on the other side of sea level.
        let near = false;
        for (let dy = -r; dy <= r && !near; dy += 2) for (let dx = -r; dx <= r && !near; dx += 2) if ((reader.elevAt(gx + dx, gy + dy) > 0) !== (e > 0)) near = true;
        if (!near) continue;
        // fbm clusters around 0.5: stretch it so the coast really moves.
        const n = Math.max(-1, Math.min(1, (fbm(gx * scale, gy * scale, 5, seed) - 0.5) * 5));
        const add = Math.round(n * ampM);
        if (!add) continue;
        if (!out) { out = cloneTile(tile); out.detail = new Int16Array(TILE_CELLS * TILE_CELLS); }
        out.elev[i] = e + add;
        out.detail![i] = add;
      }
    }
    if (out) tiles[k] = out;
  }
  return { cellDeg: base.cellDeg, tiles };
}

export function removeCoastDetail(t: Terrain): Terrain {
  if (!hasCoastDetail(t)) return t;
  const tiles: Record<string, TerrainTile> = {};
  for (const [k, tile] of Object.entries(t.tiles)) {
    if (!tile.detail) { tiles[k] = tile; continue; }
    const out: TerrainTile = { elev: tile.elev.slice(), biome: tile.biome };
    for (let i = 0; i < out.elev.length; i++) out.elev[i] -= tile.detail[i];
    tiles[k] = out;
  }
  return { cellDeg: t.cellDeg, tiles };
}
