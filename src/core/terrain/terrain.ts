/**
 * Painted terrain (MK-4..MK-7): a global latitude/longitude grid of cells, each holding an
 * elevation in metres (sea level 0, below 0 is water) and a terrain type (biome) id.
 * The grid is cut into square tiles, and only tiles that were painted are stored; everything
 * else is open ocean. Tiles are immutable: an edit copies the tiles it touches (copy-on-write),
 * so undo history shares unchanged tiles.
 */
import type { LatLng } from '../globe';

/** Cells along one side of a tile. */
export const TILE_CELLS = 120;
/** Elevation of ocean that was never painted. */
export const DEFAULT_OCEAN_M = -2000;
export const MIN_ELEV = -11000;
export const MAX_ELEV = 9000;
/** Height given to freshly painted land. */
export const NEW_LAND_M = 30;
/** Depth given to freshly painted water. */
export const NEW_WATER_M = -60;

/** Grid sizes the app offers (degrees per cell). */
export const CELL_SIZES = [0.1, 0.05, 0.025] as const;
export const DEFAULT_CELL_DEG = 0.05;

export interface TerrainTile {
  /** Elevation in metres, row-major, north row first. */
  elev: Int16Array;
  /** Terrain type id per cell; 0 = not painted (coloured by height). */
  biome: Uint8Array;
}

export interface Terrain {
  cellDeg: number;
  /** Key "tx,ty" → tile. */
  tiles: Record<string, TerrainTile>;
}

export function emptyTerrain(cellDeg = DEFAULT_CELL_DEG): Terrain {
  return { cellDeg, tiles: {} };
}

export function hasTerrain(t: Terrain | undefined): boolean {
  return !!t && Object.keys(t.tiles).length > 0;
}

export interface Grid {
  cellDeg: number;
  width: number; // cells around the globe
  height: number; // cells pole to pole
  tilesX: number;
  tilesY: number;
  tileDeg: number;
}

export function grid(cellDeg: number): Grid {
  const width = Math.round(360 / cellDeg), height = Math.round(180 / cellDeg);
  return { cellDeg, width, height, tilesX: Math.ceil(width / TILE_CELLS), tilesY: Math.ceil(height / TILE_CELLS), tileDeg: TILE_CELLS * cellDeg };
}

export const tileKey = (tx: number, ty: number) => `${tx},${ty}`;
export function parseTileKey(k: string): [number, number] {
  const [a, b] = k.split(',');
  return [Number(a), Number(b)];
}

export function newTile(): TerrainTile {
  const elev = new Int16Array(TILE_CELLS * TILE_CELLS).fill(DEFAULT_OCEAN_M);
  return { elev, biome: new Uint8Array(TILE_CELLS * TILE_CELLS) };
}

export function cloneTile(t: TerrainTile): TerrainTile {
  return { elev: t.elev.slice(), biome: t.biome.slice() };
}

/** Wrap a global column index east–west. */
export function wrapX(g: Grid, gx: number): number {
  return ((gx % g.width) + g.width) % g.width;
}

/** Cell containing a point. Row 0 is the north pole edge, column 0 is longitude -180. */
export function cellOf(g: Grid, p: LatLng): { gx: number; gy: number } {
  const gx = wrapX(g, Math.floor((p.lng + 180) / g.cellDeg));
  const gy = Math.min(g.height - 1, Math.max(0, Math.floor((90 - p.lat) / g.cellDeg)));
  return { gx, gy };
}

/** Centre of a cell. */
export function cellCenter(g: Grid, gx: number, gy: number): LatLng {
  return { lat: 90 - (gy + 0.5) * g.cellDeg, lng: -180 + (wrapX(g, gx) + 0.5) * g.cellDeg };
}

