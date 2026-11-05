/**
 * Turns painted terrain into pictures: per-tile images with coastlines, height colours,
 * hillshading or contour lines (MK-5) and an optional climate overlay (RC-7), plus a whole-globe
 * overview used at low zoom and by the globe preview (MK-27).
 */
import { BAND_INFO, Biome, DEFAULT_OCEAN_M, TILE_CELLS, TerrainReader, TerrainTile, climateBand, hash2, tileKey, valueNoise } from '../../core';

export type Relief = 'hillshade' | 'contours' | 'both' | 'off';

export interface RenderStyle {
  relief: Relief;
  climate: boolean;
  tilt: number;
  biomes: Biome[];
  dark: boolean;
}

type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  return [parseInt(v.slice(0, 2), 16) || 0, parseInt(v.slice(2, 4), 16) || 0, parseInt(v.slice(4, 6), 16) || 0];
}

export const PALETTE = {
  light: { deep: hexToRgb('#8fb3c9'), shallow: hexToRgb('#bcd7e3'), coast: hexToRgb('#4f6672'), contour: hexToRgb('#6b5a45') },
  dark: { deep: hexToRgb('#1d3442'), shallow: hexToRgb('#2f5366'), coast: hexToRgb('#a9c3cf'), contour: hexToRgb('#d9c7a8') },
};

/** Colour for unpainted land by height (hypsometric tint). */
const HEIGHT_STOPS: [number, RGB][] = [
  [0, hexToRgb('#c3d3a0')],
  [400, hexToRgb('#d6d39c')],
  [1200, hexToRgb('#cdb98d')],
  [2400, hexToRgb('#b09d86')],
  [3600, hexToRgb('#d9d4cd')],
  [4800, hexToRgb('#f7f7f7')],
];

function heightColor(e: number): RGB {
  if (e <= HEIGHT_STOPS[0][0]) return HEIGHT_STOPS[0][1];
  for (let i = 1; i < HEIGHT_STOPS.length; i++) {
    const [h1, c1] = HEIGHT_STOPS[i];
    if (e <= h1) {
      const [h0, c0] = HEIGHT_STOPS[i - 1];
      const f = (e - h0) / (h1 - h0);
      return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
    }
  }
  return HEIGHT_STOPS[HEIGHT_STOPS.length - 1][1];
}

export function styleKey(s: RenderStyle): string {
  return `${s.relief}|${s.climate ? 1 : 0}|${s.tilt}|${s.dark ? 1 : 0}|${s.biomes.map((b) => `${b.id}:${b.color}`).join(',')}`;
}

export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * Render tile (tx, ty) at `res` pixels per side. Heights are interpolated between cell centres,
 * so coastlines come out smooth rather than blocky.
 */
