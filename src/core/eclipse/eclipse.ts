/**
 * EC-1..EC-8: long eclipses. Where the shadow falls, how long the daily eclipse lasts, what the
 * sun, moons and world imply, and what years of lost light do to temperature and forests.
 *
 * No orbital physics: the writer draws the path and sets the widths and hours (a god aims the moon).
 * The effects are simple rules the writer can adjust (EclipseRules), cheap enough to run for any
 * place and date instantly.
 */
import { toWindow } from '../dates';
import type { GeoRing, EclipseRules, EclipseShadow, Id, SkyBodies, SkyMoon, World, WorldEvent } from '../model';
import { eventWindow } from '../events/events';
import type { LatLng } from '../globe';

const RAD = Math.PI / 180;

export const DEFAULT_ECLIPSE_RULES: EclipseRules = {
  daylightHours: 12,
  coolingC: 25,
  settleDays: 90,
  forestLightTolerance: 10,
  forestColdTolerance: 3,
  forestDeclinePerYear: 4,
  forestRecoveryPerYear: 5,
};

export function eclipseRules(world: World): EclipseRules {
  return { ...DEFAULT_ECLIPSE_RULES, ...(world.settings.eclipseRules ?? {}) };
}

export function newShadow(): EclipseShadow {
  return { kind: 'annular', track: [], bandKm: 400, partialKm: 2000, hours: 1, steps: [] };
}

/** Events with a drawn shadow path. */
export function shadowEvents(world: World): (WorldEvent & { shadow: EclipseShadow })[] {
  return world.events.filter((e): e is WorldEvent & { shadow: EclipseShadow } => !!e.shadow && e.shadow.track.length >= 1 && !!e.start);
}

// ---------------------------------------------------------------- the sky (EC-3)

export interface MoonFacts {
  moon: SkyMoon;
  /** Apparent diameter seen from the ground under it, degrees. */
  diameterDeg: number;
  /** Moon diameter ÷ sun diameter. */
  ratio: number;
  kind: 'total' | 'annular';
  /** Share of the sun's light covered at the centre, 0–100. */
  coverage: number;
  /** Natural width of the total or annular band, km. */
  bandKm: number;
  /** Natural width of the partial zone, km; Infinity = the whole sunlit side. */
  partialKm: number;
}

export interface SkyFacts {
  sunDiameterDeg: number;
  moons: MoonFacts[];
}

/** EC-3: what the sizes and distances imply. Straight-line shadow cones; the curve of the ground is ignored. */
export function skyFacts(sky: SkyBodies, planetRadiusKm: number): SkyFacts {
  const Rs = sky.sunRadiusKm, Ds = sky.sunDistanceKm;
  const sunDiameterDeg = (2 * Math.asin(Math.min(1, Rs / Math.max(Rs, Ds - planetRadiusKm)))) / RAD;
  const moons = sky.moons.map((moon): MoonFacts => {
    const Rm = moon.radiusKm;
    const d = Math.max(Rm, moon.distanceKm - planetRadiusKm); // moon to the ground below it
    const diameterDeg = (2 * Math.asin(Math.min(1, Rm / d))) / RAD;
    const ratio = sunDiameterDeg > 0 ? diameterDeg / sunDiameterDeg : 0;
    const L = Math.max(1, Ds - moon.distanceKm); // sun to moon
    const umbra = Rm - (d * (Rs - Rm)) / L; // < 0: the cone has ended, an antumbra (annular)
    const pen = Rm + (d * (Rs + Rm)) / L;
    const half = Math.PI * planetRadiusKm / 2;
    return {
      moon,
      diameterDeg,
      ratio,
      kind: ratio >= 1 ? 'total' : 'annular',
      coverage: Math.min(100, ratio * ratio * 100),
      bandKm: 2 * Math.abs(umbra),
      partialKm: pen >= half ? Infinity : 2 * pen,
    };
  });
  return { sunDiameterDeg, moons };
}

