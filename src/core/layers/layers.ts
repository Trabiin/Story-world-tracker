/**
 * Region layers over time (LY-1..LY-12, DM-2, DM-7). A region has versions with start dates (LY-6):
 * each version holds the region's shape until the next one starts. Conquests are border changes on a
 * date; every place inside picks up its new realm automatically because a place's realm is looked up,
 * never stored (DM-2).
 */
import { DayWindow, FuzzyDate, Hemisphere, formatFuzzy, toWindow } from '../dates';
import type { LatLng } from '../globe';
import type { GeoMultiPolygon, Id, Region, RegionLayer, RegionLayerType, RegionVersion, World } from '../model';
import { areaContains, intersectArea, subtractArea, unionArea } from './geometry';

export interface LayerTypeInfo {
  name: string;
  /** Default for new layers of this type. */
  overlaps: boolean;
  onlyOnLand: boolean;
  fill: RegionLayer['fill'];
  borderStyle: RegionLayer['borderStyle'];
  color: string;
  hint: string;
}

/** LY-1 built-in types and LY-11 proposed extra layers. */
export const LAYER_TYPES: Record<RegionLayerType, LayerTypeInfo> = {
  political: { name: 'Political', overlaps: false, onlyOnLand: true, fill: 'solid', borderStyle: 'solid', color: '#c0504d', hint: 'Kingdoms, empires and duchies. Decides which realm a place belongs to.' },
  culture: { name: 'Cultures', overlaps: true, onlyOnLand: true, fill: 'solid', borderStyle: 'dashed', color: '#4f81bd', hint: 'Peoples and cultures; may overlap.' },
  religion: { name: 'Religions', overlaps: true, onlyOnLand: true, fill: 'hatch', borderStyle: 'dotted', color: '#9b59b6', hint: 'Faiths, with how many follow them (intensity).' },
  language: { name: 'Languages', overlaps: true, onlyOnLand: true, fill: 'hatch', borderStyle: 'dashed', color: '#2a9d8f', hint: 'Where each language or dialect is spoken; bilingual zones overlap.' },
  trade: { name: 'Trade', overlaps: true, onlyOnLand: false, fill: 'hatch', borderStyle: 'dashed', color: '#e9a23b', hint: 'Markets and trading spheres. Routes themselves are drawn as trade routes and sea lanes.' },
  population: { name: 'Population', overlaps: false, onlyOnLand: true, fill: 'solid', borderStyle: 'none', color: '#8d6e63', hint: 'How densely each area is settled; use intensity for density.' },
  resources: { name: 'Resources', overlaps: true, onlyOnLand: false, fill: 'hatch', borderStyle: 'dotted', color: '#6d8b3a', hint: 'Mines, farmland, timber, fishing grounds.' },
  influence: { name: 'Spheres of influence', overlaps: true, onlyOnLand: false, fill: 'hatch', borderStyle: 'dashed', color: '#5c6bc0', hint: 'Alliances and areas a power controls without owning.' },
  military: { name: 'Military', overlaps: true, onlyOnLand: false, fill: 'hatch', borderStyle: 'solid', color: '#7b1f1f', hint: 'Garrison areas, army positions, front lines.' },
  danger: { name: 'Danger', overlaps: true, onlyOnLand: false, fill: 'hatch', borderStyle: 'dashed', color: '#d62828', hint: 'Bandit country, monster territory, cursed or impassable zones.' },
  magic: { name: 'Magic', overlaps: true, onlyOnLand: false, fill: 'solid', borderStyle: 'dotted', color: '#7e57c2', hint: 'Wild-magic zones, sacred sites, places where magic is weak.' },
  'known-world': { name: 'Known world', overlaps: true, onlyOnLand: false, fill: 'none', borderStyle: 'dashed', color: '#455a64', hint: 'How far each culture\'s maps reach.' },
  history: { name: 'History', overlaps: true, onlyOnLand: false, fill: 'hatch', borderStyle: 'dotted', color: '#795548', hint: 'Old borders, ruined lands, sites of past events.' },
  disasters: { name: 'Plagues and disasters', overlaps: true, onlyOnLand: false, fill: 'solid', borderStyle: 'dashed', color: '#ef6c00', hint: 'Spread of disease, famine, floods or fire over time.' },
  notes: { name: 'Author notes', overlaps: true, onlyOnLand: false, fill: 'none', borderStyle: 'dotted', color: '#607d8b', hint: 'Private areas for plot ideas and open questions.' },
  other: { name: 'Other', overlaps: true, onlyOnLand: false, fill: 'solid', borderStyle: 'solid', color: '#888888', hint: 'Anything else.' },
};