export function renderTile(r: TerrainReader, tx: number, ty: number, res: number, style: RenderStyle): Pixels {
  const T = TILE_CELLS, W = T + 2;
  const g = r.g;
  const pal = style.dark ? PALETTE.dark : PALETTE.light;
  const biomeColor = new Map(style.biomes.map((b) => [b.id, hexToRgb(b.color)]));
  // Padded window of heights and types, one cell of border taken from neighbouring tiles.
  const E = new Float32Array(W * W), B = new Uint8Array(W * W);
  const tile = r.tile(tx, ty);
  for (let y = -1; y <= T; y++) {
    for (let x = -1; x <= T; x++) {
      const i = (y + 1) * W + (x + 1);
      if (tile && x >= 0 && y >= 0 && x < T && y < T) {
        E[i] = tile.elev[y * T + x];
        B[i] = tile.biome[y * T + x];
      } else if (!tile && x >= 0 && y >= 0 && x < T && y < T) {
        E[i] = DEFAULT_OCEAN_M;
      } else {
        E[i] = r.elevAt(tx * T + x, ty * T + y);
        B[i] = r.biomeAt(tx * T + x, ty * T + y);
      }
    }
  }
  // Per-cell colour and light.
  const cellM = g.cellDeg * 111_000;
  const CR = new Float32Array(W * W), CG = new Float32Array(W * W), CB = new Float32Array(W * W), SH = new Float32Array(W * W);
  const shade = style.relief === 'hillshade' || style.relief === 'both';
  for (let y = 0; y < W; y++) {
    const gy = Math.min(g.height - 1, Math.max(0, ty * T + y - 1));
    const lat = 90 - (gy + 0.5) * g.cellDeg;
    const lonScale = 1 / Math.max(0.05, Math.cos((lat * Math.PI) / 180));
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const e = E[i];
      let c: RGB;
      if (e > 0) {
        c = (B[i] && biomeColor.get(B[i])) || heightColor(e);
        if (style.climate) {
          const bc = hexToRgb(BAND_INFO[climateBand(lat, e, style.tilt)].color);
          c = [c[0] * 0.45 + bc[0] * 0.55, c[1] * 0.45 + bc[1] * 0.55, c[2] * 0.45 + bc[2] * 0.55];
        }
        let s = 1;
        if (shade && x > 0 && y > 0 && x < W - 1 && y < W - 1) {
          // Light from the north-west: slopes facing it are brighter.
          const dx = (E[i + 1] - E[i - 1]) / (2 * cellM / lonScale);
          const dy = (E[i + W] - E[i - W]) / (2 * cellM);
          s = 1 + Math.max(-0.45, Math.min(0.45, (dx + dy) * 6));
        }
        SH[i] = s;
      } else {
        const f = Math.min(1, Math.max(0, -e / 1500));
        c = [pal.shallow[0] + (pal.deep[0] - pal.shallow[0]) * f, pal.shallow[1] + (pal.deep[1] - pal.shallow[1]) * f, pal.shallow[2] + (pal.deep[2] - pal.shallow[2]) * f];
        SH[i] = 1;
      }
      CR[i] = c[0]; CG[i] = c[1]; CB[i] = c[2];
    }
  }
  const f = res / T;
  const out = new Uint8ClampedArray(res * res * 4);
  const land = new Uint8Array(res * res);
  const band = new Int16Array(res * res);
  const contours = style.relief === 'contours' || style.relief === 'both';
  for (let py = 0; py < res; py++) {
    const v = (py + 0.5) / f - 0.5;
    const y0 = Math.floor(v), fy = v - y0;
    for (let px = 0; px < res; px++) {
      const u = (px + 0.5) / f - 0.5;
      const x0 = Math.floor(u), fx = u - x0;
      const i00 = (y0 + 1) * W + (x0 + 1), i10 = i00 + 1, i01 = i00 + W, i11 = i01 + 1;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      const e = E[i00] * w00 + E[i10] * w10 + E[i01] * w01 + E[i11] * w11;
      const isLand = e > 0;
      // Blend colours only from cells on the same side of the coast.
      let sr = 0, sg = 0, sb = 0, ss = 0, sw = 0;
      const add = (i: number, w: number) => {
        if ((E[i] > 0) !== isLand || w <= 0) return;
        sr += CR[i] * w; sg += CG[i] * w; sb += CB[i] * w; ss += SH[i] * w; sw += w;
      };
      add(i00, w00); add(i10, w10); add(i01, w01); add(i11, w11);
      let cr: number, cg: number, cb: number, s: number;
      if (sw > 0) { cr = sr / sw; cg = sg / sw; cb = sb / sw; s = ss / sw; }
      else if (isLand) { [cr, cg, cb] = heightColor(e); s = 1; }
      else { [cr, cg, cb] = pal.shallow; s = 1; }
      if (isLand && f >= 0.9) {
        // Terrain-type edges: pick a nearby cell through a little noise, so borders look natural, not square.
        const gu = tx * T + u, gv = ty * T + v;
        const ju = u + (valueNoise(gu * 0.8, gv * 0.8, 3) - 0.5) * 1.2 + (valueNoise(gu * 2.6, gv * 2.6, 5) - 0.5) * 0.5;
        const jv = v + (valueNoise(gu * 0.8, gv * 0.8, 13) - 0.5) * 1.2 + (valueNoise(gu * 2.6, gv * 2.6, 15) - 0.5) * 0.5;
        const nx = Math.max(-1, Math.min(T, Math.round(ju))), ny = Math.max(-1, Math.min(T, Math.round(jv)));
        const ci = (ny + 1) * W + (nx + 1);
        if (E[ci] > 0 && (B[ci] || B[i00] || B[i10] || B[i01] || B[i11])) { cr = CR[ci]; cg = CG[ci]; cb = CB[ci]; }
      }
      const o = (py * res + px) * 4;
      out[o] = cr * s; out[o + 1] = cg * s; out[o + 2] = cb * s; out[o + 3] = 255;
      land[py * res + px] = isLand ? 1 : 0;
      band[py * res + px] = isLand ? Math.floor(e / 250) : -1;
    }
  }
  // Coastlines and contour lines where neighbouring pixels differ.
  if (f >= 0.9) {
    for (let py = 0; py < res; py++) {
      for (let px = 0; px < res; px++) {
        const k = py * res + px;
        const right = px + 1 < res ? k + 1 : -1, down = py + 1 < res ? k + res : -1;
        const o = k * 4;
        if ((right >= 0 && land[right] !== land[k]) || (down >= 0 && land[down] !== land[k])) {
          out[o] = pal.coast[0]; out[o + 1] = pal.coast[1]; out[o + 2] = pal.coast[2];
        } else if (contours && land[k] && ((right >= 0 && land[right] && band[right] !== band[k]) || (down >= 0 && land[down] && band[down] !== band[k]))) {
          const major = Math.max(band[k], right >= 0 ? band[right] : 0, down >= 0 ? band[down] : 0) % 4 === 0;
          const a = major ? 0.75 : 0.4;
          out[o] = out[o] * (1 - a) + pal.contour[0] * a; out[o + 1] = out[o + 1] * (1 - a) + pal.contour[1] * a; out[o + 2] = out[o + 2] * (1 - a) + pal.contour[2] * a;
        }
      }
    }
  }
  return { width: res, height: res, data: out };
}

