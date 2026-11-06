/** Drawing map features (MP-6, MP-7, MK-8, MK-9) and finding the one under the pointer. */
import { featureAnchor, type AreaKind, type Id, type LatLng, type LineKind, type MapFeature } from '../../core';

export const LINE_KINDS: { kind: LineKind; name: string }[] = [
  { kind: 'road', name: 'Road' },
  { kind: 'trade-route', name: 'Trade route' },
  { kind: 'sea-lane', name: 'Sea lane' },
  { kind: 'wall', name: 'Wall' },
];
export const AREA_KINDS: { kind: AreaKind; name: string }[] = [
  { kind: 'mountains', name: 'Mountain range' },
  { kind: 'forest', name: 'Forest' },
  { kind: 'desert', name: 'Desert' },
  { kind: 'swamp', name: 'Swamp' },
  { kind: 'sea', name: 'Sea' },
  { kind: 'other', name: 'Other area' },
];
export const KIND_NAME: Record<string, string> = {
  river: 'River', lake: 'Lake', ...Object.fromEntries(LINE_KINDS.map((k) => [k.kind, k.name])), ...Object.fromEntries(AREA_KINDS.map((k) => [k.kind, k.name])),
};

const AREA_STYLE: Record<AreaKind, { fill: string; stroke: string; dash: number[] }> = {
  lake: { fill: 'rgb(120,170,200)', stroke: '#4f6672', dash: [] },
  sea: { fill: 'rgba(120,170,200,0.55)', stroke: '#4f6672', dash: [6, 4] },
  mountains: { fill: 'rgba(150,120,90,0.12)', stroke: '#7a5c3e', dash: [6, 4] },
  forest: { fill: 'rgba(60,120,60,0.15)', stroke: '#3f6e3f', dash: [6, 4] },
  desert: { fill: 'rgba(220,190,120,0.2)', stroke: '#a3824a', dash: [6, 4] },
  swamp: { fill: 'rgba(100,130,90,0.2)', stroke: '#5d7350', dash: [3, 3] },
  other: { fill: 'rgba(120,120,120,0.1)', stroke: '#666', dash: [4, 4] },
};

const LINE_STYLE: Record<Exclude<LineKind, 'river'>, { color: string; width: number; dash: number[]; casing?: string }> = {
  road: { color: '#8a5a32', width: 2, dash: [], casing: 'rgba(255,248,235,0.85)' },
  'trade-route': { color: '#c9781c', width: 2, dash: [2, 5] },
  'sea-lane': { color: '#2f4f7a', width: 1.6, dash: [8, 5] },
  wall: { color: '#3b3530', width: 3.2, dash: [7, 2] },
};

export const RIVER_COLOR = '#3f7fb0';

export interface ScreenShape {
  id: Id;
  shape: 'line' | 'area';
  pts: { x: number; y: number }[];
}

type Project = (p: LatLng, o: number) => { x: number; y: number };

/** Unwrap a polyline so it doesn't jump across the date line, then project it. */
export function projectLine(pts: LatLng[], project: Project, o: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  let prev: LatLng | null = null, shift = 0;
  for (const p of pts) {
    if (prev && Math.abs(p.lng - prev.lng) > 180) shift += p.lng < prev.lng ? 360 : -360;
    out.push(project({ lat: p.lat, lng: p.lng + shift }, o));
    prev = p;
  }
  return out;
}

/**
 * Round off the grid staircase of an automatic river for display (Chaikin corner cutting, twice).
 * Each output point carries the fractional index along the original line, for river widths.
 */
export function smoothLine(pts: { x: number; y: number }[], rounds = 2): { x: number; y: number; at: number }[] {
  let cur = pts.map((p, i) => ({ ...p, at: i }));
  for (let r = 0; r < rounds && cur.length > 2; r++) {
    const next = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) {
      const a = cur[i], b = cur[i + 1];
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25, at: a.at * 0.75 + b.at * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75, at: a.at * 0.25 + b.at * 0.75 });
    }
    next.push(cur[cur.length - 1]);
    cur = next;
  }
  return cur;
}

/** River width in pixels from upstream length (km) and zoom. */
export function riverWidth(upKm: number, scale: number): number {
  const z = Math.max(0.6, Math.min(2.2, scale / 25));
  return Math.min(9, (0.7 + Math.sqrt(upKm) / 11) * z);
}