/** EC-3, EC-4: share of light blocked in the band, 0–1. */
export function shadowCoverage(world: World, s: EclipseShadow): number {
  if (s.coverage !== undefined) return Math.max(0, Math.min(100, s.coverage)) / 100;
  const sky = world.settings.sky;
  const moon = sky?.moons.find((m) => m.id === s.moonId) ?? sky?.moons[0];
  if (sky && moon) {
    const f = skyFacts({ ...sky, moons: [moon] }, world.settings.radiusKm).moons[0];
    return s.kind === 'total' ? 1 : Math.min(0.99, f.coverage / 100);
  }
  return s.kind === 'total' ? 1 : 0.81;
}

// ---------------------------------------------------------------- dates and hours (EC-2)

/** The days an eclipse lasts. */
export function shadowWindow(world: World, e: WorldEvent): { from: number; to: number } | undefined {
  const w = eventWindow(world, e);
  return w ? { from: w.earliest, to: w.latest } : undefined;
}

/** Hours of eclipse at the centre line on a day (0 outside the eclipse's dates). */
export function shadowHours(world: World, e: WorldEvent, day: number): number {
  const s = e.shadow;
  const w = shadowWindow(world, e);
  if (!s || !w || day < w.from || day > w.to) return 0;
  const h = world.settings.hemisphereForSeasons;
  const pts = [{ day: w.from, hours: s.hours }, ...s.steps.map((st) => ({ day: toWindow(st.from, h).earliest, hours: st.hours }))]
    .sort((a, b) => a.day - b.day);
  let i = 0;
  while (i + 1 < pts.length && pts[i + 1].day <= day) i++;
  const a = pts[i], b = pts[i + 1];
  const v = s.gradual && b && b.day > a.day ? a.hours + ((b.hours - a.hours) * (day - a.day)) / (b.day - a.day) : a.hours;
  return Math.max(0, Math.min(24, v));
}

// ---------------------------------------------------------------- geometry (EC-1)

type V3 = [number, number, number];
const vec = (p: LatLng): V3 => [Math.cos(p.lat * RAD) * Math.cos(p.lng * RAD), Math.cos(p.lat * RAD) * Math.sin(p.lng * RAD), Math.sin(p.lat * RAD)];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const angle = (a: V3, b: V3) => Math.atan2(Math.hypot(...cross(a, b)), dot(a, b));

/** Shortest distance on the globe from a point to a path (km); the path's ends are rounded. */
export function distanceToPathKm(p: LatLng, path: LatLng[], radiusKm: number): number {
  if (!path.length) return Infinity;
  const P = vec(p);
  let best = Infinity;
  for (let i = 0; i < path.length; i++) {
    const A = vec(path[i]);
    best = Math.min(best, angle(P, A));
    if (i + 1 >= path.length) continue;
    const B = vec(path[i + 1]);
    const n = cross(A, B);
    const len = Math.hypot(...n);
    if (len < 1e-12) continue;
    const N: V3 = [n[0] / len, n[1] / len, n[2] / len];
    // the foot of the perpendicular lies between A and B when it is on the inner side of both ends
    if (dot(cross(A, P), N) >= 0 && dot(cross(P, B), N) >= 0) best = Math.min(best, Math.abs(Math.asin(Math.max(-1, Math.min(1, dot(P, N))))));
  }
  return best * radiusKm;
}

function destination(p: LatLng, bearingRad: number, km: number, radiusKm: number): LatLng {
  const d = km / radiusKm, φ1 = p.lat * RAD, λ1 = p.lng * RAD;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(bearingRad));
  const λ2 = λ1 + Math.atan2(Math.sin(bearingRad) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: φ2 / RAD, lng: λ2 / RAD };
}

function bearing(a: LatLng, b: LatLng): number {
  const φ1 = a.lat * RAD, φ2 = b.lat * RAD, dλ = (b.lng - a.lng) * RAD;
  return Math.atan2(Math.sin(dλ) * Math.cos(φ2), Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ));
}

/** Points along the path no more than stepKm apart (great-circle pieces), as the centre line is drawn. */
export function densifyPath(path: LatLng[], stepKm: number, radiusKm: number): LatLng[] {
  const out: LatLng[] = [];
  for (let i = 0; i < path.length; i++) {
    if (i === 0) { out.push(path[0]); continue; }
    const a = path[i - 1], b = path[i];
    const km = angle(vec(a), vec(b)) * radiusKm;
    const n = Math.max(1, Math.ceil(km / stepKm));
    const br = bearing(a, b);
    for (let k = 1; k <= n; k++) out.push(k === n ? b : destination(a, br, (km * k) / n, radiusKm));
  }
  return out;
}