function toCanvas(p: Pixels): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = p.width;
  c.height = p.height;
  c.getContext('2d')!.putImageData(new ImageData(p.data as unknown as Uint8ClampedArray<ArrayBuffer>, p.width, p.height), 0, 0);
  return c;
}

/** The 3×3 tiles a tile's picture depends on (borders blend with neighbours). */
function deps(r: TerrainReader, tx: number, ty: number): (TerrainTile | undefined)[] {
  const out: (TerrainTile | undefined)[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) out.push(r.tile(((tx + dx) % r.g.tilesX + r.g.tilesX) % r.g.tilesX, ty + dy));
  return out;
}
const sameDeps = (a: (TerrainTile | undefined)[], b: (TerrainTile | undefined)[]) => a.every((t, i) => t === b[i]);

/** Rendered tile pictures, re-rendered when a tile or a neighbour changes. Time-budgeted per frame. */
export class TileImageCache {
  private map = new Map<string, { deps: (TerrainTile | undefined)[]; canvas: HTMLCanvasElement }>();
  private budgetEnd = 0;
  private pixels = 0;
  /** Keep cached pictures under about 100 MB. */
  private maxPixels = 24_000_000;
  /** True when some tile could not be rendered within this frame's budget. */
  pending = false;

  beginFrame(budgetMs = 30) {
    this.budgetEnd = performance.now() + budgetMs;
    this.pending = false;
  }

  get(r: TerrainReader, tx: number, ty: number, res: number, style: RenderStyle, sk: string): HTMLCanvasElement | undefined {
    const key = `${tileKey(tx, ty)}|${res}|${sk}`;
    const d = deps(r, tx, ty);
    const hit = this.map.get(key);
    if (hit && sameDeps(hit.deps, d)) {
      this.map.delete(key);
      this.map.set(key, hit); // most recently used
      return hit.canvas;
    }
    if (performance.now() > this.budgetEnd) {
      this.pending = true;
      return hit?.canvas; // stale picture until there is time
    }
    const canvas = toCanvas(renderTile(r, tx, ty, res, style));
    if (hit) { this.pixels -= hit.canvas.width * hit.canvas.height; this.map.delete(key); }
    this.map.set(key, { deps: d, canvas });
    this.pixels += res * res;
    while (this.pixels > this.maxPixels && this.map.size > 1) {
      const oldest = this.map.keys().next().value!;
      const c = this.map.get(oldest)!.canvas;
      this.pixels -= c.width * c.height;
      this.map.delete(oldest);
    }
    return canvas;
  }
}

/** Whole-globe picture (0.5° per pixel by default), updated tile by tile as terrain changes. */
export class Overview {
  readonly width: number;
  readonly height: number;
  readonly canvas: HTMLCanvasElement;
  private drawn = new Map<string, (TerrainTile | undefined)[]>();
  private sk = '';
  private cellDeg = 0;

