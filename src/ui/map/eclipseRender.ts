/**
 * EC-6: eclipses on the map. The partial zone and the annular (or total) band on every date an eclipse
 * lasts, darker when the daily eclipse is longer, and optional shading for cooling or forest health.
 */
import { EffectGrid, GeoRing, Id, LatLng, World, densifyPath, eclipseRules, pathOutline, shadowEvents, shadowHours } from '../../core';

type Project = (p: LatLng, offset: number) => { x: number; y: number };

export type EffectShade = 'cooling' | 'forest';

export interface EclipseRenderOpts {
  world: World;
  day: number;
  offsets: number[];
  project: Project;
  w: number;
  h: number;
  /** The eclipse being drawn: shown with its draft track whatever the date. */
  draft?: { eventId: Id; track: LatLng[] };
  labels: boolean;
  fg: string;
  bg: string;
}

const outlines = new Map<string, GeoRing>();
function outline(track: LatLng[], widthKm: number, radiusKm: number): GeoRing {
  const key = `${radiusKm}|${widthKm}|${track.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join(';')}`;
  let r = outlines.get(key);
  if (!r) {
    r = pathOutline(track, widthKm, radiusKm);
    if (outlines.size > 200) outlines.clear();
    outlines.set(key, r);
  }
  return r;
}

function ringPath(g: CanvasRenderingContext2D, ring: GeoRing, project: Project, off: number) {
  ring.forEach(([lng, lat], i) => {
    const p = project({ lat, lng }, off);
    if (i) g.lineTo(p.x, p.y); else g.moveTo(p.x, p.y);
  });
  g.closePath();
}

function allOffsets(offsets: number[]): number[] {
  return [...new Set([offsets[0] - 360, ...offsets, offsets[offsets.length - 1] + 360])];
}

export function drawEclipses(g: CanvasRenderingContext2D, o: EclipseRenderOpts) {
  const R = o.world.settings.radiusKm;
  const rules = eclipseRules(o.world);
  const evs = shadowEvents(o.world).filter((e) => e.id !== o.draft?.eventId);
  const items: { name: string; kind: 'annular' | 'total'; track: LatLng[]; bandKm: number; partialKm: number; f: number; hours: number; draft: boolean }[] = [];
  for (const e of evs) {
    const hours = shadowHours(o.world, e, Math.floor(o.day));
    if (hours <= 0) continue;
    items.push({ name: e.name, kind: e.shadow.kind, track: e.shadow.track, bandKm: e.shadow.bandKm, partialKm: e.shadow.partialKm, hours, f: Math.min(1, hours / Math.max(0.5, rules.daylightHours)), draft: false });
  }
  if (o.draft) {
    const e = o.world.events.find((x) => x.id === o.draft!.eventId);
    if (e?.shadow && o.draft.track.length) items.push({ name: e.name, kind: e.shadow.kind, track: o.draft.track, bandKm: e.shadow.bandKm, partialKm: e.shadow.partialKm, hours: e.shadow.hours, f: 0.5, draft: true });
  }
  const offs = allOffsets(o.offsets);
  g.save();
  for (const it of items) {
    const partial = outline(it.track, Math.max(it.bandKm, it.partialKm), R);
    const band = outline(it.track, it.bandKm, R);
    for (const off of offs) {
      // partial zone: a soft dusk with a dashed edge
      g.beginPath(); ringPath(g, partial, o.project, off);
      g.fillStyle = `rgba(28,22,58,${0.08 + 0.17 * it.f})`;
      g.fill();
      g.setLineDash([7, 5]); g.lineWidth = 1.5; g.strokeStyle = 'rgba(28,22,58,0.55)'; g.stroke(); g.setLineDash([]);
      // the band: darker, with a ring-of-fire edge for an annular eclipse
      g.beginPath(); ringPath(g, band, o.project, off);
      g.fillStyle = `rgba(20,14,40,${0.22 + 0.4 * it.f})`;
      g.fill();
      g.lineWidth = 2.5; g.strokeStyle = it.kind === 'annular' ? '#f0a33a' : '#1a1030'; g.stroke();
      // the centre line
      g.beginPath();
      (it.track.length > 1 ? densifyPath(it.track, 50, R) : it.track).forEach((p, i) => { const s = o.project(p, off); if (i) g.lineTo(s.x, s.y); else g.moveTo(s.x, s.y); });
      g.setLineDash(it.draft ? [] : [2, 4]); g.lineWidth = it.draft ? 2 : 1.2; g.strokeStyle = it.kind === 'annular' ? '#ffd27a' : '#ffffff'; g.stroke(); g.setLineDash([]);
      if (it.draft) for (const p of it.track) { const s = o.project(p, off); g.beginPath(); g.arc(s.x, s.y, 4, 0, Math.PI * 2); g.fillStyle = '#f0a33a'; g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke(); }
    }
    if (o.labels && it.track.length) {
      // a quarter of the way along, so the label stays clear of the places in the middle
      const line = it.track.length > 1 ? densifyPath(it.track, 25, R) : it.track;
      const at = line[Math.floor((line.length - 1) / 4)];
      const text = `☀ ${it.name} · ${it.kind} · ${fmtHours(it.hours)} a day`;
      g.font = '600 12px system-ui, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const off of o.offsets) {
        const s = o.project(at, off);
        if (s.x < -200 || s.x > o.w + 200 || s.y < -20 || s.y > o.h + 20) continue;
        g.lineWidth = 4; g.strokeStyle = 'rgba(20,14,40,0.85)'; g.strokeText(text, s.x, s.y - 14);
        g.fillStyle = '#ffd27a'; g.fillText(text, s.x, s.y - 14);
      }
    }
  }
  g.restore();
}

