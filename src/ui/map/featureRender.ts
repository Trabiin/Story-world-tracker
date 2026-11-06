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
  opts: { offsets: number[]; project: Project; scale: number; flows: Map<Id, number[]>; selected?: Id; labels: boolean; fg: string; bg: string; w: number; h: number; serif?: string },
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
  // labels (MK-11): rivers curve along their course and mountain ranges along their spine, sized by importance
  if (opts.labels) {
    const serif = opts.serif ?? 'Georgia, serif';
    for (const f of features) {
      if (!f.name || f.points.length < 2) continue;
      for (const o of opts.offsets) {
        const raw = projectLine(f.points, opts.project, o);
        if (!onScreen(raw)) continue;
        const water = f.kind === 'river' || f.kind === 'lake' || f.kind === 'sea';
        const color = water ? '#24577f' : f.kind === 'mountains' ? '#5b4630' : opts.fg;
        if (f.kind === 'river') {
          const pts = f.auto ? smoothLine(raw) : raw;
          const fl = opts.flows.get(f.id);
          const up = fl ? fl[fl.length - 1] : 0;
          const size = Math.round(Math.min(18, 10 + Math.sqrt(up) / 5));
          const width = riverWidth(up, opts.scale);
          const stretch = longestVisible(pts, opts.w, opts.h);
          if (!curvedLabel(g, f.name, stretch, { font: `italic ${size}px ${serif}`, color, halo: opts.bg, lift: width / 2 + size * 0.55, spacing: 0.5 })) {
            straightLabel(g, f.name, opts.project(featureAnchor(f)!, o), `italic 12px ${serif}`, color, opts.bg, -9);
          }
        } else if (f.shape === 'area') {
          const spine = areaSpine(raw);
          const areaPx = Math.abs(polyArea(raw));
          if (spine && f.kind !== 'lake' && spine.aspect > 1.5) {
            const size = Math.round(Math.max(11, Math.min(26, Math.sqrt(areaPx) / 9)));
            const upper = f.kind === 'mountains' ? f.name.toUpperCase() : f.name;
            if (curvedLabel(g, upper, spine.pts, { font: `${f.kind === 'mountains' ? '600' : 'italic'} ${size}px ${serif}`, color, halo: opts.bg, lift: 0, spacing: f.kind === 'mountains' ? size * 0.35 : 0.5 })) continue;
          }
          const a = featureAnchor(f);
          if (a) straightLabel(g, f.name, opts.project(a, o), `italic ${Math.round(Math.max(11, Math.min(18, Math.sqrt(areaPx) / 10)))}px ${serif}`, color, opts.bg, 0);
        } else {
          const a = featureAnchor(f);
          if (a) straightLabel(g, f.name, opts.project(a, o), `italic 12px ${serif}`, color, opts.bg, -9);
        }
      }
    }
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

type Pt = { x: number; y: number };

function straightLabel(g: CanvasRenderingContext2D, text: string, p: Pt, font: string, color: string, halo: string, dy: number) {
  g.save();
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 3;
  g.strokeStyle = halo;
  g.globalAlpha = 0.8;
  g.strokeText(text, p.x, p.y + dy);
  g.globalAlpha = 1;
  g.fillStyle = color;
  g.fillText(text, p.x, p.y + dy);
  g.restore();
}

function polyArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  return a / 2;
}

/** The longest run of a line that is on screen. */
function longestVisible(pts: Pt[], w: number, h: number): Pt[] {
  let best: Pt[] = [], cur: Pt[] = [];
  const len = (l: Pt[]) => l.reduce((s, p, i) => (i ? s + Math.hypot(p.x - l[i - 1].x, p.y - l[i - 1].y) : 0), 0);
  for (const p of pts) {
    if (p.x > 10 && p.x < w - 10 && p.y > 10 && p.y < h - 10) cur.push(p);
    else { if (len(cur) > len(best)) best = cur; cur = []; }
  }
  return len(cur) > len(best) ? cur : best;
}

/**
 * A curved line through the middle of an area, along its longest direction: the area's points are
 * binned along their main axis and the middle of each bin is joined up.
 */
