/**
 * VW-3 character track and VW-4 place view: the same segments seen per character and per place.
 */
import type { LatLng } from '../globe';
import type { Id } from '../model';
import { OPEN_END, Segment, WorldIndex, nominalEnd, nominalStart } from './whereabouts';

export interface TrackStop {
  placeId: Id;
  at: LatLng;
  start: number;
  /** OPEN_END when the stay has no end yet. */
  end: number;
  recordIds: Id[];
}

export interface TrackLeg {
  journeyId: Id;
  path: LatLng[];
  start: number;
  end: number;
  fromId: Id;
  toId: Id;
}

/** VW-3: one character's whole path: where they stayed (merged when they stay on at the same place) and how they travelled. */
export function characterTrack(ix: WorldIndex, characterId: Id): { stops: TrackStop[]; legs: TrackLeg[] } {
  const stops: TrackStop[] = [];
  const legs: TrackLeg[] = [];
  const segs = ix.segmentsFor(characterId);
  // Own entries win over group entries (DM-5): drop group stays that an own entry covers.
  const own = segs.filter((s) => !s.viaGroupId);
  const covered = (s: Segment) => own.some((o) => nominalStart(o) <= nominalStart(s) && nominalEnd(s) <= nominalEnd(o));
  for (const s of segs) {
    if (s.viaGroupId && covered(s)) continue;
    if (s.kind === 'stay') {
      const at = ix.locationOf(s.placeId);
      if (!at) continue;
      const last = stops[stops.length - 1];
      const prevLeg = legs[legs.length - 1];
      if (last && last.placeId === s.placeId && (!prevLeg || prevLeg.start < last.start)) {
        last.end = Math.max(last.end, nominalEnd(s));
        last.recordIds.push(s.recordId);
        continue;
      }
      stops.push({ placeId: s.placeId, at, start: nominalStart(s), end: nominalEnd(s), recordIds: [s.recordId] });
    } else {
      const j = ix.journeys.get(s.recordId);
      const path = j && ix.journeyPath(j);
      if (!path) continue;
      legs.push({ journeyId: s.recordId, path, start: nominalStart(s), end: nominalEnd(s), fromId: s.placeId, toId: s.destinationId! });
    }
  }
  return { stops, legs };
}

export interface PlaceVisit {
  subject: { kind: 'character'; id: Id };
  /** The exact place (may be inside the one asked about). */
  placeId: Id;
  kind: 'stay' | 'arrives' | 'departs' | 'passes';
  start: number;
  end: number;
  recordId: Id;
  viaGroupId?: Id;
}

/** VW-4: who was at a place (or anywhere inside it), and when. Sorted by date. */
export function placeVisits(ix: WorldIndex, placeId: Id): PlaceVisit[] {
  const out: PlaceVisit[] = [];
  const inside = (p: Id) => p === placeId || ix.ancestors(p).includes(placeId);
  for (const c of ix.characters.values()) {
    for (const s of ix.segmentsFor(c.id)) {
      const base = { subject: { kind: 'character' as const, id: c.id }, recordId: s.recordId, viaGroupId: s.viaGroupId };
      if (s.kind === 'stay') {
        if (inside(s.placeId)) out.push({ ...base, placeId: s.placeId, kind: 'stay', start: nominalStart(s), end: nominalEnd(s) });
        continue;
      }
      const j = ix.journeys.get(s.recordId);
      if (inside(s.placeId)) out.push({ ...base, placeId: s.placeId, kind: 'departs', start: nominalStart(s), end: nominalStart(s) });
      if (s.destinationId && inside(s.destinationId)) out.push({ ...base, placeId: s.destinationId, kind: 'arrives', start: nominalEnd(s), end: nominalEnd(s) });
      for (const w of j?.waypointIds ?? []) if (inside(w)) out.push({ ...base, placeId: w, kind: 'passes', start: nominalStart(s), end: nominalEnd(s) });
    }
  }
  return out.sort((a, b) => a.start - b.start || a.subject.id.localeCompare(b.subject.id));
}

export const isOpen = (n: number) => n === OPEN_END;
