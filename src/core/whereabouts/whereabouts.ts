/**
 * Whereabouts engine (DM-4, DM-5, WH-1..WH-8, VW-5).
 * Turns stays and journeys (own and via groups) into per-character segments,
 * and answers "where is X on day D".
 */
import { DayWindow, FuzzyDate, Hemisphere, midpoint, toWindow } from '../dates';
import { DEFAULT_DETOUR_FACTOR, LatLng, greatCircleKm, interpolateGreatCircle, travelDays } from '../globe';
import type { Character, Id, Journey, Membership, Place, Stay, World } from '../model';
import { TravelFactor, travelFactor } from '../travel/modifiers';

export const OPEN_END = Number.MAX_SAFE_INTEGER;

export interface Segment {
  kind: 'stay' | 'journey';
  recordId: Id;
  characterId: Id;
  /** Set when this segment reaches the character through a group (DM-5). */
  viaGroupId?: Id;
  start: DayWindow;
  end: DayWindow; // end.latest = OPEN_END for open-ended stays
  openEnded: boolean;
  /** For stays: the place. For journeys: origin. */
  placeId: Id;
  destinationId?: Id;
  /** For journeys: true when the arrival date was computed, not entered (WH-8). */
  arrivalSuggested?: boolean;
}

export class WorldIndex {
  readonly places = new Map<Id, Place>();
  readonly characters = new Map<Id, Character>();
  private staysBySubject = new Map<string, Stay[]>();
  readonly journeys = new Map<Id, Journey>();
  private journeysBySubject = new Map<string, Journey[]>();
  private membershipsByCharacter = new Map<Id, Membership[]>();
  private segmentCache = new Map<Id, Segment[]>();
  constructor(readonly world: World) {
    for (const p of world.places) this.places.set(p.id, p);
    for (const c of world.characters) this.characters.set(c.id, c);
    const add = <T>(m: Map<string, T[]>, k: string, v: T) => {
      const l = m.get(k);
      if (l) l.push(v); else m.set(k, [v]);
    };
    for (const s of world.stays) add(this.staysBySubject, `${s.subject.kind}:${s.subject.id}`, s);
    for (const j of world.journeys) this.journeys.set(j.id, j);
    for (const j of world.journeys) add(this.journeysBySubject, `${j.subject.kind}:${j.subject.id}`, j);
    for (const m of world.memberships) add(this.membershipsByCharacter, m.characterId, m);
  }

  staysOf(kind: 'character' | 'group', id: Id): Stay[] {
    return this.staysBySubject.get(`${kind}:${id}`) ?? [];
  }
  journeysOf(kind: 'character' | 'group', id: Id): Journey[] {
    return this.journeysBySubject.get(`${kind}:${id}`) ?? [];
  }

  get hemisphere(): Hemisphere {
    return this.world.settings.hemisphereForSeasons;
  }

  win(d: FuzzyDate): DayWindow {
    return toWindow(d, this.hemisphere);
  }

  /** A place's position, inherited from the nearest ancestor that has one (DM-2). */
  locationOf(placeId: Id): LatLng | undefined {
    let p = this.places.get(placeId);
    const seen = new Set<Id>();
    while (p && !seen.has(p.id)) {
      if (p.location) return p.location;
      seen.add(p.id);
      p = p.parentId ? this.places.get(p.parentId) : undefined;
    }
    return undefined;
  }

  ancestors(placeId: Id): Id[] {
    const out: Id[] = [];
    const seen = new Set<Id>([placeId]);
    let p = this.places.get(placeId);
    while (p?.parentId && !seen.has(p.parentId)) {
      out.push(p.parentId);
      seen.add(p.parentId);
      p = this.places.get(p.parentId);
    }
    return out;
  }

  /** True when one place is inside the other or they are the same (CC-1 nesting rule). */
  nested(a: Id, b: Id): boolean {
    return a === b || this.ancestors(a).includes(b) || this.ancestors(b).includes(a);
  }

  isPlaceholder(placeId: Id): boolean {
    return !!this.places.get(placeId)?.isPlaceholder;
  }

  speedOf(modeId: Id): number {
    return this.world.settings.travelModes.find((m) => m.id === modeId)?.speedKmPerDay ?? 30;
  }

