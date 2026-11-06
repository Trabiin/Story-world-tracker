/**
 * Draws region layers on the map (LY-3, LY-4, LY-6, LY-7): fills, hatching for overlaps,
 * border styles, intensity as opacity, labels sized by area, and fills that stop at the coast.
 */
import { GeoMultiPolygon, Id, LatLng, LayerIndex, Region, RegionLayer, TILE_CELLS, TerrainReader, TerrainTile, labelPoint } from '../../core';
import { hexToRgb } from './terrainRender';

type Project = (p: LatLng, offset: number) => { x: number; y: number };

export interface RegionRenderOpts {
  ix: LayerIndex;
  day: number;
  offsets: number[];
  project: Project;
  scale: number;
  w: number;
  h: number;
  /** Painted terrain, for fills that stop at the coastline. None = no clipping. */
  reader?: TerrainReader;
  labels: boolean;
  selected?: Id;
  /** VW-2, LY-6: regions whose borders just changed during playback; 0..1 fades the highlight. */
  flash?: { ids: Set<Id>; strength: number };
  /** The layer being edited is drawn a little stronger. */
  activeLayer?: Id;
  fg: string;
  bg: string;
}

const patterns = new Map<string, HTMLCanvasElement>();
function hatchTile(color: string): HTMLCanvasElement {
  let c = patterns.get(color);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 10;
  const g = c.getContext('2d')!;
  g.strokeStyle = color;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(-2, 12); g.lineTo(12, -2);
  g.moveTo(-2, 2); g.lineTo(2, -2);
  g.moveTo(8, 12); g.lineTo(12, 8);
  g.stroke();
  patterns.set(color, c);
  return c;
}

const masks = new WeakMap<TerrainTile, HTMLCanvasElement>();
function tileMask(t: TerrainTile): HTMLCanvasElement {
  let c = masks.get(t);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = TILE_CELLS;
  const g = c.getContext('2d')!;
  const img = g.createImageData(TILE_CELLS, TILE_CELLS);
  for (let i = 0; i < t.elev.length; i++) if (t.elev[i] > 0) { img.data[i * 4 + 3] = 255; }
  g.putImageData(img, 0, 0);
  masks.set(t, c);
  return c;
}

/** Paints land as opaque on a canvas (for destination-in clipping). */
function drawLandMask(g: CanvasRenderingContext2D, reader: TerrainReader, o: RegionRenderOpts) {
  const tg = reader.g;
  g.imageSmoothingEnabled = true;
  for (const key of Object.keys(reader.terrain.tiles)) {
    const [tx, ty] = key.split(',').map(Number);
    const t = reader.terrain.tiles[key];
    for (const off of o.offsets) {
      const a = o.project({ lat: 90 - ty * tg.tileDeg, lng: -180 + tx * tg.tileDeg }, off);
      const size = tg.tileDeg * o.scale;
      if (a.x > o.w || a.y > o.h || a.x + size < 0 || a.y + size < 0) continue;
      g.drawImage(tileMask(t), a.x, a.y, size + 0.5, size + 0.5);
    }
  }
}

/** Offsets to try for a shape, so pieces running past ±180 still show. */
function shapeOffsets(offsets: number[]): number[] {
  return [...new Set([offsets[0] - 360, ...offsets, offsets[offsets.length - 1] + 360])];
}

function tracePath(g: CanvasRenderingContext2D, area: GeoMultiPolygon, project: Project, off: number, w: number, h: number): boolean {
  let any = false;
  for (const poly of area) {
    const outer = poly[0];
    if (!outer) continue;
    // cheap visibility test on the outer ring's bounding box
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const pts = outer.map(([lng, lat]) => project({ lat, lng }, off));
    for (const p of pts) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
    if (x1 < -4 || x0 > w + 4 || y1 < -4 || y0 > h + 4) continue;
    any = true;
    for (let ri = 0; ri < poly.length; ri++) {
      const rp = ri === 0 ? pts : poly[ri].map(([lng, lat]) => project({ lat, lng }, off));
      rp.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
      g.closePath();
    }
  }
  return any;
}

