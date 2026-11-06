/**
 * WH-6: routes along drawn roads, trade routes, sea lanes and rivers. The drawn lines become a
 * graph (their points are its nodes; lines that meet or nearly meet are joined), the start and end
 * connect to it across open country, and the shortest way through is found. Open country costs
 * more than a road, so a route leaves the roads only where that is really shorter.
 */
import { greatCircleKm, type LatLng } from '../globe';
import type { Id, LineKind, MapFeature, World } from '../model';
import { connectKm, existsOn, nearestOnPolyline } from './rivers';

export type RouteNetwork = 'land' | 'water' | 'none';

/** Which drawn lines a travel mode can follow: ships take sea lanes and rivers, flying and magic go straight. */
export function networkFor(modeId: string): RouteNetwork {
  const m = modeId.toLowerCase();
  if (/ship|boat|barge|sail/.test(m)) return 'water';
  if (/fly|magic|teleport|air/.test(m)) return 'none';
  return 'land';
}

const KINDS: Record<Exclude<RouteNetwork, 'none'>, LineKind[]> = {
  land: ['road', 'trade-route'],
  water: ['sea-lane', 'river'],
};

/** Cost of a km across open country compared with a km of road. */
export const OFF_ROAD_COST = 1.6;

export interface RouteResult {
  points: LatLng[];
  km: number;
  /** Names of the drawn lines it follows, in order, without repeats. */
  via: string[];
  /** km of the route on drawn lines. */
  onNetworkKm: number;
}

class Heap {
  private a: [number, number][] = [];
  get size() { return this.a.length; }
  push(v: [number, number]) {
    const a = this.a; a.push(v);
    for (let i = a.length - 1; i > 0;) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop(): [number, number] {
    const a = this.a, top = a[0], last = a.pop()!;
    if (a.length) {
      a[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

/**
 * The shortest route from `from` to `to` for a travel network, using only lines that pass
 * `include` (for example, those that exist on the travel date). Returns a straight line when no
 * drawn line helps.
 */
export function routeAlongFeatures(
  world: World, from: LatLng, to: LatLng, network: RouteNetwork, include: (f: MapFeature) => boolean = () => true,
): RouteResult {
  const R = world.settings.radiusKm;
  const straight = greatCircleKm(from, to, R);
  const direct: RouteResult = { points: [from, to], km: straight, via: [], onNetworkKm: 0 };
  if (network === 'none') return direct;
  const lines = world.mapFeatures.filter((f) => f.shape === 'line' && f.points.length >= 2 && KINDS[network].includes(f.kind as LineKind) && include(f));
  if (!lines.length) return direct;

  // nodes: 0 = start, 1 = end, then every point of every line
  const pts: LatLng[] = [from, to];
  const owner: (Id | null)[] = [null, null];
  const adj: [number, number, number][][] = [[], []]; // [to, cost, km]
  const node = (p: LatLng, f: Id | null) => { pts.push(p); owner.push(f); adj.push([]); return pts.length - 1; };
  const edge = (a: number, b: number, km: number, cost = km) => { adj[a].push([b, cost, km]); adj[b].push([a, cost, km]); };
  const lineNodes = new Map<Id, number[]>();
  for (const f of lines) {
    const ids = f.points.map((p) => node(p, f.id));
    for (let i = 1; i < ids.length; i++) edge(ids[i - 1], ids[i], greatCircleKm(pts[ids[i - 1]], pts[ids[i]], R));
    lineNodes.set(f.id, ids);
  }
  // join lines that meet: each line's points link to the nearest point of any other line close by
  const join = connectKm(world);
  for (const f of lines) {
    for (const a of lineNodes.get(f.id)!) {
      for (const g of lines) {
        if (g.id === f.id) continue;
        const n = nearestOnPolyline(pts[a], g.points, R);
        if (!n || n.km > join) continue;
        const ids = lineNodes.get(g.id)!;
        const mid = node(n.point, g.id);
        edge(mid, ids[n.seg], greatCircleKm(n.point, g.points[n.seg], R));
        edge(mid, ids[n.seg + 1], greatCircleKm(n.point, g.points[n.seg + 1], R));
        edge(a, mid, n.km);
      }
    }
  }
  // start and end reach each line at its nearest point, across open country
  for (const [end, p] of [[0, from], [1, to]] as const) {
    for (const g of lines) {
      const n = nearestOnPolyline(p, g.points, R);
      if (!n || n.km > straight) continue;
      const ids = lineNodes.get(g.id)!;
      const mid = node(n.point, g.id);
      edge(mid, ids[n.seg], greatCircleKm(n.point, g.points[n.seg], R));
      edge(mid, ids[n.seg + 1], greatCircleKm(n.point, g.points[n.seg + 1], R));
      edge(end, mid, n.km, n.km * OFF_ROAD_COST);
    }
  }
  edge(0, 1, straight, straight * OFF_ROAD_COST);

  // Dijkstra
  const dist = new Float64Array(pts.length).fill(Infinity);
  const prev = new Int32Array(pts.length).fill(-1);
  const prevKm = new Float64Array(pts.length);
  const heap = new Heap();
  dist[0] = 0; heap.push([0, 0]);
  while (heap.size) {
    const [d, u] = heap.pop();
    if (d > dist[u]) continue;
    if (u === 1) break;
    for (const [v, c, km] of adj[u]) if (d + c < dist[v]) { dist[v] = d + c; prev[v] = u; prevKm[v] = km; heap.push([dist[v], v]); }
  }
  if (prev[1] < 0) return direct;
  const path: number[] = [];
  for (let v = 1; v >= 0; v = prev[v]) { path.unshift(v); if (v === 0) break; }
  const points: LatLng[] = [];
  let km = 0, onNetworkKm = 0;
  const via: string[] = [];
  for (let i = 0; i < path.length; i++) {
    const v = path[i];
    const p = pts[v];
    if (!points.length || greatCircleKm(points[points.length - 1], p, R) > 1e-6) points.push(p);
    if (i > 0) {
      km += prevKm[v];
      const u = path[i - 1];
      if (owner[u] && owner[u] === owner[v]) {
        onNetworkKm += prevKm[v];
        const name = lines.find((f) => f.id === owner[v])!.name;
        if (name && via[via.length - 1] !== name) via.push(name);
      }
    }
  }
  return { points, km, via, onNetworkKm };
}

/**
 * A route through several stops (origin, waypoints, destination), each leg routed along the
 * lines a travel mode can follow that exist on `day`.
 */
export function routeThrough(
  world: World, stops: LatLng[], modeId: string, day: number, win: (d: NonNullable<MapFeature['start']>) => { earliest: number; latest: number },
): RouteResult {
  const network = networkFor(modeId);
  const include = (f: MapFeature) => existsOn(win, f, day);
  const out: RouteResult = { points: [], km: 0, via: [], onNetworkKm: 0 };
  for (let i = 1; i < stops.length; i++) {
    const leg = routeAlongFeatures(world, stops[i - 1], stops[i], network, include);
    out.points.push(...(out.points.length ? leg.points.slice(1) : leg.points));
    out.km += leg.km;
    out.onNetworkKm += leg.onNetworkKm;
    for (const v of leg.via) if (out.via[out.via.length - 1] !== v) out.via.push(v);
  }
  return out;
}