/** Keeps longitudes continuous (no jump at ±180) so the outline draws in one piece. */
function unwrap(ring: GeoRing): GeoRing {
  const out: GeoRing = [];
  for (const [x, y] of ring) {
    let lng = x;
    if (out.length) {
      const prev = out[out.length - 1][0];
      while (lng - prev > 180) lng -= 360;
      while (lng - prev < -180) lng += 360;
    }
    out.push([lng, y]);
  }
  return out;
}

/** EC-1, EC-6: the outline of everything within widthKm/2 of the path, with rounded ends, as a closed ring. */
export function pathOutline(path: LatLng[], widthKm: number, radiusKm: number): GeoRing {
  const half = widthKm / 2;
  if (!path.length || half <= 0) return [];
  const pts = path.length === 1 ? [path[0]] : densifyPath(path, Math.max(20, half / 3), radiusKm);
  if (pts.length === 1) {
    const ring: GeoRing = [];
    for (let i = 0; i <= 48; i++) { const q = destination(pts[0], (i / 48) * 2 * Math.PI, half, radiusKm); ring.push([q.lng, q.lat]); }
    return unwrap(ring);
  }
  const heading = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    return bearing(a, b);
  });
  const left: LatLng[] = [], right: LatLng[] = [];
  pts.forEach((p, i) => {
    left.push(destination(p, heading[i] - Math.PI / 2, half, radiusKm));
    right.push(destination(p, heading[i] + Math.PI / 2, half, radiusKm));
  });
  const cap = (p: LatLng, from: number): LatLng[] => {
    const out: LatLng[] = [];
    for (let k = 1; k < 12; k++) out.push(destination(p, from + (k / 12) * Math.PI, half, radiusKm));
    return out;
  };
  const last = pts.length - 1;
  const ring: LatLng[] = [
    ...left,
    ...cap(pts[last], heading[last] - Math.PI / 2),
    ...right.reverse(),
    ...cap(pts[0], heading[0] + Math.PI / 2),
  ];
  const r = unwrap(ring.map((q) => [q.lng, q.lat] as [number, number]));
  r.push([r[0][0], r[0][1]]);
  return r;
}

// ---------------------------------------------------------------- light lost (EC-4)

export type ShadowZone = 'band' | 'partial';

/** How deep the shadow is at a distance from the centre line: the band's coverage inside the band, fading to 0 at the partial zone's edge. */
export function shadowDepth(s: EclipseShadow, distKm: number, coverage: number): number {
  const b = Math.max(0, s.bandKm) / 2, p = Math.max(s.bandKm, s.partialKm) / 2;
  if (distKm <= b) return coverage;
  if (distKm >= p || p <= b) return 0;
  return coverage * (1 - (distKm - b) / (p - b));
}

export function zoneAt(s: EclipseShadow, distKm: number): ShadowZone | null {
  if (distKm <= s.bandKm / 2) return 'band';
  if (distKm < Math.max(s.bandKm, s.partialKm) / 2) return 'partial';
  return null;
}

export interface ShadowHit {
  event: WorldEvent & { shadow: EclipseShadow };
  zone: ShadowZone;
  distKm: number;
  /** 0–1 share of the sun covered here at the eclipse's peak. */
  depth: number;
  /** Hours of eclipse here on the day. */
  hours: number;
  /** 0–1 share of the day's light lost to this eclipse. */
  lightLost: number;
}

/** Fixed per place: which shadows reach it and how deep. Precompute once, then ask for any day. */
export interface PlaceShadows {
  at: LatLng;
  reach: { event: WorldEvent & { shadow: EclipseShadow }; zone: ShadowZone; distKm: number; depth: number; from: number; to: number }[];
}

