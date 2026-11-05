/**
 * Rivers, lakes and other drawn features (MK-8, MK-9, MK-19, MK-22, MP-6..MP-9) and the river
 * checks RC-1 (flows downhill), RC-2 (ends somewhere) and RC-3 (converges, doesn't split).
 */
import { greatCircleKm, interpolateGreatCircle, type LatLng } from '../globe';
import type { Id, MapFeature, World } from '../model';
import { Terrain, TerrainEditor, TerrainReader, cellCenter, cellOf, hasTerrain, wrapX } from '../terrain';
import { pointInPolygon } from '../terrain/brushes';

// ---------- geometry ----------

/** Local flat coordinates in km around an origin (good for distances up to a few hundred km). */
function toXY(o: LatLng, p: LatLng, R: number): [number, number] {
  const k = (Math.PI * R) / 180;
  let dLng = p.lng - o.lng;
  if (dLng > 180) dLng -= 360;
  if (dLng < -180) dLng += 360;
  return [dLng * Math.cos((o.lat * Math.PI) / 180) * k, (p.lat - o.lat) * k];
}

export interface NearestOnLine {
  km: number;
  /** Index of the segment start vertex. */
  seg: number;
  /** 0..1 along the segment. */
  t: number;
  point: LatLng;
}

/** Nearest point on a polyline to p. */
export function nearestOnPolyline(p: LatLng, pts: LatLng[], R: number): NearestOnLine | null {
  if (pts.length === 0) return null;
  if (pts.length === 1) return { km: greatCircleKm(p, pts[0], R), seg: 0, t: 0, point: pts[0] };
  let best: NearestOnLine | null = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = toXY(p, pts[i], R), [bx, by] = toXY(p, pts[i + 1], R);
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
    const x = ax + t * dx, y = ay + t * dy;
    const km = Math.hypot(x, y);
    if (!best || km < best.km) {
      let lng = pts[i + 1].lng;
      if (lng - pts[i].lng > 180) lng -= 360;
      if (lng - pts[i].lng < -180) lng += 360;
      best = { km, seg: i, t, point: { lat: pts[i].lat + (pts[i + 1].lat - pts[i].lat) * t, lng: pts[i].lng + (lng - pts[i].lng) * t } };
    }
  }
  return best;
}

export function polylineKm(pts: LatLng[], R: number): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += greatCircleKm(pts[i - 1], pts[i], R);
  return s;
}

/** Point in an area feature's outline (longitudes unwrapped around its first point). */
export function insideArea(p: LatLng, outline: LatLng[]): boolean {
  if (outline.length < 3) return false;
  const poly: LatLng[] = [];
  for (const q of outline) {
    const prev = poly[poly.length - 1];
    let lng = q.lng;
    if (prev) { while (lng - prev.lng > 180) lng -= 360; while (lng - prev.lng < -180) lng += 360; }
    poly.push({ lat: q.lat, lng });
  }
  let lng = p.lng;
  while (lng - poly[0].lng > 180) lng -= 360;
  while (lng - poly[0].lng < -180) lng += 360;
  return pointInPolygon(p.lat, lng, poly);
}