export function drawFeatures(
  g: CanvasRenderingContext2D,
  features: MapFeature[],
  opts: { offsets: number[]; project: Project; scale: number; flows: Map<Id, number[]>; selected?: Id; labels: boolean; fg: string; bg: string; w: number; h: number },
): ScreenShape[] {
  const shapes: ScreenShape[] = [];
  const onScreen = (pts: { x: number; y: number }[]) => pts.some((p) => p.x > -200 && p.x < opts.w + 200 && p.y > -200 && p.y < opts.h + 200);
  // areas first, then lines on top
  const ordered = [...features.filter((f) => f.shape === 'area'), ...features.filter((f) => f.shape === 'line')];
  for (const f of ordered) {
    if (f.points.length < 2) continue;
    for (const o of opts.offsets) {
      const raw = projectLine(f.points, opts.project, o);
      const smooth = f.kind === 'river' && f.auto ? smoothLine(raw) : null;
      const pts = smooth ?? raw;
      if (!onScreen(pts)) continue;
      shapes.push({ id: f.id, shape: f.shape, pts });
      const sel = opts.selected === f.id;
      g.save();
      g.lineJoin = 'round';
      g.lineCap = 'round';
      if (f.shape === 'area') {
        const st = AREA_STYLE[f.kind as AreaKind] ?? AREA_STYLE.other;
        g.beginPath();
        pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
        g.closePath();
        g.fillStyle = st.fill;
        g.fill();
        g.setLineDash(st.dash);
        g.strokeStyle = sel ? '#b5562c' : st.stroke;
        g.lineWidth = sel ? 2.5 : 1.3;
        g.stroke();
      } else if (f.kind === 'river') {
        const fl = opts.flows.get(f.id);
        g.strokeStyle = sel ? '#b5562c' : RIVER_COLOR;
        // upstream length at a fractional index along the original vertices
        const flowAt = (at: number) => {
          if (!fl) return 0;
          const i = Math.min(fl.length - 2, Math.floor(at)), t = at - i;
          return fl.length < 2 ? fl[0] ?? 0 : fl[i] * (1 - t) + fl[i + 1] * t;
        };
        for (let i = 1; i < pts.length; i++) {
          const at = smooth ? (smooth[i - 1].at + smooth[i].at) / 2 : i - 0.5;
          g.lineWidth = riverWidth(flowAt(at), opts.scale) + (sel ? 1.5 : 0);
          g.beginPath();
          g.moveTo(pts[i - 1].x, pts[i - 1].y);
          g.lineTo(pts[i].x, pts[i].y);
          g.stroke();
        }
      } else {
        const st = LINE_STYLE[f.kind as Exclude<LineKind, 'river'>] ?? LINE_STYLE.road;
        const path = () => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); };
        if (st.casing) { path(); g.strokeStyle = st.casing; g.lineWidth = st.width + 2.5; g.stroke(); }
        path();
        g.setLineDash(st.dash);
        g.strokeStyle = sel ? '#b5562c' : st.color;
        g.lineWidth = st.width + (sel ? 1.5 : 0);
        g.stroke();
      }
      g.restore();
    }
  }
  // labels
  if (opts.labels) {
    g.save();
    g.font = 'italic 12px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 3;
    for (const f of features) {
      if (!f.name || f.points.length < 2) continue;
      const a = featureAnchor(f);
      if (!a) continue;
      for (const o of opts.offsets) {
        const p = opts.project(a, o);
        if (p.x < -50 || p.x > opts.w + 50 || p.y < -20 || p.y > opts.h + 20) continue;
        const color = f.kind === 'river' || f.kind === 'lake' || f.kind === 'sea' ? '#24577f' : opts.fg;
        g.strokeStyle = opts.bg;
        g.globalAlpha = 0.8;
        g.strokeText(f.name, p.x, p.y - (f.shape === 'line' ? 9 : 0));
        g.globalAlpha = 1;
        g.fillStyle = color;
        g.fillText(f.name, p.x, p.y - (f.shape === 'line' ? 9 : 0));
      }
    }
    g.restore();
  }
  return shapes;
}

function distToSeg(px: number, py: number, a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / L)) : 0;
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

/** The feature under a screen point: lines within 6 px, then areas containing it. */
export function hitFeature(shapes: ScreenShape[], x: number, y: number): Id | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (s.shape !== 'line') continue;
    for (let k = 1; k < s.pts.length; k++) if (distToSeg(x, y, s.pts[k - 1], s.pts[k]) <= 6) return s.id;
  }
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (s.shape !== 'area') continue;
    let inside = false;
    for (let a = 0, b = s.pts.length - 1; a < s.pts.length; b = a++) {
      const p = s.pts[a], q = s.pts[b];
      if ((p.y > y) !== (q.y > y) && x < ((q.x - p.x) * (y - p.y)) / (q.y - p.y) + p.x) inside = !inside;
    }
    if (inside) return s.id;
  }
  return null;
}