  /** The path a journey follows: its drawn route (WH-6), else straight through its waypoints. */
  journeyPath(j: Journey): LatLng[] | undefined {
    if (j.route && j.route.length >= 2) return j.route;
    const pts = [j.originId, ...j.waypointIds, j.destinationId].map((id) => this.locationOf(id));
    if (pts.some((p) => !p)) return undefined;
    return pts as LatLng[];
  }

  /** Length of the journey's path: the drawn route, or great-circle legs through waypoints (WH-8). */
  journeyDistanceKm(j: Journey): number | undefined {
    const pts = this.journeyPath(j);
    if (!pts) return undefined;
    let sum = 0;
    for (let i = 1; i < pts.length; i++) sum += greatCircleKm(pts[i - 1], pts[i], this.world.settings.radiusKm);
    return sum;
  }

  /** A drawn route already follows the roads, so it needs no detour allowance. */
  detourOf(j: Journey): number {
    if (j.route && j.route.length >= 2) return 1;
    return j.detourFactor ?? this.world.settings.defaultDetourFactor ?? DEFAULT_DETOUR_FACTOR;
  }

  // Keyed by the record itself, so an edited copy of a journey (in the editor) is worked out afresh.
  private factorCache = new WeakMap<Journey, TravelFactor>();
  private modCache = {};
  /** WH-9: how much terrain, season, danger and current change this journey's time (1 = not at all). */
  travelFactorOf(j: Journey): TravelFactor {
    if (!j.departure) return { factor: 1, parts: [] };
    let f = this.factorCache.get(j);
    if (!f) {
      f = travelFactor(this.world, this.journeyPath(j), j.modeId, this.win(j.departure).earliest, this.modCache);
      this.factorCache.set(j, f);
    }
    return f;
  }

  /** WH-8: suggested number of travel days, or undefined when places lack positions. WH-9 modifiers apply when switched on. */
  suggestedTravelDays(j: Journey): number | undefined {
    const km = this.journeyDistanceKm(j);
    if (km === undefined) return undefined;
    return travelDays(km * this.travelFactorOf(j).factor, this.speedOf(j.modeId), this.detourOf(j));
  }

  stayEnd(s: Stay): { end: DayWindow; open: boolean } {
    if (s.departure) return { end: this.win(s.departure), open: false };
    const a = this.win(s.arrival);
    if (s.durationDays !== undefined) return { end: { earliest: a.earliest + s.durationDays, latest: a.latest + s.durationDays }, open: false };
    return { end: { earliest: a.earliest, latest: OPEN_END }, open: true };
  }

  journeyEnd(j: Journey): { end: DayWindow; suggested: boolean } {
    if (j.arrival) return { end: this.win(j.arrival), suggested: false };
    const d = this.win(j.departure);
    const days = this.suggestedTravelDays(j) ?? 1;
    return { end: { earliest: d.earliest + days, latest: d.latest + days }, suggested: true };
  }

  /** Members of a group with their membership windows (DM-5). */
  membersOf(groupId: Id): { characterId: Id; from: DayWindow | null; to: DayWindow | null }[] {
    return this.world.memberships
      .filter((m) => m.groupId === groupId)
      .map((m) => ({
        characterId: m.characterId,
        from: m.start ? this.win(m.start) : null,
        to: m.end ? this.win(m.end) : null,
      }));
  }


  stayBase(s: Stay): Omit<Segment, 'characterId' | 'viaGroupId'> {
    const { end, open } = this.stayEnd(s);
    return { kind: 'stay', recordId: s.id, start: this.win(s.arrival), end, openEnded: open, placeId: s.placeId };
  }

  journeyBase(j: Journey): Omit<Segment, 'characterId' | 'viaGroupId'> {
    const { end, suggested } = this.journeyEnd(j);
    return { kind: 'journey', recordId: j.id, start: this.win(j.departure), end, openEnded: false, placeId: j.originId, destinationId: j.destinationId, arrivalSuggested: suggested };
  }