/** Read-only access to a terrain with fast cell lookups. */
export class TerrainReader {
  readonly g: Grid;
  constructor(public readonly terrain: Terrain) {
    this.g = grid(terrain.cellDeg);
  }
  tile(tx: number, ty: number): TerrainTile | undefined {
    return this.terrain.tiles[tileKey(tx, ty)];
  }
  elevAt(gx: number, gy: number): number {
    if (gy < 0) gy = 0;
    if (gy >= this.g.height) gy = this.g.height - 1;
    gx = wrapX(this.g, gx);
    const t = this.terrain.tiles[tileKey(Math.floor(gx / TILE_CELLS), Math.floor(gy / TILE_CELLS))];
    return t ? t.elev[(gy % TILE_CELLS) * TILE_CELLS + (gx % TILE_CELLS)] : DEFAULT_OCEAN_M;
  }
  biomeAt(gx: number, gy: number): number {
    if (gy < 0 || gy >= this.g.height) return 0;
    gx = wrapX(this.g, gx);
    const t = this.terrain.tiles[tileKey(Math.floor(gx / TILE_CELLS), Math.floor(gy / TILE_CELLS))];
    return t ? t.biome[(gy % TILE_CELLS) * TILE_CELLS + (gx % TILE_CELLS)] : 0;
  }
  /** Elevation at a point (bilinear between cell centres). */
  elevation(p: LatLng): number {
    const x = (p.lng + 180) / this.g.cellDeg - 0.5, y = (90 - p.lat) / this.g.cellDeg - 0.5;
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const a = this.elevAt(x0, y0), b = this.elevAt(x0 + 1, y0), c = this.elevAt(x0, y0 + 1), d = this.elevAt(x0 + 1, y0 + 1);
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
  biome(p: LatLng): number {
    const { gx, gy } = cellOf(this.g, p);
    return this.biomeAt(gx, gy);
  }
  isLand(p: LatLng): boolean {
    return this.elevation(p) > 0;
  }
}

/**
 * Collects edits to a terrain without touching the original. Tiles are copied the first time
 * they are written; commit() returns a new Terrain sharing every untouched tile.
 */
export class TerrainEditor extends TerrainReader {
  private written = new Map<string, TerrainTile>();
  private work: Record<string, TerrainTile>;
  constructor(base: Terrain) {
    // Reads go through the working set, so later dabs see earlier ones.
    const work = { ...base.tiles };
    super({ cellDeg: base.cellDeg, tiles: work });
    this.work = work;
  }
  /** Tile for writing (created as ocean when missing). */
  writable(tx: number, ty: number): TerrainTile {
    const k = tileKey(tx, ty);
    let t = this.written.get(k);
    if (t) return t;
    const cur = this.work[k];
    t = cur ? cloneTile(cur) : newTile();
    this.written.set(k, t);
    this.work[k] = t;
    return t;
  }
  setCell(gx: number, gy: number, elev: number | undefined, biome?: number) {
    if (gy < 0 || gy >= this.g.height) return;
    gx = wrapX(this.g, gx);
    const t = this.writable(Math.floor(gx / TILE_CELLS), Math.floor(gy / TILE_CELLS));
    const i = (gy % TILE_CELLS) * TILE_CELLS + (gx % TILE_CELLS);
    if (elev !== undefined) t.elev[i] = Math.round(Math.max(MIN_ELEV, Math.min(MAX_ELEV, elev)));
    if (biome !== undefined) t.biome[i] = biome;
  }
  get changed(): boolean {
    return this.written.size > 0;
  }
  /** Keys of tiles written so far. */
  get changedKeys(): string[] {
    return [...this.written.keys()];
  }
  /** A snapshot of the work so far (later writes copy again, so this stays valid). */
  snapshot(): Terrain {
    const out: Terrain = { cellDeg: this.g.cellDeg, tiles: { ...this.work } };
    this.written.clear();
    return out;
  }
  commit(): Terrain {
    const tiles: Record<string, TerrainTile> = {};
    for (const [k, t] of Object.entries(this.work)) if (!isPlainOcean(t)) tiles[k] = t;
    this.written.clear();
    return { cellDeg: this.g.cellDeg, tiles };
  }
}

/** A tile that is still untouched ocean can be dropped. */
export function isPlainOcean(t: TerrainTile): boolean {
  for (let i = 0; i < t.elev.length; i++) if (t.elev[i] !== DEFAULT_OCEAN_M || t.biome[i] !== 0) return false;
  return true;
}

/** Change the grid size, resampling heights (bilinear) and terrain types (nearest). */
export function resampleTerrain(t: Terrain, cellDeg: number): Terrain {
  if (cellDeg === t.cellDeg) return t;
  const src = new TerrainReader(t);
  const dst = new TerrainEditor(emptyTerrain(cellDeg));
  const g = dst.g;
  const srcTileDeg = src.g.tileDeg;
  // Visit only destination tiles overlapping a painted source tile.
  const want = new Set<string>();
  for (const k of Object.keys(t.tiles)) {
    const [tx, ty] = parseTileKey(k);
    const west = -180 + tx * srcTileDeg, north = 90 - ty * srcTileDeg;
    const x0 = Math.floor((west + 180) / g.tileDeg), x1 = Math.floor((west + srcTileDeg + 180 - 1e-9) / g.tileDeg);
    const y0 = Math.floor((90 - north) / g.tileDeg), y1 = Math.floor((90 - north + srcTileDeg - 1e-9) / g.tileDeg);
    for (let y = y0; y <= Math.min(y1, g.tilesY - 1); y++) for (let x = x0; x <= Math.min(x1, g.tilesX - 1); x++) want.add(tileKey(x, y));
  }
  for (const k of want) {
    const [tx, ty] = parseTileKey(k);
    for (let cy = 0; cy < TILE_CELLS; cy++) {
      const gy = ty * TILE_CELLS + cy;
      if (gy >= g.height) break;
      for (let cx = 0; cx < TILE_CELLS; cx++) {
        const gx = tx * TILE_CELLS + cx;
        if (gx >= g.width) break;
        const p = cellCenter(g, gx, gy);
        dst.setCell(gx, gy, src.elevation(p), src.biome(p));
      }
    }
  }
  return dst.commit();
}

/** Visit every stored cell (for checks and statistics). */
export function forEachCell(t: Terrain, fn: (gx: number, gy: number, elev: number, biome: number) => void) {
  const g = grid(t.cellDeg);
  for (const [k, tile] of Object.entries(t.tiles)) {
    const [tx, ty] = parseTileKey(k);
    for (let cy = 0; cy < TILE_CELLS; cy++) {
      const gy = ty * TILE_CELLS + cy;
      if (gy >= g.height) break;
      for (let cx = 0; cx < TILE_CELLS; cx++) {
        const gx = tx * TILE_CELLS + cx;
        if (gx >= g.width) break;
        const i = cy * TILE_CELLS + cx;
        fn(gx, gy, tile.elev[i], tile.biome[i]);
      }
    }
  }
}

/** Area of one cell in km² at a given row (cells shrink toward the poles). */
export function cellAreaKm2(g: Grid, gy: number, radiusKm: number): number {
  const RAD = Math.PI / 180;
  const latN = (90 - gy * g.cellDeg) * RAD, latS = (90 - (gy + 1) * g.cellDeg) * RAD;
  return radiusKm * radiusKm * g.cellDeg * RAD * Math.abs(Math.sin(latN) - Math.sin(latS));
}

/** Small deterministic hash noise in 0..1 for a cell (for natural-looking brushes and symbols). */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in 0..1 at a fractional cell position. */
export function valueNoise(x: number, y: number, seed = 0): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(x0, y0, seed), b = hash2(x0 + 1, y0, seed), c = hash2(x0, y0 + 1, seed), d = hash2(x0 + 1, y0 + 1, seed);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

/** Fractal noise (several octaves) in roughly 0..1. */
export function fbm(x: number, y: number, octaves = 4, seed = 0): number {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x * f, y * f, seed + o * 17) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2;
  }
  return sum / norm;
}

/** Remove one terrain type from every cell (when it is deleted from the list). */
export function clearBiome(t: Terrain, id: number): Terrain {
  const tiles = { ...t.tiles };
  let changed = false;
  for (const [k, tile] of Object.entries(t.tiles)) {
    if (!tile.biome.includes(id)) continue;
    const c = cloneTile(tile);
    for (let i = 0; i < c.biome.length; i++) if (c.biome[i] === id) c.biome[i] = 0;
    tiles[k] = c;
    changed = true;
  }
  return changed ? { cellDeg: t.cellDeg, tiles } : t;
}

/** How many cells use each terrain type. */
export function biomeUsage(t: Terrain): Map<number, number> {
  const out = new Map<number, number>();
  for (const tile of Object.values(t.tiles)) for (let i = 0; i < tile.biome.length; i++) if (tile.biome[i]) out.set(tile.biome[i], (out.get(tile.biome[i]) ?? 0) + 1);
  return out;
}