/** Colours offered for new regions, picked in turn. */
export const REGION_COLORS = ['#c0504d', '#4f81bd', '#9bbb59', '#8064a2', '#f79646', '#2c9faf', '#d4a017', '#a0522d', '#5b8c5a', '#c06c84', '#6c5b7b', '#355c7d'];

export function newRegionLayer(type: RegionLayerType, base: { id: Id; scenarioId: Id; status: 'draft' | 'canon'; createdAt: string; updatedAt: string }, order: number, name?: string): RegionLayer {
  const t = LAYER_TYPES[type];
  return {
    ...base, name: name ?? t.name, type, overlaps: t.overlaps, color: t.color, fill: t.fill, borderStyle: t.borderStyle,
    opacity: type === 'political' ? 0.4 : 0.3, labels: true, onlyOnLand: t.onlyOnLand, colorBy: type === 'political' ? 'top' : undefined,
    visible: type !== 'language' && type !== 'trade', locked: false, order,
  };
}

/** LY-1: the starting set every world gets. Fixed ids so older worlds get the same ones. */
export function defaultRegionLayers(stamp: string): RegionLayer[] {
  return (['political', 'culture', 'religion', 'language', 'trade'] as RegionLayerType[]).map((type, i) =>
    newRegionLayer(type, { id: `layer-${type}`, scenarioId: 'canon', status: 'canon', createdAt: stamp, updatedAt: stamp }, i));
}

export interface RegionHit {
  region: Region;
  intensity: number;
}

export interface ChainLink {
  region: Region;
  /** How this region relates to the one before it in the chain. */
  relation?: 'part' | 'vassal';
}

const NEG = -Infinity;

/** Fast lookups of regions on a date. Build once per world change. */
export class LayerIndex {
  readonly layers: RegionLayer[];
  readonly regions = new Map<Id, Region>();
  private byLayer = new Map<Id, Region[]>();
  private starts = new Map<Id, number[]>();
  private span = new Map<Id, [number, number]>();
  readonly win: (d: FuzzyDate) => DayWindow;

  constructor(readonly world: Pick<World, 'regionLayers' | 'regions'> & { settings: { hemisphereForSeasons: Hemisphere } }) {
    const hemi = world.settings.hemisphereForSeasons;
    this.win = (d) => toWindow(d, hemi);
    this.layers = [...world.regionLayers].sort((a, b) => a.order - b.order);
    for (const r of world.regions) {
      this.regions.set(r.id, r);
      const l = this.byLayer.get(r.layerId);
      if (l) l.push(r); else this.byLayer.set(r.layerId, [r]);
      this.starts.set(r.id, r.versions.map((v) => (v.start ? this.win(v.start).earliest : NEG)));
      this.span.set(r.id, [r.start ? this.win(r.start).earliest : NEG, r.end ? this.win(r.end).latest : Infinity]);
    }
  }

  regionsOf(layerId: Id): Region[] {
    return this.byLayer.get(layerId) ?? [];
  }

  layer(id: Id): RegionLayer | undefined {
    return this.layers.find((l) => l.id === id);
  }

  exists(r: Region, day: number): boolean {
    const [a, b] = this.span.get(r.id) ?? [NEG, Infinity];
    return day >= a && day <= b;
  }

  /** Index of the version in effect on a day, or -1. */
  versionIndexAt(r: Region, day: number): number {
    const st = this.starts.get(r.id) ?? [];
    let k = -1;
    for (let i = 0; i < st.length; i++) if (st[i] <= day) k = i;
    return k;
  }

  versionAt(r: Region, day: number): RegionVersion | undefined {
    if (!this.exists(r, day)) return undefined;
    const i = this.versionIndexAt(r, day);
    return i >= 0 ? r.versions[i] : undefined;
  }

  /** LY-9: every region on every layer covering a point on a day, layers in display order. */
  regionsAt(p: LatLng, day: number, onlyLayer?: Id): { layer: RegionLayer; hits: RegionHit[] }[] {
    const out: { layer: RegionLayer; hits: RegionHit[] }[] = [];
    for (const layer of this.layers) {
      if (onlyLayer && layer.id !== onlyLayer) continue;
      const hits: RegionHit[] = [];
      for (const r of this.regionsOf(layer.id)) {
        const v = this.versionAt(r, day);
        if (v && areaContains(v.area, p)) hits.push({ region: r, intensity: v.intensity ?? 100 });
      }
      if (hits.length) out.push({ layer, hits: hits.sort((a, b) => b.intensity - a.intensity) });
    }
    return out;
  }