export function placeShadows(world: World, at: LatLng): PlaceShadows {
  const R = world.settings.radiusKm;
  const reach: PlaceShadows['reach'] = [];
  for (const e of shadowEvents(world)) {
    const w = shadowWindow(world, e);
    if (!w) continue;
    const distKm = distanceToPathKm(at, e.shadow.track, R);
    const zone = zoneAt(e.shadow, distKm);
    if (!zone) continue;
    reach.push({ event: e, zone, distKm, depth: shadowDepth(e.shadow, distKm, shadowCoverage(world, e.shadow)), from: w.from, to: w.to });
  }
  return { at, reach };
}

/** EC-4: the eclipses over a place on a day. */
export function shadowsOn(world: World, ps: PlaceShadows, day: number, rules = eclipseRules(world)): ShadowHit[] {
  const out: ShadowHit[] = [];
  for (const r of ps.reach) {
    if (day < r.from || day > r.to) continue;
    const hours = shadowHours(world, r.event, day);
    if (hours <= 0) continue;
    out.push({ event: r.event, zone: r.zone, distKm: r.distKm, depth: r.depth, hours, lightLost: r.depth * Math.min(1, hours / Math.max(0.5, rules.daylightHours)) });
  }
  return out;
}

// ---------------------------------------------------------------- effects over time (EC-5)

export interface EclipseEffect {
  /** 0–1 share of the day's light lost (all eclipses together, at most 1). */
  lightLost: number;
  /** Change from the normal temperature, °C (negative = colder). */
  coolingC: number;
  /** Forest health, 0–100 (100 = untouched). */
  forest: number;
}

export const NO_EFFECT: EclipseEffect = { lightLost: 0, coolingC: 0, forest: 100 };

/** One day (or step of days) of the rules. */
function stepEffect(prev: EclipseEffect, light: number, rules: EclipseRules, days: number): EclipseEffect {
  const lightLost = Math.min(1, light);
  const target = -rules.coolingC * lightLost;
  const k = 1 - Math.exp(-days / Math.max(1, rules.settleDays));
  const coolingC = prev.coolingC + (target - prev.coolingC) * k;
  const stress = Math.max(0, lightLost * 100 - rules.forestLightTolerance) / 10 + Math.max(0, -coolingC - rules.forestColdTolerance) / 5;
  const forest = stress > 0
    ? Math.max(0, prev.forest - (rules.forestDeclinePerYear / 365) * stress * days)
    : Math.min(100, prev.forest + (rules.forestRecoveryPerYear / 365) * days);
  return { lightLost, coolingC, forest };
}

/**
 * Runs the rules from the first eclipse to the day. light(day) gives the share of light lost on a day.
 * stepDays > 1 is faster and a little less exact (used for map shading).
 */
export function simulate(light: (day: number) => number, from: number, to: number, rules: EclipseRules, stepDays = 1, onStep?: (day: number, e: EclipseEffect) => void): EclipseEffect {
  let e = NO_EFFECT;
  if (to < from) return e;
  for (let d = from; d <= to; d += stepDays) {
    const n = Math.min(stepDays, to - d + 1);
    e = stepEffect(e, light(d), rules, n);
    onStep?.(d + n - 1, e);
  }
  return e;
}

/** The first day any eclipse reaching the place starts. */
function firstDay(ps: PlaceShadows): number | undefined {
  return ps.reach.length ? Math.min(...ps.reach.map((r) => r.from)) : undefined;
}

/** EC-5, EC-7: the effects at a place on a day, worked out day by day from the first eclipse. */
export function effectsAt(world: World, ps: PlaceShadows, day: number): EclipseEffect {
  const from = firstDay(ps);
  if (from === undefined || day < from) return NO_EFFECT;
  const rules = eclipseRules(world);
  return simulate((d) => shadowsOn(world, ps, d, rules).reduce((s, h) => s + h.lightLost, 0), from, day, rules);
}