/** A representative point: the middle vertex of a line, the centre of an area's outline. */
export function featureAnchor(f: MapFeature): LatLng | undefined {
  if (f.points.length === 0) return undefined;
  if (f.shape === 'line') return f.points[Math.floor((f.points.length - 1) / 2)];
  let x = 0, y = 0, z = 0;
  for (const p of f.points) {
    const la = (p.lat * Math.PI) / 180, ln = (p.lng * Math.PI) / 180;
    x += Math.cos(la) * Math.cos(ln); y += Math.cos(la) * Math.sin(ln); z += Math.sin(la);
  }
  return { lat: (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI, lng: (Math.atan2(y, x) * 180) / Math.PI };
}

/** MP-9: does a feature exist on a given day? */
export function existsOn(win: (d: NonNullable<MapFeature['start']>) => { earliest: number; latest: number }, f: { start?: MapFeature['start']; end?: MapFeature['end'] }, day: number): boolean {
  if (f.start && win(f.start).earliest > day) return false;
  if (f.end && win(f.end).latest < day) return false;
  return true;
}

// ---------- MK-19: trace a river downhill ----------

export interface TraceResult {
  points: LatLng[];
  endsIn: 'sea' | 'basin' | 'stop';
  /** Every grid cell the river passes through, source first (for carveValley). */
  cells: [number, number][];
  /** True when the river had to spill over the rim of a hollow; carveValley cuts it through. */
  spilled: boolean;
}

const NB: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** Deepest hollow (m) an automatic river fills and spills out of before it counts as a basin. */
export const MAX_SPILL_M = 300;

const less = (a: number[], b: number[]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);

/** Tiny binary min-heap of [height, order, key]. */
class MinHeap {
  private a: [number, number, number][] = [];
  get size() { return this.a.length; }
  push(v: [number, number, number]) {
    const a = this.a; a.push(v);
    for (let i = a.length - 1; i > 0;) { const p = (i - 1) >> 1; if (less(a[p], a[i])) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop(): [number, number, number] {
    const a = this.a, top = a[0], last = a.pop()!;
    if (a.length) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && less(a[l], a[m])) m = l;
        if (r < a.length && less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

/**
 * Find the way a river from `source` takes to the sea. The land it stands on is flooded from the
 * coast inwards, lowest ground first ("priority flood"), which gives every cell the route water
 * really takes: down valleys, across flats, and through hollows by filling them up to their lowest
 * rim. A hollow deeper than MAX_SPILL_M is a basin and the river ends at its bottom. The trace also
 * ends where `stop` says (another river or a lake). The source snaps to the centre of its cell.
 */
export function traceDownhill(terrain: Terrain, source: LatLng, stop?: (p: LatLng) => boolean, maxCells = 2_000_000): TraceResult {
  const r = new TerrainReader(terrain);
  const g = r.g;
  const src = cellOf(g, source);
  const key = (x: number, y: number) => y * g.width + wrapX(g, x);
  const xy = (k: number): [number, number] => [k % g.width, Math.floor(k / g.width)];
  const srcKey = key(src.gx, src.gy);
  if (r.elevAt(src.gx, src.gy) <= 0) return { points: [source], endsIn: 'sea', cells: [[src.gx, src.gy]], spilled: false };

  // 1. The landmass under the source, and the sea cells along its coast.
  const land = new Set<number>([srcKey]);
  const coast = new Set<number>();
  const queue = [srcKey];
  for (let qi = 0; qi < queue.length && land.size < maxCells; qi++) {
    const [cx, cy] = xy(queue[qi]);
    for (const [dx, dy] of NB) {
      const ny = cy + dy;
      if (ny < 0 || ny >= g.height) continue;
      const k = key(cx + dx, ny);
      if (land.has(k) || coast.has(k)) continue;
      if (r.elevAt(cx + dx, ny) > 0) { land.add(k); queue.push(k); } else coast.add(k);
    }
  }

  // 2. Flood inwards from the coast, lowest first. `filled` is the height water would stand at in
  //    each cell (hollows filled to their lowest rim); `order` says how soon a cell was reached.
  const filled = new Map<number, number>();
  const order = new Map<number, number>();
  const heap = new MinHeap();
  let n = 0; // ties go first-in first-out, so flats drain towards where they were entered
  const reach = (k: number, f: number) => { filled.set(k, f); order.set(k, n); heap.push([f, n++, k]); };
  for (const k of coast) reach(k, 0);
  if (!coast.size) { // a world of land with no sea: drain to its lowest point
    let low = srcKey;
    for (const k of land) if (r.elevAt(...xy(k)) < r.elevAt(...xy(low))) low = k;
    reach(low, r.elevAt(...xy(low)));
  }
  // Flood until everything at or below the source's water level is known.
  while (heap.size) {
    const [lv, , ck] = heap.pop();
    if (filled.has(srcKey) && lv > filled.get(srcKey)!) break;
    const [cx, cy] = xy(ck);
    for (const [dx, dy] of NB) {
      const ny = cy + dy;
      if (ny < 0 || ny >= g.height) continue;
      const k = key(cx + dx, ny);
      if (land.has(k) && !filled.has(k)) reach(k, Math.max(lv, r.elevAt(cx + dx, ny)));
    }
  }

  // 3. Walk steepest-down on the filled surface; across its flats, towards where they drain.
  const cells: [number, number][] = [[src.gx, src.gy]];
  const out: LatLng[] = [cellCenter(g, src.gx, src.gy)];
  let spilled = false;
  const done = (endsIn: TraceResult['endsIn']): TraceResult => ({ points: simplifyStraight(out), endsIn, cells, spilled });
  const visit = (x: number, y: number) => { cells.push([x, y]); out.push(cellCenter(g, x, y)); };
  let [x, y] = [src.gx, src.gy];
  for (let steps = 0; steps < maxCells; steps++) {
    const k = key(x, y), f = filled.get(k), e = r.elevAt(x, y);
    if (f === undefined) return done('basin');
    if (f - e > MAX_SPILL_M) {
      // A hollow too deep to fill: run down to its bottom and end there.
      for (;;) {
        let best: [number, number] | null = null, low = r.elevAt(x, y);
        for (const [dx, dy] of NB) { const h = r.elevAt(x + dx, y + dy); if (h < low) { low = h; best = [wrapX(g, x + dx), y + dy]; } }
        if (!best) return done('basin');
        [x, y] = best; visit(x, y);
      }
    }
    if (f > e) spilled = true;
    let best: [number, number] | null = null, bestSlope = 0, bestOrder = order.get(k)!;
    for (const [dx, dy] of NB) {
      const ny = y + dy;
      if (ny < 0 || ny >= g.height) continue;
      const nk = key(x + dx, ny), nf = coast.has(nk) ? Math.min(0, r.elevAt(x + dx, ny)) : filled.get(nk);
      if (nf === undefined) continue;
      const slope = (f - nf) / (dx && dy ? Math.SQRT2 : 1);
      if (slope > bestSlope) { bestSlope = slope; best = [wrapX(g, x + dx), ny]; }
      else if (!bestSlope && nf === f && order.get(nk)! < bestOrder) { bestOrder = order.get(nk)!; best = [wrapX(g, x + dx), ny]; }
    }
    if (!best) return done('basin');
    [x, y] = best;
    visit(x, y);
    if (r.elevAt(x, y) <= 0) return done('sea');
    if (stop && stop(out[out.length - 1])) return done('stop');
  }
  return done('basin');
}

/**
 * Cut a river's valley so its bed never rises downstream: each cell is lowered to the lowest
 * height upstream of it, and where the river steps diagonally the two cells beside the step are
 * lowered too, so the bed reads downhill everywhere (RC-1). Returns the same terrain when nothing
 * needed cutting. Sea cells are left alone.
 */
export function carveValley(terrain: Terrain, cells: [number, number][]): Terrain {
  const ed = new TerrainEditor(terrain);
  let changed = false;
  const lower = (x: number, y: number, to: number) => {
    const h = ed.elevAt(x, y);
    if (h > to && h > 0) { ed.setCell(x, y, Math.max(1, to)); changed = true; }
  };
  let level = Infinity;
  for (let i = 0; i < cells.length; i++) {
    const [x, y] = cells[i];
    const h = ed.elevAt(x, y);
    if (h <= 0) break;
    const prevLevel = level;
    level = Math.min(level, h);
    lower(x, y, level);
    if (i > 0) {
      const [px, py] = cells[i - 1];
      if (px !== x && py !== y) { lower(px, y, prevLevel); lower(x, py, prevLevel); }
    }
  }
  return changed ? ed.commit() : terrain;
}

/** Drop vertices in the middle of straight runs (exact: the line keeps its shape). */
function simplifyStraight(pts: LatLng[]): LatLng[] {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
    const cross = (b.lng - a.lng) * (c.lat - b.lat) - (b.lat - a.lat) * (c.lng - b.lng);
    if (Math.abs(cross) > 1e-9 || i === 1) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// ---------- RC-1: heights along a river ----------

export interface ProfileSample {
  p: LatLng;
  km: number;
  elev: number;
  /** Index of the segment this sample lies on. */
  seg: number;
}

/** Heights along a line, sampled about every half cell. */
export function profile(reader: TerrainReader, pts: LatLng[], R: number): ProfileSample[] {
  const cellKm = (reader.g.cellDeg * Math.PI * R) / 180;
  const out: ProfileSample[] = [];
  let km = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = greatCircleKm(pts[i], pts[i + 1], R);
    const n = Math.max(1, Math.ceil(d / (cellKm * 0.5)));
    const seg = interpolateGreatCircle(pts[i], pts[i + 1], n);
    for (let k = 0; k < seg.length - (i < pts.length - 2 ? 1 : 0); k++) {
      out.push({ p: seg[k], km: km + (d * k) / n, elev: reader.elevation(seg[k]), seg: i });
    }
    km += d;
  }
  if (pts.length === 1) out.push({ p: pts[0], km: 0, elev: reader.elevation(pts[0]), seg: 0 });
  return out;
}

/** Allowed rise before a stretch counts as uphill (interpolation noise, small dams). */
export const UPHILL_TOLERANCE_M = 20;

export interface UphillStretch {
  fromKm: number;
  toKm: number;
  rise: number;
  at: LatLng;
  segs: Set<number>;
}

/** Stretches where the river climbs above the lowest point it has already reached. */
export function uphillStretches(samples: ProfileSample[], tol = UPHILL_TOLERANCE_M): UphillStretch[] {
  const out: UphillStretch[] = [];
  let low = Infinity;
  let cur: UphillStretch | null = null;
  let onLand = false;
  for (const s of samples) {
    if (s.elev <= 0 && !onLand) continue; // drawn out of the sea: judge it from where land starts
    onLand = true;
    if (s.elev <= 0) { // reached the sea or water: the rest doesn't matter
      if (cur) { out.push(cur); cur = null; }
      break;
    }
    const rise = s.elev - low;
    if (rise > tol) {
      if (!cur) cur = { fromKm: s.km, toKm: s.km, rise, at: s.p, segs: new Set() };
      cur.toKm = s.km;
      cur.segs.add(s.seg);
      if (rise > cur.rise) { cur.rise = rise; cur.at = s.p; }
    } else {
      if (cur) { out.push(cur); cur = null; }
      low = Math.min(low, s.elev);
    }
  }
  if (cur) out.push(cur);
  return out;
}

// ---------- MK-8: flow and width ----------

/** Upstream length (km) at every vertex of every river, counting tributaries that join above it. */
export function riverFlows(features: MapFeature[], R: number): Map<Id, number[]> {
  const rivers = features.filter((f) => f.kind === 'river' && f.points.length >= 2);
  const byId = new Map(rivers.map((r) => [r.id, r]));
  const tribs = new Map<Id, { trib: MapFeature; at: number }[]>();
  for (const t of rivers) {
    const parent = t.joinsId && byId.get(t.joinsId);
    if (!parent || parent.id === t.id) continue;
    const n = nearestOnPolyline(t.points[t.points.length - 1], parent.points, R);
    if (!n) continue;
    const list = tribs.get(parent.id) ?? [];
    list.push({ trib: t, at: n.seg + n.t });
    tribs.set(parent.id, list);
  }
  const memo = new Map<Id, number[]>();
  const visiting = new Set<Id>();
  const flows = (r: MapFeature): number[] => {
    const m = memo.get(r.id);
    if (m) return m;
    if (visiting.has(r.id)) return r.points.map(() => 0); // a loop of joins: ignore
    visiting.add(r.id);
    const out: number[] = [0];
    for (let i = 1; i < r.points.length; i++) out.push(out[i - 1] + greatCircleKm(r.points[i - 1], r.points[i], R));
    for (const { trib, at } of tribs.get(r.id) ?? []) {
      const tf = flows(trib);
      const add = tf[tf.length - 1];
      for (let i = 0; i < out.length; i++) if (i >= at) out[i] += add;
    }
    visiting.delete(r.id);
    memo.set(r.id, out);
    return out;
  };
  const result = new Map<Id, number[]>();
  for (const r of rivers) result.set(r.id, flows(r));
  return result;
}

// ---------- RC-1..RC-3 ----------

export type RiverRule = 'river-uphill' | 'river-dead-end' | 'river-split';

export interface RiverIssue {
  rule: RiverRule;
  key: string;
  featureId: Id;
  message: string;
  at: LatLng;
}

/** How close two lines must be to count as touching: two map cells, at least 3 km. */
export function connectKm(world: World): number {
  return Math.max(3, (2 * world.terrain.cellDeg * Math.PI * world.settings.radiusKm) / 180);
}

/** How close an automatic river must come to another river to join it: within one grid cell. */
export function touchKm(world: World): number {
  return (0.75 * world.terrain.cellDeg * Math.PI * world.settings.radiusKm) / 180;
}

const where = (p: LatLng) => `${Math.abs(p.lat).toFixed(1)}°${p.lat >= 0 ? 'N' : 'S'}, ${Math.abs(p.lng).toFixed(1)}°${p.lng >= 0 ? 'E' : 'W'}`;

export function checkRivers(world: World): RiverIssue[] {
  const R = world.settings.radiusKm;
  const tol = connectKm(world);
  const rivers = world.mapFeatures.filter((f) => f.kind === 'river' && f.points.length >= 2);
  const lakes = world.mapFeatures.filter((f) => f.kind === 'lake' && f.points.length >= 3);
  const terrainOn = hasTerrain(world.terrain);
  const reader = new TerrainReader(world.terrain);
  const out: RiverIssue[] = [];
  const nameOf = (f: MapFeature) => f.name || 'An unnamed river';

  for (const r of rivers) {
    const src = r.points[0], mouth = r.points[r.points.length - 1];
    // RC-1
    if (terrainOn) {
      const st = uphillStretches(profile(reader, r.points, R));
      if (st.length) {
        const worst = st.reduce((a, b) => (b.rise > a.rise ? b : a));
        out.push({
          rule: 'river-uphill', key: `river-uphill:${r.id}`, featureId: r.id, at: worst.at,
          message: `${nameOf(r)} flows uphill in ${st.length === 1 ? 'one stretch' : `${st.length} stretches`}, climbing up to ${Math.round(worst.rise)} m near ${where(worst.at)} (${Math.round(worst.fromKm)}–${Math.round(worst.toKm)} km from its source).`,
        });
      }
    }
    // RC-2: the mouth must reach the sea, a lake, another river, or a marked basin.
    const joins = r.joinsId && rivers.some((q) => q.id === r.joinsId);
    const touchesRiver = rivers.some((q) => q.id !== r.id && (nearestOnPolyline(mouth, q.points, R)?.km ?? Infinity) <= tol);
    const inLake = lakes.some((l) => insideArea(mouth, l.points) || (nearestOnPolyline(mouth, [...l.points, l.points[0]], R)?.km ?? Infinity) <= tol);
    const atSea = terrainOn && nearSea(reader, mouth, tol, R);
    if (!r.endsInBasin && !joins && !touchesRiver && !inLake && !atSea && (terrainOn || lakes.length || rivers.length > 1)) {
      out.push({
        rule: 'river-dead-end', key: `river-dead-end:${r.id}`, featureId: r.id, at: mouth,
        message: `${nameOf(r)} stops at ${where(mouth)} without reaching the sea, a lake or another river. Extend it, or mark it as ending in an inland basin.`,
      });
    }
    // RC-3: a river that starts partway along another one is a fork.
    if (!r.fork) {
      for (const q of rivers) {
        if (q.id === r.id) continue;
        const n = nearestOnPolyline(src, q.points, R);
        if (!n || n.km > tol) continue;
        const qLen = polylineKm(q.points, R);
        const along = polylineKm([...q.points.slice(0, n.seg + 1), n.point], R);
        // Starting at the other river's mouth is a continuation; at its source, they share a spring.
        if (along >= qLen - tol || along <= tol) continue;
        out.push({
          rule: 'river-split', key: `river-split:${r.id}:${q.id}`, featureId: r.id, at: src,
          message: `${nameOf(r)} splits off ${q.name || 'another river'} near ${where(src)}. Rivers join going downstream; they rarely fork. Mark it as a delta or as intentional if it's meant to be.`,
        });
        break;
      }
    }
  }
  return out;
}

function nearSea(reader: TerrainReader, p: LatLng, tolKm: number, R: number): boolean {
  if (reader.elevation(p) <= 0) return true;
  const dDeg = (tolKm / ((Math.PI * R) / 180));
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const q = { lat: p.lat + Math.sin(a) * dDeg, lng: p.lng + (Math.cos(a) * dDeg) / Math.max(0.1, Math.cos((p.lat * Math.PI) / 180)) };
    if (reader.elevation(q) <= 0) return true;
  }
  return false;
}

/** Live hint while drawing (MK-22): which segments of a line in progress climb. */
export function uphillSegments(terrain: Terrain, pts: LatLng[], R: number): Set<number> {
  if (!hasTerrain(terrain) || pts.length < 2) return new Set();
  const out = new Set<number>();
  for (const s of uphillStretches(profile(new TerrainReader(terrain), pts, R))) for (const i of s.segs) out.add(i);
  return out;
}