const DASH: Record<RegionLayer['borderStyle'], number[]> = { solid: [], dashed: [7, 4], dotted: [1.5, 3.5], none: [] };

export function regionColor(ix: LayerIndex, layer: RegionLayer, r: Region, day: number): string {
  if (layer.type === 'political' && layer.colorBy !== 'own') {
    const chain = ix.chain(r.id, day);
    return chain[chain.length - 1]?.region.color ?? r.color;
  }
  return r.color;
}

let scratch: HTMLCanvasElement | null = null;
let maskCanvas: HTMLCanvasElement | null = null;

/** Draw every visible region layer. Returns label boxes so other labels can avoid them later. */
export function drawRegionLayers(g: CanvasRenderingContext2D, o: RegionRenderOpts) {
  // The target's own scale: the screen's pixel ratio, or more for a sharp export (MK-14).
  const dpr = g.getTransform().a || window.devicePixelRatio || 1;
  if (!scratch) scratch = document.createElement('canvas');
  if (scratch.width !== Math.round(o.w * dpr) || scratch.height !== Math.round(o.h * dpr)) {
    scratch.width = Math.round(o.w * dpr);
    scratch.height = Math.round(o.h * dpr);
  }
  const sg = scratch.getContext('2d')!;
  const offs = shapeOffsets(o.offsets);
  // The land mask is built once per frame, then used to clip each layer that stops at the coast.
  let maskReady = false;
  const landMask = () => {
    if (!maskCanvas) maskCanvas = document.createElement('canvas');
    if (!maskReady) {
      maskCanvas.width = scratch!.width;
      maskCanvas.height = scratch!.height;
      const mg = maskCanvas.getContext('2d')!;
      mg.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawLandMask(mg, o.reader!, o);
      maskReady = true;
    }
    return maskCanvas;
  };
  const labels: { text: string; at: { x: number; y: number }; size: number; color: string; caps: boolean }[] = [];

  for (const layer of o.ix.layers) {
    if (!layer.visible) continue;
    const regions = o.ix.regionsOf(layer.id);
    if (!regions.length) continue;
    sg.setTransform(dpr, 0, 0, dpr, 0, 0);
    sg.clearRect(0, 0, o.w, o.h);
    sg.lineJoin = 'round';
    let drew = false;
    for (const r of regions) {
      const v = o.ix.versionAt(r, o.day);
      if (!v || !v.area.length) continue;
      const color = regionColor(o.ix, layer, r, o.day);
      const strength = (v.intensity ?? 100) / 100;
      const isTop = layer.type !== 'political' || o.ix.chain(r.id, o.day).length === 1;
      for (const off of offs) {
        sg.beginPath();
        if (!tracePath(sg, v.area, o.project, off, o.w, o.h)) continue;
        drew = true;
        if (layer.fill !== 'none') {
          sg.globalAlpha = Math.min(1, layer.opacity * (0.25 + 0.75 * strength) * (o.activeLayer === layer.id ? 1.15 : 1));
          if (layer.fill === 'hatch') {
            sg.fillStyle = sg.createPattern(hatchTile(color), 'repeat')!;
            sg.fill('evenodd');
            sg.globalAlpha *= 0.35;
            sg.fillStyle = color;
          } else sg.fillStyle = color;
          sg.fill('evenodd');
        }
        if (layer.borderStyle !== 'none' || o.selected === r.id) {
          sg.globalAlpha = Math.min(1, 0.55 + 0.45 * strength);
          sg.setLineDash(DASH[layer.borderStyle]);
          sg.strokeStyle = shade(color, -0.35);
          sg.lineWidth = layer.type === 'political' ? (isTop ? 2.2 : 1) : 1.4;
          if (layer.borderStyle !== 'none') sg.stroke();
          sg.setLineDash([]);
        }
      }
      if (layer.labels && o.labels && (layer.type !== 'political' || isTop || o.scale > 30)) {
        const lp = cachedLabel(v.area);
        if (lp) {
          const widthPx = lp.widthDeg * o.scale;
          const size = Math.max(10, Math.min(layer.type === 'political' && isTop ? 26 : 18, widthPx / Math.max(4, r.name.length * 0.75)));
          if (widthPx > 40 && lp.heightDeg * o.scale > 14) {
            for (const off of offs) {
              const at = o.project(lp.at, off);
              if (at.x < -200 || at.x > o.w + 200 || at.y < -20 || at.y > o.h + 20) continue;
              labels.push({ text: r.name, at, size, color: shade(color, -0.5), caps: layer.type === 'political' && isTop });
            }
          }
        }
      }
    }
    if (!drew) continue;
    sg.globalAlpha = 1;
    if (layer.onlyOnLand && o.reader) {
      sg.save();
      sg.setTransform(1, 0, 0, 1, 0, 0);
      sg.globalCompositeOperation = 'destination-in';
      sg.drawImage(landMask(), 0, 0);
      sg.restore();
    }
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(scratch, 0, 0);
    g.restore();
  }

  // borders that just changed glow for a moment (LY-6 "scrubbing animates conquests")
  if (o.flash && o.flash.strength > 0) {
    g.save();
    for (const id of o.flash.ids) {
      const r = o.ix.regions.get(id);
      const v = r && o.ix.versionAt(r, o.day);
      if (!v) continue;
      for (const off of offs) {
        g.beginPath();
        if (!tracePath(g, v.area, o.project, off, o.w, o.h)) continue;
        g.globalAlpha = o.flash.strength;
        g.strokeStyle = '#ffd166'; g.lineWidth = 7; g.stroke();
        g.strokeStyle = '#b5562c'; g.lineWidth = 2; g.stroke();
        g.globalAlpha = o.flash.strength * 0.25;
        g.fillStyle = '#ffd166'; g.fill('evenodd');
      }
    }
    g.restore();
  }

  // selection outline on top, never clipped
  if (o.selected) {
    const r = o.ix.regions.get(o.selected);
    const v = r && o.ix.versionAt(r, o.day);
    if (v) {
      g.save();
      for (const off of offs) {
        g.beginPath();
        if (!tracePath(g, v.area, o.project, off, o.w, o.h)) continue;
        g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 5; g.stroke();
        g.strokeStyle = '#b5562c'; g.lineWidth = 2.5; g.setLineDash([8, 5]); g.stroke(); g.setLineDash([]);
      }
      g.restore();
    }
  }

  // labels last, so fills never cover them
  g.save();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // Labels never sit on top of each other: try just below or above, else leave it out.
  const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
  for (const l of labels) {
    g.font = `${l.caps ? '600 ' : 'italic '}${Math.round(l.size)}px Georgia, 'Times New Roman', serif`;
    const text = l.caps ? l.text.toUpperCase().split('').join('\u200a') : l.text;
    const tw = g.measureText(text).width;
    let spot: { x0: number; x1: number; y0: number; y1: number } | null = null;
    for (const dy of [0, l.size * 1.6, -l.size * 1.6, l.size * 3.2, -l.size * 3.2]) {
      const r = { x0: l.at.x - tw / 2 - 3, x1: l.at.x + tw / 2 + 3, y0: l.at.y + dy - l.size * 0.65, y1: l.at.y + dy + l.size * 0.65 };
      if (!placed.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0)) { spot = r; break; }
    }
    if (!spot) continue;
    placed.push(spot);
    l.at = { x: l.at.x, y: (spot.y0 + spot.y1) / 2 };
    g.lineWidth = 3;
    g.strokeStyle = o.bg;
    g.globalAlpha = 0.85;
    g.strokeText(text, l.at.x, l.at.y);
    g.globalAlpha = 1;
    g.fillStyle = l.color;
    g.fillText(text, l.at.x, l.at.y);
  }
  g.restore();
}

const labelCache = new WeakMap<GeoMultiPolygon, ReturnType<typeof labelPoint>>();
function cachedLabel(a: GeoMultiPolygon) {
  if (!labelCache.has(a)) labelCache.set(a, labelPoint(a));
  return labelCache.get(a)!;
}

/** Darken (negative) or lighten (positive) a hex colour. */
export function shade(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = (c: number) => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