  /** LY-2: a region and the realms above it on a day (duchy → kingdom → empire). */
  chain(regionId: Id, day: number): ChainLink[] {
    const out: ChainLink[] = [];
    const seen = new Set<Id>();
    let r = this.regions.get(regionId);
    let relation: ChainLink['relation'];
    while (r && !seen.has(r.id)) {
      out.push({ region: r, relation });
      seen.add(r.id);
      const up = r.overlords.find((o) => (!o.start || this.win(o.start).earliest <= day) && (!o.end || this.win(o.end).latest >= day) && this.regions.has(o.regionId));
      if (!up) break;
      relation = up.relation;
      r = this.regions.get(up.regionId);
      if (r && !this.exists(r, day)) break;
    }
    return out;
  }

  political(): RegionLayer[] {
    return this.layers.filter((l) => l.type === 'political');
  }

  /** DM-2, LY-2: the realm chain a point belongs to on a day (first political layer that covers it). */
  realmAt(p: LatLng, day: number): ChainLink[] {
    for (const layer of this.political()) {
      const hit = this.regionsAt(p, day, layer.id)[0]?.hits[0];
      if (hit) return this.chain(hit.region.id, day);
    }
    return [];
  }

  /** LY-12: how a point's realm changed over time, oldest first. */
  realmHistory(p: LatLng): RealmPeriod[] {
    const points = new Map<number, string>();
    const add = (d: FuzzyDate | undefined, after = false) => {
      if (!d) return;
      const w = this.win(d);
      const day = after ? w.latest + 1 : w.earliest;
      if (!points.has(day)) points.set(day, after ? `after ${formatFuzzy(d)}` : formatFuzzy(d));
    };
    const pol = new Set(this.political().map((l) => l.id));
    for (const r of this.regions.values()) {
      if (!pol.has(r.layerId)) continue;
      add(r.start); add(r.end, true);
      r.versions.forEach((v) => add(v.start));
      r.overlords.forEach((o) => { add(o.start); add(o.end, true); });
    }
    const days = [...points.keys()].sort((a, b) => a - b);
    const out: RealmPeriod[] = [];
    const probe = [days.length ? days[0] - 1 : 0, ...days];
    probe.forEach((day, i) => {
      const chain = this.realmAt(p, day);
      const key = chain.map((c) => c.region.id).join('>');
      const last = out[out.length - 1];
      if (last && last.key === key) return;
      if (last) { last.endDay = day - 1; last.endLabel = i > 0 ? points.get(day) : undefined; }
      out.push({ key, chain, startDay: i === 0 ? undefined : day, startLabel: i === 0 ? undefined : points.get(day) });
    });
    return out.filter((x) => x.chain.length > 0);
  }

  /** Every day on which some region on the layer changes shape or exists/stops existing (for playback and scrubbing). */
  changeDays(layerIds?: Id[]): number[] {
    const set = new Set<number>();
    for (const r of this.regions.values()) {
      if (layerIds && !layerIds.includes(r.layerId)) continue;
      for (const s of this.starts.get(r.id) ?? []) if (s !== NEG) set.add(s);
      const [a, b] = this.span.get(r.id)!;
      if (a !== NEG) set.add(a);
      if (b !== Infinity) set.add(b + 1);
    }
    return [...set].sort((a, b) => a - b);
  }
}

export interface RealmPeriod {
  key: string;
  chain: ChainLink[];
  startDay?: number;
  endDay?: number;
  startLabel?: string;
  endLabel?: string;
}

/** "Duchy of Ost, part of the Kingdom of Varn, vassal of the Empire of Ash". */
export function describeChain(chain: ChainLink[]): string {
  return chain.map((c, i) => (i === 0 ? c.region.name : `${c.relation === 'vassal' ? 'vassal of' : 'part of'} ${c.region.name}`)).join(', ');
}

// ---------------------------------------------------------------------------------------------
// Editing borders (LY-5, LY-6)

export interface AreaEdit {
  regionId: Id;
  area: GeoMultiPolygon;
  op: 'add' | 'remove';
  /** Changes apply from this date on; absent = the region's whole history. */
  from?: FuzzyDate;
  /** …and stop on this date (e.g. a temporary occupation); absent = from then on. */
  until?: FuzzyDate;
  /**
   * Political layers keep regions apart. 'take': the region takes the land from its neighbours (a conquest).
   * 'stop': new land stops at the neighbours' borders, so they share an edge.
   */
  neighbours: 'take' | 'stop';
  /** Shown in the border history, e.g. "Conquered by the Empire of Ash". */
  note?: string;
  newId: () => Id;
}

const startDay = (v: RegionVersion, win: (d: FuzzyDate) => DayWindow) => (v.start ? win(v.start).earliest : NEG);

function sortVersions(vs: RegionVersion[], win: (d: FuzzyDate) => DayWindow): RegionVersion[] {
  return [...vs].sort((a, b) => startDay(a, win) - startDay(b, win));
}