  /** All segments for one character: own entries plus group entries during membership (cached). */
  segmentsFor(characterId: Id): Segment[] {
    const cached = this.segmentCache.get(characterId);
    if (cached) return cached;
    const out: Segment[] = [];
    for (const s of this.staysOf('character', characterId)) out.push({ ...this.stayBase(s), characterId });
    for (const j of this.journeysOf('character', characterId)) out.push({ ...this.journeyBase(j), characterId });
    for (const m of this.membershipsByCharacter.get(characterId) ?? []) {
      const from = m.start ? this.win(m.start) : null;
      const to = m.end ? this.win(m.end) : null;
      const bases = [...this.staysOf('group', m.groupId).map((s) => this.stayBase(s)), ...this.journeysOf('group', m.groupId).map((j) => this.journeyBase(j))];
      for (const base of bases) {
        const clipped = clip(base, from, to);
        if (clipped) out.push({ ...clipped, characterId, viaGroupId: m.groupId });
      }
    }
    out.sort((a, b) => nominalStart(a) - nominalStart(b) || nominalEnd(a) - nominalEnd(b));
    this.segmentCache.set(characterId, out);
    return out;
  }
}

function clip(seg: Omit<Segment, 'characterId' | 'viaGroupId'>, from: DayWindow | null, to: DayWindow | null) {
  let { start, end } = seg;
  if (from) {
    if (end.latest < from.earliest) return null;
    start = { earliest: Math.max(start.earliest, from.earliest), latest: Math.max(start.latest, from.latest) };
  }
  if (to) {
    if (start.earliest > to.latest) return null;
    end = { earliest: Math.min(end.earliest, to.earliest), latest: Math.min(end.latest, to.latest) };
  }
  return { ...seg, start, end, openEnded: seg.openEnded && !to };
}

/** Representative day the segment starts (midpoint of its window). */
export function nominalStart(s: Segment): number {
  return midpoint(s.start);
}
export function nominalEnd(s: Segment): number {
  return s.end.latest === OPEN_END ? OPEN_END : midpoint(s.end);
}

export type Whereabouts =
  | { kind: 'stay'; placeId: Id; segment: Segment; position?: LatLng }
  | { kind: 'journey'; fromId: Id; toId: Id; progress: number; segment: Segment; position?: LatLng }
  | { kind: 'unknown' }
  | { kind: 'not-born' }
  | { kind: 'dead' };

/** VW-5: where is a character on a given day. Own entries win over group entries (DM-5). */
export function whereIs(ix: WorldIndex, characterId: Id, day: number): Whereabouts {
  const c = ix.characters.get(characterId);
  if (c?.birth && day < midpoint(ix.win(c.birth))) return { kind: 'not-born' };
  if (c?.death && day > midpoint(ix.win(c.death))) return { kind: 'dead' };
  const segs = ix.segmentsFor(characterId).filter((s) => nominalStart(s) <= day && day <= nominalEnd(s));
  if (segs.length === 0) return { kind: 'unknown' };
  // Prefer own over group; among equals prefer journeys (more specific in time), then latest start.
  segs.sort((a, b) => Number(!!a.viaGroupId) - Number(!!b.viaGroupId) || (a.kind === 'journey' ? -1 : 0) - (b.kind === 'journey' ? -1 : 0) || nominalStart(b) - nominalStart(a));
  const s = segs[0];
  if (s.kind === 'stay') return { kind: 'stay', placeId: s.placeId, segment: s, position: ix.locationOf(s.placeId) };
  const a = nominalStart(s);
  const b = nominalEnd(s);
  const progress = b > a ? (day - a) / (b - a) : 1;
  const j = ix.journeys.get(s.recordId);
  const path = j ? ix.journeyPath(j) : undefined;
  const position = path ? pointAlong(path, Math.max(0, Math.min(1, progress)), ix.world.settings.radiusKm) : undefined;
  return { kind: 'journey', fromId: s.placeId, toId: s.destinationId!, progress, segment: s, position };
}

/** The point a fraction of the way along a path, measured in great-circle km. */
export function pointAlong(pts: LatLng[], fraction: number, R: number): LatLng {
  if (pts.length === 1) return pts[0];
  const legs = pts.slice(1).map((p, i) => greatCircleKm(pts[i], p, R));
  let left = fraction * legs.reduce((a, b) => a + b, 0);
  for (let i = 0; i < legs.length; i++) {
    if (left <= legs[i] || i === legs.length - 1) {
      const t = legs[i] ? Math.min(1, left / legs[i]) : 0;
      const n = 32;
      return interpolateGreatCircle(pts[i], pts[i + 1], n)[Math.round(t * n)];
    }
    left -= legs[i];
  }
  return pts[pts.length - 1];
}