  constructor(degPerPx = 0.5) {
    this.width = Math.round(360 / degPerPx);
    this.height = Math.round(180 / degPerPx);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = this.height;
  }

  update(r: TerrainReader, style: RenderStyle, sk: string): boolean {
    const g = this.canvas.getContext('2d')!;
    const pal = style.dark ? PALETTE.dark : PALETTE.light;
    if (sk !== this.sk || r.g.cellDeg !== this.cellDeg) {
      this.sk = sk;
      this.cellDeg = r.g.cellDeg;
      this.drawn.clear();
      g.fillStyle = `rgb(${pal.deep.join(',')})`;
      g.fillRect(0, 0, this.width, this.height);
    }
    const tilePx = Math.max(1, Math.round((r.g.tileDeg / 360) * this.width));
    let changed = false;
    const want = new Set<string>();
    for (const k of Object.keys(r.terrain.tiles)) {
      const [tx, ty] = k.split(',').map(Number);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = (tx + dx + r.g.tilesX) % r.g.tilesX, ny = ty + dy;
        if (ny >= 0 && ny < r.g.tilesY) want.add(tileKey(nx, ny));
      }
    }
    for (const k of [...this.drawn.keys()]) if (!want.has(k)) {
      const [tx, ty] = k.split(',').map(Number);
      g.fillStyle = `rgb(${pal.deep.join(',')})`;
      g.fillRect(tx * tilePx, ty * tilePx, tilePx, tilePx);
      this.drawn.delete(k);
      changed = true;
    }
    for (const k of want) {
      const [tx, ty] = k.split(',').map(Number);
      const d = deps(r, tx, ty);
      const prev = this.drawn.get(k);
      if (prev && sameDeps(prev, d)) continue;
      const p = renderTile(r, tx, ty, tilePx, { ...style, relief: style.relief === 'contours' ? 'off' : style.relief });
      g.putImageData(new ImageData(p.data as unknown as Uint8ClampedArray<ArrayBuffer>, p.width, p.height), tx * tilePx, ty * tilePx);
      this.drawn.set(k, d);
      changed = true;
    }
    return changed;
  }

  pixels(): ImageData {
    return this.canvas.getContext('2d')!.getImageData(0, 0, this.width, this.height);
  }
}

export interface AutoSymbol {
  lat: number;
  lng: number;
  kind: 'peak' | 'hill';
  size: number; // 0.4..1.3
  /** Block size in degrees, to decide how many to show at a zoom. */
  bx: number;
  by: number;
}

const symbolCache = new WeakMap<TerrainTile, AutoSymbol[]>();
export const SYMBOL_BLOCK = 4; // cells

/** MK-6: mountain and hill symbols placed where the ground is high, one per small block. */
export function autoSymbols(r: TerrainReader, tx: number, ty: number): AutoSymbol[] {
  const tile = r.tile(tx, ty);
  if (!tile) return [];
  const cached = symbolCache.get(tile);
  if (cached) return cached;
  const out: AutoSymbol[] = [];
  const T = TILE_CELLS, S = SYMBOL_BLOCK, g = r.g;
  for (let by = 0; by < T / S; by++) {
    for (let bx = 0; bx < T / S; bx++) {
      let best = -1e9, bi = 0;
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const i = (by * S + y) * T + (bx * S + x);
        if (tile.elev[i] > best) { best = tile.elev[i]; bi = i; }
      }
      if (best < 450) continue;
      const cx = bi % T, cy = Math.floor(bi / T);
      const gx = tx * T + cx, gy = ty * T + cy;
      const jx = (hash2(gx, gy, 5) - 0.5) * 0.6, jy = (hash2(gx, gy, 9) - 0.5) * 0.6;
      out.push({
        lat: 90 - (gy + 0.5 + jy) * g.cellDeg,
        lng: -180 + (gx + 0.5 + jx) * g.cellDeg,
        kind: best >= 1400 ? 'peak' : 'hill',
        size: best >= 1400 ? Math.min(1.3, 0.55 + (best - 1400) / 3000) : Math.min(0.8, 0.45 + (best - 450) / 2500),
        bx: tx * (T / S) + bx,
        by: ty * (T / S) + by,
      });
    }
  }
  symbolCache.set(tile, out);
  return out;
}