/** EC-7: effects over a span, sampled every stepDays, for a chart. */
export function effectSeries(world: World, ps: PlaceShadows, to: number, stepDays = 30): { from: number; to: number; points: ({ day: number } & EclipseEffect)[] } | undefined {
  const from = firstDay(ps);
  if (from === undefined) return undefined;
  const rules = eclipseRules(world);
  const points: ({ day: number } & EclipseEffect)[] = [{ day: from - 1, ...NO_EFFECT }];
  let next = from + stepDays - 1;
  simulate((d) => shadowsOn(world, ps, d, rules).reduce((s, h) => s + h.lightLost, 0), from, to, rules, 1, (d, e) => {
    if (d >= next || d === to) { points.push({ day: d, ...e }); next = d + stepDays; }
  });
  return { from, to, points };
}

/** The day the place's eclipses all end and effects have faded, for chart ranges. */
export function lastShadowDay(ps: PlaceShadows): number | undefined {
  return ps.reach.length ? Math.max(...ps.reach.map((r) => r.to)) : undefined;
}

// ---------------------------------------------------------------- map shading (EC-6)

export interface EffectGrid {
  west: number;
  north: number;
  cellDeg: number;
  cols: number;
  rows: number;
  /** Per cell, row by row; null = no eclipse ever reaches it. */
  cells: (EclipseEffect | null)[];
}

/**
 * EC-6: effects on a grid over every shadow's partial zone, on a day. Cells with the same shadow depths share
 * one run of the rules, so this stays fast enough for playback.
 */
export function effectGrid(world: World, day: number, maxCells = 70): EffectGrid | undefined {
  const evs = shadowEvents(world);
  if (!evs.length) return undefined;
  const R = world.settings.radiusKm;
  const kmPerDeg = (Math.PI * R) / 180;
  let s = 90, n = -90, w = Infinity, e = -Infinity, minBand = Infinity;
  for (const ev of evs) {
    const ring = pathOutline(ev.shadow.track, Math.max(ev.shadow.bandKm, ev.shadow.partialKm), R);
    for (const [x, y] of ring) { s = Math.min(s, y); n = Math.max(n, y); w = Math.min(w, x); e = Math.max(e, x); }
    minBand = Math.min(minBand, Math.max(ev.shadow.bandKm, 50));
  }
  if (!(e > w) || !(n > s)) return undefined;
  let cellDeg = Math.max(0.05, minBand / 3 / kmPerDeg);
  cellDeg = Math.max(cellDeg, (e - w) / maxCells, (n - s) / maxCells);
  const cols = Math.ceil((e - w) / cellDeg), rows = Math.ceil((n - s) / cellDeg);
  const rules = eclipseRules(world);
  const step = 7;
  const windows = evs.map((ev) => shadowWindow(world, ev)!);
  const coverage = evs.map((ev) => shadowCoverage(world, ev.shadow));
  const from = Math.min(...windows.map((x) => x.from));
  // hours ÷ daylight per eclipse, sampled on the same steps for every cell
  const frac = evs.map((ev) => {
    const out: number[] = [];
    for (let d = from; d <= day; d += step) out.push(Math.min(1, shadowHours(world, ev, d) / Math.max(0.5, rules.daylightHours)));
    return out;
  });
  const memo = new Map<string, EclipseEffect>();
  const cells: (EclipseEffect | null)[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = { lat: n - (r + 0.5) * cellDeg, lng: w + (c + 0.5) * cellDeg };
      const depths = evs.map((ev, i) => shadowDepth(ev.shadow, distanceToPathKm(p, ev.shadow.track, R), coverage[i]));
      if (depths.every((d) => d <= 0)) { cells.push(null); continue; }
      const q = depths.map((d) => Math.round(d * 40));
      const key = q.join(',');
      let eff = memo.get(key);
      if (!eff) {
        const dq = q.map((x) => x / 40);
        eff = day < from ? NO_EFFECT : simulate((d) => {
          const k = Math.floor((d - from) / step);
          let L = 0;
          for (let i = 0; i < evs.length; i++) L += dq[i] * (frac[i][k] ?? 0);
          return L;
        }, from, day, rules, step);
        memo.set(key, eff);
      }
      cells.push(eff);
    }
  }
  return { west: w, north: n, cellDeg, cols, rows, cells };
}

/** Ids of the eclipses going on during a day. */
export function eclipsesOn(world: World, day: number): Id[] {
  return shadowEvents(world).filter((e) => shadowHours(world, e, day) > 0).map((e) => e.id);
}