export function fmtHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} min`;
  const whole = Math.floor(h), min = Math.round((h - whole) * 60);
  return min ? `${whole} h ${min} min` : `${whole} h`;
}

/** EC-6: shading for cooling (blue) or forest health (brown), smoothed between cells. */
const shadeCache = new WeakMap<EffectGrid, Map<string, HTMLCanvasElement>>();
function shadeImage(grid: EffectGrid, shade: EffectShade, maxCoolingC: number): HTMLCanvasElement {
  let m = shadeCache.get(grid);
  if (!m) { m = new Map(); shadeCache.set(grid, m); }
  const key = `${shade}|${maxCoolingC}`;
  let c = m.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = grid.cols; c.height = grid.rows;
  const g = c.getContext('2d')!;
  const img = g.createImageData(grid.cols, grid.rows);
  const [r0, g0, b0] = shade === 'cooling' ? [40, 110, 220] : [120, 72, 20];
  grid.cells.forEach((e, i) => {
    if (!e) return;
    const v = shade === 'cooling' ? Math.min(1, -e.coolingC / Math.max(1, maxCoolingC)) : (100 - e.forest) / 100;
    if (v <= 0.01) return;
    img.data[i * 4] = r0; img.data[i * 4 + 1] = g0; img.data[i * 4 + 2] = b0;
    img.data[i * 4 + 3] = Math.round(255 * (0.15 + 0.6 * Math.min(1, v)));
  });
  g.putImageData(img, 0, 0);
  m.set(key, c);
  return c;
}

export function drawEffectGrid(g: CanvasRenderingContext2D, grid: EffectGrid, shade: EffectShade, maxCoolingC: number, offsets: number[], project: Project) {
  const img = shadeImage(grid, shade, maxCoolingC);
  g.save();
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  for (const off of allOffsets(offsets)) {
    const a = project({ lat: grid.north, lng: grid.west }, off);
    const b = project({ lat: grid.north - grid.rows * grid.cellDeg, lng: grid.west + grid.cols * grid.cellDeg }, off);
    g.drawImage(img, a.x, a.y, b.x - a.x, b.y - a.y);
  }
  g.restore();
}
