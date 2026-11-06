/**
 * MK-14: the map as SVG. Painted terrain and region fills come as one embedded picture; rivers,
 * roads, areas, region borders, places, labels and the scale bar are vectors, so they stay sharp
 * and can be edited in a drawing program.
 */
import { Id, LatLng, LayerIndex, MapFeature, Place, featureAnchor, labelPoint } from '../../core';
import { areaSpine, labelPath, projectLine, riverWidth, smoothLine } from './featureRender';

type Project = (p: LatLng, o: number) => { x: number; y: number };

export interface SvgMapInput {
  w: number;
  h: number;
  /** PNG data URL of terrain + region fills. */
  base: string;
  project: Project;
  offsets: number[];
  scale: number;
  features: MapFeature[];
  flows: Map<Id, number[]>;
  places: { p: Place; icon: string; size: number }[];
  lix: LayerIndex;
  day: number;
  labels: boolean;
  serif: string;
  sans: string;
  kmPerPx: number;
  title: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const f1 = (n: number) => (Math.round(n * 10) / 10).toString();
const d = (pts: { x: number; y: number }[], close = false) => pts.map((p, i) => `${i ? 'L' : 'M'}${f1(p.x)} ${f1(p.y)}`).join('') + (close ? 'Z' : '');
const onScreen = (pts: { x: number; y: number }[], w: number, h: number) => pts.some((p) => p.x > -200 && p.x < w + 200 && p.y > -200 && p.y < h + 200);

const AREA: Record<string, { fill: string; stroke: string; dash?: string }> = {
  lake: { fill: 'rgb(120,170,200)', stroke: '#4f6672' },
  sea: { fill: 'rgba(120,170,200,0.55)', stroke: '#4f6672', dash: '6 4' },
  mountains: { fill: 'rgba(150,120,90,0.12)', stroke: '#7a5c3e', dash: '6 4' },
  forest: { fill: 'rgba(60,120,60,0.15)', stroke: '#3f6e3f', dash: '6 4' },
  desert: { fill: 'rgba(220,190,120,0.2)', stroke: '#a3824a', dash: '6 4' },
  swamp: { fill: 'rgba(100,130,90,0.2)', stroke: '#5d7350', dash: '3 3' },
  other: { fill: 'rgba(120,120,120,0.1)', stroke: '#666', dash: '4 4' },
};
const LINE: Record<string, { color: string; width: number; dash?: string; casing?: string }> = {
  road: { color: '#8a5a32', width: 2, casing: 'rgba(255,248,235,0.85)' },
  'trade-route': { color: '#c9781c', width: 2, dash: '2 5' },
  'sea-lane': { color: '#2f4f7a', width: 1.6, dash: '8 5' },
  wall: { color: '#3b3530', width: 3.2, dash: '7 2' },
};

export function mapToSvg(m: SvgMapInput): string {
  const out: string[] = [];
  const defs: string[] = [];
  let pathN = 0;
  out.push(`<image href="${m.base}" x="0" y="0" width="${m.w}" height="${m.h}" preserveAspectRatio="none"/>`);

  // region borders on the date, as vectors over the painted fills
  const borders: string[] = [];
  const regionLabels: string[] = [];
  for (const layer of m.lix.layers) {
    if (!layer.visible) continue;
    // Borders that stop at the coast are already in the painted picture, clipped to the land.
    const vectorBorders = !layer.onlyOnLand;
    for (const r of m.lix.regionsOf(layer.id)) {
      if (!m.lix.exists(r, m.day)) continue;
      const v = m.lix.versionAt(r, m.day);
      if (!v || !v.area.length) continue;
      for (const o of m.offsets) {
        const rings = v.area.flatMap((poly) => poly.map((ring) => ring.map(([lng, lat]) => m.project({ lat, lng }, o))));
        if (!rings.some((ring) => onScreen(ring, m.w, m.h))) continue;
        if (vectorBorders) borders.push(`<path d="${rings.map((ring) => d(ring, true)).join('')}" fill="none" stroke="${r.color}" stroke-width="${layer.type === 'political' ? 1.8 : 1.2}"${layer.borderStyle === 'none' ? ' stroke-opacity="0"' : ''}${layer.borderStyle === 'dashed' ? ' stroke-dasharray="6 4"' : layer.borderStyle === 'dotted' ? ' stroke-dasharray="1.5 3"' : ''} stroke-linejoin="round" opacity="0.9"/>`);
        if (m.labels && layer.labels !== false) {
          const lp = labelPoint(v.area);
          if (lp) {
            const p = m.project(lp.at, o);
            if (p.x > 0 && p.x < m.w && p.y > 0 && p.y < m.h) {
              const size = Math.max(10, Math.min(24, lp.widthDeg * m.scale * 0.05 + 8));
              regionLabels.push(`<text x="${f1(p.x)}" y="${f1(p.y)}" font-family="${esc(m.serif)}" font-size="${f1(size)}" font-weight="600" letter-spacing="${f1(size * 0.15)}" text-anchor="middle" dominant-baseline="middle" fill="${r.color}" stroke="#fff" stroke-width="3" stroke-opacity="0.7" paint-order="stroke">${esc(layer.type === 'political' ? r.name.toUpperCase() : r.name)}</text>`);
            }
          }
        }
      }
    }
  }
  out.push(`<g id="region-borders">${borders.join('')}</g>`);

  // features: areas, then lines
  const areas: string[] = [], lines: string[] = [], labels: string[] = [];
  const ordered = [...m.features.filter((f) => f.shape === 'area'), ...m.features.filter((f) => f.shape === 'line')];
  for (const f of ordered) {
    if (f.points.length < 2) continue;
    for (const o of m.offsets) {
      const raw = projectLine(f.points, m.project, o);
      if (!onScreen(raw, m.w, m.h)) continue;
      if (f.shape === 'area') {
        const st = AREA[f.kind] ?? AREA.other;
        areas.push(`<path d="${d(raw, true)}" fill="${st.fill}" stroke="${st.stroke}" stroke-width="1.3"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''}/>`);
      } else if (f.kind === 'river') {
        const pts = f.auto ? smoothLine(raw) : raw;
        const fl = m.flows.get(f.id);
        const up = fl ? fl[fl.length - 1] : 0;
        // Width grows downstream: a few pieces, each a little wider.
        const pieces = Math.min(6, Math.max(1, Math.floor(pts.length / 3)));
        for (let k = 0; k < pieces; k++) {
          const a = Math.floor((k * (pts.length - 1)) / pieces), b = Math.floor(((k + 1) * (pts.length - 1)) / pieces);
          const share = fl ? fl[Math.min(fl.length - 1, Math.round(((k + 0.5) / pieces) * (fl.length - 1)))] : up;
          lines.push(`<path d="${d(pts.slice(a, b + 1))}" fill="none" stroke="#3f7fb0" stroke-width="${f1(riverWidth(share, m.scale))}" stroke-linecap="round" stroke-linejoin="round"/>`);
        }
      } else {
        const st = LINE[f.kind] ?? LINE.road;
        if (st.casing) lines.push(`<path d="${d(raw)}" fill="none" stroke="${st.casing}" stroke-width="${st.width + 2.5}" stroke-linecap="round" stroke-linejoin="round"/>`);
        lines.push(`<path d="${d(raw)}" fill="none" stroke="${st.color}" stroke-width="${st.width}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ''} stroke-linecap="round" stroke-linejoin="round"/>`);
      }
      if (!m.labels || !f.name) continue;
      // MK-11: text on a path for rivers and long areas
      const water = f.kind === 'river' || f.kind === 'lake' || f.kind === 'sea';
      const color = water ? '#24577f' : f.kind === 'mountains' ? '#5b4630' : '#333';
      let along: { x: number; y: number }[] | null = null;
      let size = 12;
      if (f.kind === 'river') {
        along = f.auto ? smoothLine(raw) : raw;
        const fl = m.flows.get(f.id);
        size = Math.round(Math.min(18, 10 + Math.sqrt(fl ? fl[fl.length - 1] : 0) / 5));
      } else if (f.shape === 'area' && f.kind !== 'lake') {
        const sp = areaSpine(raw);
        if (sp && sp.aspect > 1.5) { along = sp.pts; size = 14; }
      }
      if (along && along.length > 1) {
        along = labelPath(along, size * 2);
        if (along[along.length - 1].x < along[0].x) along = [...along].reverse();
        const id = `lbl${++pathN}`;
        defs.push(`<path id="${id}" d="${d(along)}"/>`);
        const text = f.kind === 'mountains' ? f.name.toUpperCase() : f.name;
        labels.push(`<text font-family="${esc(m.serif)}" font-size="${size}" font-style="${f.kind === 'mountains' ? 'normal' : 'italic'}"${f.kind === 'mountains' ? ` font-weight="600" letter-spacing="${f1(size * 0.35)}"` : ''} fill="${color}" stroke="#fff" stroke-width="3" stroke-opacity="0.8" paint-order="stroke" dy="${f.kind === 'river' ? -4 : 0}"><textPath href="#${id}" startOffset="50%" text-anchor="middle">${esc(text)}</textPath></text>`);
      } else {
        const a = featureAnchor(f);
        if (!a) continue;
        const p = m.project(a, o);
        labels.push(`<text x="${f1(p.x)}" y="${f1(p.y - (f.shape === 'line' ? 9 : 0))}" font-family="${esc(m.serif)}" font-size="12" font-style="italic" text-anchor="middle" dominant-baseline="middle" fill="${color}" stroke="#fff" stroke-width="3" stroke-opacity="0.8" paint-order="stroke">${esc(f.name)}</text>`);
      }
    }
  }
  out.push(`<g id="areas">${areas.join('')}</g>`, `<g id="rivers-roads">${lines.join('')}</g>`);

  // places
  const pl: string[] = [];
  for (const { p, icon, size } of m.places) {
    for (const o of m.offsets) {
      const s = m.project(p.location!, o);
      if (s.x < -50 || s.x > m.w + 50 || s.y < -20 || s.y > m.h + 20) continue;
      pl.push(`<text x="${f1(s.x)}" y="${f1(s.y)}" font-family="${esc(m.sans)}" font-size="${size}" text-anchor="middle" dominant-baseline="middle" fill="#222">${esc(icon)}</text>`);
      if (m.labels) {
        const big = p.kind === 'city' || p.kind === 'capital';
        pl.push(`<text x="${f1(s.x + 9)}" y="${f1(s.y)}" font-family="${esc(m.sans)}" font-size="${p.kind === 'capital' ? 14 : 12}"${big ? ' font-weight="bold"' : ''} dominant-baseline="middle" fill="#222" stroke="#fff" stroke-width="3" paint-order="stroke">${esc(p.name)}</text>`);
      }
    }
  }
  out.push(`<g id="places">${pl.join('')}</g>`, `<g id="labels">${regionLabels.join('')}${labels.join('')}</g>`);

  // scale bar
  const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
  const km = nice.find((n) => n / m.kmPerPx > 80) ?? 10000;
  const px = km / m.kmPerPx;
  out.push(`<g id="scale"><rect x="${f1(m.w - px - 30)}" y="${m.h - 34}" width="${f1(px + 20)}" height="24" fill="#fff" opacity="0.8"/><line x1="${f1(m.w - px - 20)}" y1="${m.h - 16}" x2="${m.w - 20}" y2="${m.h - 16}" stroke="#222" stroke-width="2"/><text x="${f1(m.w - 20 - px / 2)}" y="${m.h - 21}" font-family="${esc(m.sans)}" font-size="11" text-anchor="middle" fill="#222">${km.toLocaleString('en')} km</text></g>`);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${m.w}" height="${m.h}" viewBox="0 0 ${m.w} ${m.h}">
<title>${esc(m.title)}</title>
<defs>${defs.join('')}</defs>
${out.join('\n')}
</svg>
`;
}
