/**
 * MK-17: find the land in a scanned sketch, and MK-15: turn it into a rough coastline and terrain
 * to refine. The sketch is read as pixels (the UI draws it small onto a canvas); the result is a
 * land mask the size of that picture, which is then laid onto the terrain grid where the sketch is
 * pinned on the globe. Nothing here is final: the brushes fix it afterwards, and undo takes it back.
 */
import { NEW_LAND_M, NEW_WATER_M, TILE_CELLS, Terrain, TerrainEditor, cellCenter, fbm } from './terrain';

export interface SketchPixels {
  width: number;
  height: number;
  /** RGBA, row by row (ImageData.data). */
  data: Uint8ClampedArray | Uint8Array;
}

export interface DetectOptions {
  /**
   * 'outline': coastlines drawn as lines on paper; areas closed in by lines are land and the
   * open area reaching the edge of the picture is sea. 'filled': dark or coloured areas are land.
   */
  mode: 'outline' | 'filled';
  /** Pixels darker than this (0–255) count as ink. */
  threshold: number;
  /** Close breaks in a drawn coastline up to about twice this many pixels wide. */
  gap: number;
  /** Land smaller than this many pixels (specks, letters) is dropped; sea pockets smaller than it are filled. */
  minArea: number;
  /** Swap land and sea. */
  invert?: boolean;
}

export const DEFAULT_DETECT: DetectOptions = { mode: 'outline', threshold: 110, gap: 3, minArea: 80 };

export interface LandMask {
  width: number;
  height: number;
  /** 1 = land, 0 = sea. */
  land: Uint8Array;
}

function luminance(px: SketchPixels): Uint8Array {
  const n = px.width * px.height;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const a = px.data[i * 4 + 3];
    // Transparent pixels are paper.
    out[i] = a < 128 ? 255 : Math.round(0.299 * px.data[i * 4] + 0.587 * px.data[i * 4 + 1] + 0.114 * px.data[i * 4 + 2]);
  }
  return out;
}

/** Distance (in pixels, chamfer 3-4 approximation) from each pixel to the nearest pixel where `src` is 1. */
export function distanceTo(src: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = src[i] ? 0 : INF;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 3);
      if (y > 0) {
        v = Math.min(v, d[i - w] + 3);
        if (x > 0) v = Math.min(v, d[i - w - 1] + 4);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + 4);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + 3);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 3);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + 4);
        if (x > 0) v = Math.min(v, d[i + w - 1] + 4);
      }
      d[i] = v;
    }
  }
  for (let i = 0; i < d.length; i++) d[i] /= 3;
  return d;
}

/** Flip connected areas of value `v` smaller than minArea (4-connected) to the other value. */
function dropSmall(mask: Uint8Array, w: number, h: number, v: 0 | 1, minArea: number) {
  if (minArea <= 1) return;
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const comp: number[] = [];
  for (let s = 0; s < mask.length; s++) {
    if (seen[s] || mask[s] !== v) continue;
    comp.length = 0;
    stack.push(s); seen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      comp.push(i);
      const x = i % w;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
      for (const j of nb) if (j >= 0 && j < mask.length && !seen[j] && mask[j] === v) { seen[j] = 1; stack.push(j); }
    }
    if (comp.length < minArea) for (const i of comp) mask[i] = v ? 0 : 1;
  }
}

/** MK-17: which pixels of the sketch are land. */
export function detectLand(px: SketchPixels, o: DetectOptions): LandMask {
  const { width: w, height: h } = px;
  const lum = luminance(px);
  const n = w * h;
  const land = new Uint8Array(n);
  if (o.mode === 'filled') {
    for (let i = 0; i < n; i++) land[i] = lum[i] < o.threshold ? 1 : 0;
  } else {
    const ink = new Uint8Array(n);
    for (let i = 0; i < n; i++) ink[i] = lum[i] < o.threshold ? 1 : 0;
    // Thicken the lines so small breaks close, then the sea is what the picture's edge reaches.
    const dInk = distanceTo(ink, w, h);
    const wall = new Uint8Array(n);
    for (let i = 0; i < n; i++) wall[i] = dInk[i] <= o.gap ? 1 : 0;
    const sea = new Uint8Array(n);
    const stack: number[] = [];
    const seed = (i: number) => { if (!wall[i] && !sea[i]) { sea[i] = 1; stack.push(i); } };
    for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w;
      if (x > 0) seed(i - 1);
      if (x < w - 1) seed(i + 1);
      if (i >= w) seed(i - w);
      if (i < n - w) seed(i + w);
    }
    // Give back to the sea what thickening took, but never the drawn line itself.
    const dSea = o.gap > 0 ? distanceTo(sea, w, h) : undefined;
    for (let i = 0; i < n; i++) land[i] = sea[i] || (dSea && !ink[i] && dSea[i] <= o.gap) ? 0 : 1;
  }
  if (o.invert) for (let i = 0; i < n; i++) land[i] = land[i] ? 0 : 1;
  dropSmall(land, w, h, 1, o.minArea);
  dropSmall(land, w, h, 0, o.minArea);
  return { width: w, height: h, land };
}