export function areaSpine(pts: Pt[]): { pts: Pt[]; aspect: number } | null {
  if (pts.length < 3) return null;
  const n = pts.length;
  const cx = pts.reduce((s, p) => s + p.x, 0) / n, cy = pts.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) { const dx = p.x - cx, dy = p.y - cy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(ang), uy = Math.sin(ang);
  const along = pts.map((p) => (p.x - cx) * ux + (p.y - cy) * uy);
  const across = pts.map((p) => -(p.x - cx) * uy + (p.y - cy) * ux);
  const lo = Math.min(...along), hi = Math.max(...along);
  const wid = Math.max(...across) - Math.min(...across);
  if (hi - lo < 30) return null;
  const B = 6;
  const out: Pt[] = [];
  for (let b = 0; b < B; b++) {
    // the middle of the area's cross-section at this point along the axis
    const t = lo + ((b + 0.5) / B) * (hi - lo);
    const ys: number[] = [];
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const a0 = along[j], a1 = along[i];
      if ((a0 <= t) !== (a1 <= t)) ys.push(across[j] + ((t - a0) / (a1 - a0)) * (across[i] - across[j]));
    }
    if (ys.length < 2) continue;
    const mid = (Math.min(...ys) + Math.max(...ys)) / 2;
    out.push({ x: cx + t * ux - mid * uy, y: cy + t * uy + mid * ux });
  }
  if (out.length < 2) return null;
  return { pts: smoothLine(out, 2), aspect: (hi - lo) / Math.max(1, wid) };
}

/** A calm version of a wiggly line for text to sit on: evenly spaced points, averaged over a window. */
export function labelPath(path: Pt[], radiusPx: number, stepPx = 4): Pt[] {
  if (path.length < 2) return path;
  const even: Pt[] = [path[0]];
  let carry = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    let d = stepPx - carry;
    while (d <= L) { even.push({ x: a.x + ((b.x - a.x) * d) / L, y: a.y + ((b.y - a.y) * d) / L }); d += stepPx; }
    carry = L - (d - stepPx);
  }
  even.push(path[path.length - 1]);
  const k = Math.max(1, Math.round(radiusPx / stepPx));
  let cur = even;
  for (let pass = 0; pass < 2; pass++) {
    cur = cur.map((_, i) => {
      let x = 0, y = 0, n = 0;
      for (let j = Math.max(0, i - k); j <= Math.min(cur.length - 1, i + k); j++) { x += cur[j].x; y += cur[j].y; n++; }
      return { x: x / n, y: y / n };
    });
  }
  return cur;
}

/** Text set letter by letter along a path, kept upright. Returns false when the path is too short. */
export function curvedLabel(g: CanvasRenderingContext2D, text: string, path: Pt[], o: { font: string; color: string; halo: string; lift: number; spacing: number }): boolean {
  if (path.length < 2) return false;
  const size = Number(/(\d+)px/.exec(o.font)?.[1] ?? 12);
  let pts = labelPath(path, size * 2);
  if (pts[pts.length - 1].x < pts[0].x) pts = [...pts].reverse(); // read left to right
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = cum[cum.length - 1];
  g.save();
  g.font = o.font;
  const widths = [...text].map((c) => g.measureText(c).width + o.spacing);
  const tw = widths.reduce((a, b) => a + b, 0);
  if (tw > total * 0.92) { g.restore(); return false; }
  const at = (d: number) => {
    d = Math.max(0, Math.min(total, d));
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const t = (d - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
    return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
  };
  const angleAt = (d: number) => {
    const span = Math.max(6, widths[0] * 1.5);
    const a = at(d - span), b = at(d + span);
    return Math.atan2(b.y - a.y, b.x - a.x);
  };
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  let d = (total - tw) / 2;
  const glyphs: { c: string; x: number; y: number; a: number }[] = [];
  [...text].forEach((c, k) => {
    const mid = d + widths[k] / 2;
    const p = at(mid), a = angleAt(mid);
    glyphs.push({ c, x: p.x + Math.sin(a) * o.lift, y: p.y - Math.cos(a) * o.lift, a });
    d += widths[k];
  });
  for (const pass of [0, 1]) {
    for (const gl of glyphs) {
      g.save();
      g.translate(gl.x, gl.y);
      g.rotate(gl.a);
      if (pass === 0) { g.lineWidth = 3; g.strokeStyle = o.halo; g.globalAlpha = 0.8; g.strokeText(gl.c, 0, 0); }
      else { g.fillStyle = o.color; g.fillText(gl.c, 0, 0); }
      g.restore();
    }
  }
  g.restore();
  return true;
}