/** Make sure a version starts exactly on a date, copying the shape in effect then. */
function splitAt(r: Region, d: FuzzyDate | undefined, win: (d: FuzzyDate) => DayWindow, newId: () => Id, note?: string): Region {
  if (!d) return r;
  const day = win(d).earliest;
  const vs = sortVersions(r.versions, win);
  if (vs.some((v) => startDay(v, win) === day)) return note ? { ...r, versions: vs.map((v) => (startDay(v, win) === day && !v.note ? { ...v, note } : v)) } : { ...r, versions: vs };
  let cur: RegionVersion | undefined;
  for (const v of vs) if (startDay(v, win) <= day) cur = v;
  const added: RegionVersion = { id: newId(), start: d, area: cur?.area ?? [], intensity: cur?.intensity, note };
  return { ...r, versions: sortVersions([...vs, added], win) };
}

function inRange(v: RegionVersion, win: (d: FuzzyDate) => DayWindow, from: number, until: number) {
  const s = startDay(v, win);
  return s >= from && s < until;
}

/** Drop versions that repeat the one before them without saying anything new. */
function tidy(r: Region): Region {
  const out: RegionVersion[] = [];
  for (const v of r.versions) {
    const prev = out[out.length - 1];
    if (prev && !v.note && (v.intensity ?? 100) === (prev.intensity ?? 100) && JSON.stringify(v.area) === JSON.stringify(prev.area)) continue;
    out.push(v);
  }
  return out.length === r.versions.length ? r : { ...r, versions: out };
}

/** Change a region's shape over a span of time (LY-5, LY-6). Returns a new world; nothing else changes. */
export function editRegionArea(world: World, e: AreaEdit): World {
  const win = (d: FuzzyDate) => toWindow(d, world.settings.hemisphereForSeasons);
  const target = world.regions.find((r) => r.id === e.regionId);
  if (!target || !e.area.length) return world;
  const layer = world.regionLayers.find((l) => l.id === target.layerId);
  const keepApart = !!layer && !layer.overlaps;
  const from = e.from ? win(e.from).earliest : NEG;
  const until = e.until ? win(e.until).earliest : Infinity;
  if (until <= from) return world;

  const others = keepApart ? world.regions.filter((r) => r.layerId === target.layerId && r.id !== target.id) : [];
  let t = target;
  if (!t.versions.length) t = { ...t, versions: [{ id: e.newId(), start: e.from ?? t.start, area: [] }] };
  t = splitAt(splitAt(t, e.from, win, e.newId, e.note), e.until, win, e.newId);
  const sorted = sortVersions(t.versions, win);
  const endOf = (vs: RegionVersion[], i: number) => (i + 1 < vs.length ? startDay(vs[i + 1], win) : Infinity);
  t = {
    ...t,
    versions: sorted.map((v, i) => {
      if (!inRange(v, win, from, until)) return v;
      let area = e.op === 'add' ? unionArea(v.area, e.area) : subtractArea(v.area, e.area);
      if (e.op === 'add' && e.neighbours === 'stop' && others.length) {
        // Stop at every border a neighbour has at any time while this version is in effect.
        const s0 = startDay(v, win), s1 = endOf(sorted, i);
        for (const o of others) {
          const oa = o.start ? win(o.start).earliest : NEG, ob = o.end ? win(o.end).latest : Infinity;
          const ov = sortVersions(o.versions, win);
          ov.forEach((q, j) => {
            const q0 = Math.max(startDay(q, win), oa), q1 = Math.min(endOf(ov, j), ob + 1);
            if (q0 < s1 && q1 > s0) area = subtractArea(area, q.area);
          });
        }
      }
      return { ...v, area };
    }),
  };

  const changed = new Map<Id, Region>([[t.id, tidy(t)]]);
  if (e.op === 'add' && e.neighbours === 'take') {
    for (const o of others) {
      // Only touch neighbours that actually hold some of the land during the span.
      const relevant = o.versions.filter((v) => inRange(v, win, from, until) || v === sortVersions(o.versions, win).filter((q) => startDay(q, win) <= from).pop());
      if (!relevant.some((v) => intersectArea(v.area, e.area).length)) continue;
      let n = splitAt(splitAt(o, e.from, win, e.newId), e.until, win, e.newId);
      n = { ...n, versions: n.versions.map((v) => (inRange(v, win, from, until) ? { ...v, area: subtractArea(v.area, e.area) } : v)) };
      changed.set(n.id, tidy(n));
    }
  }
  return { ...world, regions: world.regions.map((r) => changed.get(r.id) ?? r) };
}

/** Who holds which share of a shape on a day, e.g. to describe what a conquest took. */
export function areaOwners(ix: LayerIndex, layerId: Id, area: GeoMultiPolygon, day: number): Region[] {
  return ix.regionsOf(layerId).filter((r) => {
    const v = ix.versionAt(r, day);
    return v && intersectArea(v.area, area).length > 0;
  });
}