export function landShare(m: LandMask): number {
  let k = 0;
  for (let i = 0; i < m.land.length; i++) k += m.land[i];
  return m.land.length ? k / m.land.length : 0;
}

export interface SketchBounds { north: number; south: number; west: number; east: number }

export interface LayOptions {
  /** 'replace': land and sea inside the sketch both follow it. 'add': only land is added; existing land stays. */
  mode: 'replace' | 'add';
  /** MK-15: hills that rise inland and seas that deepen offshore, instead of flat lowland and shallows. */
  rough: boolean;
  /** Highest typical inland height for rough terrain, metres. */
  peakM?: number;
  seed?: number;
  planetRadiusKm?: number;
}

/**
 * Lay a land mask onto the terrain where the sketch is pinned. Only cells whose centre lies inside
 * the sketch change. Terrain types already painted are kept.
 */
export function laySketchLand(terrain: Terrain, mask: LandMask, b: SketchBounds, o: LayOptions): { terrain: Terrain; land: number; water: number } {
  const ed = new TerrainEditor(terrain);
  const g = ed.g;
  const east = b.east < b.west ? b.east + 360 : b.east;
  const x0 = Math.floor((b.west + 180) / g.cellDeg), x1 = Math.ceil((east + 180) / g.cellDeg);
  const y0 = Math.max(0, Math.floor((90 - b.north) / g.cellDeg)), y1 = Math.min(g.height - 1, Math.ceil((90 - b.south) / g.cellDeg));
  const W = x1 - x0 + 1, H = y1 - y0 + 1;
  // The mask, resampled onto the grid cells of the sketch's box (2 = outside the sketch).
  const cells = new Uint8Array(W * H).fill(2);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = cellCenter(g, x0 + x, y0 + y);
      let lng = c.lng;
      while (lng < b.west) lng += 360;
      const u = (lng - b.west) / (east - b.west), v = (b.north - c.lat) / (b.north - b.south);
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
      cells[y * W + x] = mask.land[Math.floor(v * mask.height) * mask.width + Math.floor(u * mask.width)];
    }
  }
  let dLand: Float32Array | undefined, dSea: Float32Array | undefined;
  if (o.rough) {
    const sea = new Uint8Array(W * H), land = new Uint8Array(W * H);
    for (let i = 0; i < cells.length; i++) { sea[i] = cells[i] === 0 ? 1 : 0; land[i] = cells[i] === 1 ? 1 : 0; }
    dLand = distanceTo(sea, W, H); // for land cells: how far to the sea
    dSea = distanceTo(land, W, H);
  }
  const R = o.planetRadiusKm ?? 6371;
  const kmPerCell = (g.cellDeg * Math.PI / 180) * R;
  const peak = o.peakM ?? 1200;
  const seed = o.seed ?? 3;
  // Noise features of about 60 km whatever the grid size.
  const scale = kmPerCell / 60;
  let landN = 0, waterN = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const v = cells[i];
      if (v === 2) continue;
      const gx = x0 + x, gy = y0 + y;
      const cur = ed.elevAt(gx, gy);
      if (v === 1) {
        if (o.mode === 'add' && cur > 0 && !o.rough) continue;
        let e = cur > 0 && !o.rough ? cur : NEW_LAND_M;
        if (o.rough) {
          const km = dLand![i] * kmPerCell;
          const n = fbm(gx * scale, gy * scale, 5, seed);
          e = Math.max(5, 15 + peak * (1 - Math.exp(-km / 120)) * (0.2 + 1.4 * n * n));
          if (o.mode === 'add' && cur > e) continue;
        }
        ed.setCell(gx, gy, e);
        landN++;
      } else if (o.mode === 'replace') {
        let e = cur <= 0 && !o.rough ? cur : NEW_WATER_M;
        if (o.rough) e = -30 - 2500 * (1 - Math.exp(-(dSea![i] * kmPerCell) / 150));
        ed.setCell(gx, gy, Math.min(-1, e));
        waterN++;
      }
    }
  }
  return { terrain: ed.changed ? ed.commit() : terrain, land: landN, water: waterN };
}

/** Tile keys a sketch box touches (for refreshing automatic rivers afterwards). */
export function tilesInBounds(cellDeg: number, b: SketchBounds): string[] {
  const tileDeg = TILE_CELLS * cellDeg;
  const east = b.east < b.west ? b.east + 360 : b.east;
  const out: string[] = [];
  const tilesX = Math.ceil(360 / tileDeg);
  for (let ty = Math.floor((90 - b.north) / tileDeg); ty <= Math.floor((90 - b.south) / tileDeg); ty++) {
    for (let tx = Math.floor((b.west + 180) / tileDeg); tx <= Math.floor((east + 180) / tileDeg); tx++) out.push(`${((tx % tilesX) + tilesX) % tilesX},${ty}`);
  }
  return out;
}
