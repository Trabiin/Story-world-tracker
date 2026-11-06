/**
 * Phase 4 consistency checks: CC-4 activity after death or before birth, CC-5 visiting a place
 * outside its existence dates, CC-6 a character in a scene somewhere other than where they stay,
 * and (CH-8) learning of an event before it happens.
 */
import { DayWindow, formatDayNumber, midpoint, toWindow } from '../dates';
import type { Id, Place, World } from '../model';
import { scenePlace, scenePov } from '../story';
import { WorldIndex, whereIs } from '../whereabouts';
import { eventWindow } from '../events/events';

export type PeopleRule = 'life-span' | 'place-existence' | 'scene-place' | 'knowledge-order';

export interface PeopleIssue {
  key: string;
  rule: PeopleRule;
  message: string;
  characterId?: Id;
  refs: { kind: 'stay' | 'journey' | 'scene' | 'event' | 'membership' | 'secret' | 'character' | 'place'; id: Id }[];
  day?: number;
}

const fmt = formatDayNumber;

export function checkPeople(world: World, ix: WorldIndex = new WorldIndex(world)): PeopleIssue[] {
  return [...checkLifeSpans(ix), ...checkPlaceExistence(ix), ...checkScenePlaces(ix), ...checkKnowledgeOrder(world)];
}

/** CC-4 */
export function checkLifeSpans(ix: WorldIndex): PeopleIssue[] {
  const w = ix.world;
  const out: PeopleIssue[] = [];
  for (const c of w.characters) {
    if (c.archived || (!c.birth && !c.death)) continue;
    const born = c.birth ? ix.win(c.birth) : undefined;
    const died = c.death ? ix.win(c.death) : undefined;
    const before = (x: DayWindow) => !!born && x.latest < born.earliest;
    const after = (x: DayWindow) => !!died && x.earliest > died.latest;
    const flag = (x: DayWindow, what: string, ref: PeopleIssue['refs'][number]) => {
      if (before(x)) out.push({ key: `life-span:${c.id}:${ref.id}`, rule: 'life-span', characterId: c.id, refs: [ref], day: x.earliest, message: `${c.name} ${what} on ${fmt(x.earliest)}, before being born (${fmt(born!.earliest)}).` });
      else if (after(x)) out.push({ key: `life-span:${c.id}:${ref.id}`, rule: 'life-span', characterId: c.id, refs: [ref], day: x.earliest, message: `${c.name} ${what} on ${fmt(x.earliest)}, after dying (${fmt(died!.latest)}).` });
    };
    for (const s of ix.staysOf('character', c.id)) flag(ix.win(s.arrival), `arrives at ${ix.places.get(s.placeId)?.name ?? '?'}`, { kind: 'stay', id: s.id });
    for (const j of ix.journeysOf('character', c.id)) flag(ix.win(j.departure), `sets out for ${ix.places.get(j.destinationId)?.name ?? '?'}`, { kind: 'journey', id: j.id });
    for (const m of w.memberships) if (m.characterId === c.id && m.start) flag(ix.win(m.start), `joins ${w.groups.find((g) => g.id === m.groupId)?.name ?? 'a group'}`, { kind: 'membership', id: m.id });
    for (const s of w.scenes) {
      if (!s.start || !(s.characterIds.includes(c.id) || scenePov(w, s) === c.id)) continue;
      flag(ix.win(s.start), `appears in the scene “${s.title || 'untitled'}”`, { kind: 'scene', id: s.id });
    }
    for (const e of w.events) {
      if (!e.characterIds.includes(c.id) || e.kind === 'death' || e.kind === 'birth') continue;
      const ew = eventWindow(w, e);
      if (ew) flag(ew, `takes part in ${e.name}`, { kind: 'event', id: e.id });
    }
    for (const sec of w.secrets) for (const k of sec.knowers) if (k.characterId === c.id && k.from) flag(ix.win(k.from), `learns “${sec.title}”`, { kind: 'secret', id: sec.id });
  }
  return out;
}

/** The span a place exists for: its own dates, narrowed by the places it is inside (a room in a castle built in 1050). */
function existence(ix: WorldIndex, placeId: Id): { from?: { day: number; by: Place }; to?: { day: number; by: Place } } {
  let from: { day: number; by: Place } | undefined, to: { day: number; by: Place } | undefined;
  for (const id of [placeId, ...ix.ancestors(placeId)]) {
    const p = ix.places.get(id);
    if (!p) continue;
    if (p.start) { const d = ix.win(p.start).earliest; if (!from || d > from.day) from = { day: d, by: p }; }
    if (p.end) { const d = ix.win(p.end).latest; if (!to || d < to.day) to = { day: d, by: p }; }
  }
  return { from, to };
}

/** CC-5 */
export function checkPlaceExistence(ix: WorldIndex): PeopleIssue[] {
  const w = ix.world;
  if (!w.places.some((p) => p.start || p.end)) return [];
  const out: PeopleIssue[] = [];
  const who = (s: { kind: 'character' | 'group'; id: Id }) => (s.kind === 'character' ? ix.characters.get(s.id)?.name : w.groups.find((g) => g.id === s.id)?.name) ?? '?';
  const test = (placeId: Id, at: DayWindow, what: string, ref: PeopleIssue['refs'][number], characterId?: Id) => {
    const e = existence(ix, placeId);
    const p = ix.places.get(placeId)?.name ?? '?';
    const inside = (by: Place) => (by.id === placeId ? '' : ` (it is inside ${by.name})`);
    if (e.from && at.latest < e.from.day) out.push({ key: `place-existence:${ref.id}:${placeId}`, rule: 'place-existence', characterId, refs: [ref, { kind: 'place', id: placeId }], day: at.earliest, message: `${what} ${p} on ${fmt(at.earliest)}, but ${e.from.by.name} only exists from ${fmt(e.from.day)}${inside(e.from.by)}.` });
    else if (e.to && at.earliest > e.to.day) out.push({ key: `place-existence:${ref.id}:${placeId}`, rule: 'place-existence', characterId, refs: [ref, { kind: 'place', id: placeId }], day: at.earliest, message: `${what} ${p} on ${fmt(at.earliest)}, but ${e.to.by.name} is gone after ${fmt(e.to.day)}${inside(e.to.by)}.` });
  };
  for (const s of w.stays) test(s.placeId, ix.win(s.arrival), `${who(s.subject)} arrives at`, { kind: 'stay', id: s.id }, s.subject.kind === 'character' ? s.subject.id : undefined);
  for (const j of w.journeys) {
    const cid = j.subject.kind === 'character' ? j.subject.id : undefined;
    test(j.originId, ix.win(j.departure), `${who(j.subject)} leaves`, { kind: 'journey', id: j.id }, cid);
    test(j.destinationId, ix.journeyEnd(j).end, `${who(j.subject)} reaches`, { kind: 'journey', id: j.id }, cid);
  }
  for (const e of w.events) {
    const ew = eventWindow(w, e);
    if (e.placeId && ew) test(e.placeId, ew, `${e.name} takes place at`, { kind: 'event', id: e.id });
  }
  return out;
}

/** CC-6 */
export function checkScenePlaces(ix: WorldIndex): PeopleIssue[] {
  const w = ix.world;
  const out: PeopleIssue[] = [];
  for (const s of w.scenes) {
    if (!s.start) continue;
    const sp = scenePlace(ix, s).placeId;
    if (!sp || ix.isPlaceholder(sp)) continue;
    const day = midpoint(ix.win(s.start));
    const pov = scenePov(w, s);
    for (const cid of new Set([...(pov ? [pov] : []), ...s.characterIds])) {
      const where = whereIs(ix, cid, day);
      if (where.kind !== 'stay' || ix.isPlaceholder(where.placeId) || ix.nested(where.placeId, sp)) continue;
      const c = ix.characters.get(cid);
      out.push({
        key: `scene-place:${s.id}:${cid}`, rule: 'scene-place', characterId: cid, day,
        refs: [{ kind: 'scene', id: s.id }, { kind: 'stay', id: where.segment.recordId }],
        message: `${c?.name ?? '?'} is in the scene “${s.title || 'untitled'}” at ${ix.places.get(sp)?.name ?? '?'} on ${fmt(day)}, but stays at ${ix.places.get(where.placeId)?.name ?? '?'} then.`,
      });
    }
  }
  return out;
}

/** CH-8: a character learns of an event before it happens. */
export function checkKnowledgeOrder(world: World): PeopleIssue[] {
  const out: PeopleIssue[] = [];
  for (const sec of world.secrets) {
    const e = sec.eventId ? world.events.find((x) => x.id === sec.eventId) : undefined;
    const ew = e && eventWindow(world, e);
    if (!ew) continue;
    for (const k of sec.knowers) {
      if (!k.from) continue;
      const kw = toWindow(k.from, world.settings.hemisphereForSeasons);
      if (kw.latest >= ew.earliest) continue;
      const c = world.characters.find((x) => x.id === k.characterId);
      out.push({ key: `knowledge-order:${sec.id}:${k.characterId}`, rule: 'knowledge-order', characterId: k.characterId, refs: [{ kind: 'secret', id: sec.id }, { kind: 'event', id: e!.id }], day: kw.earliest, message: `${c?.name ?? '?'} learns “${sec.title}” on ${fmt(kw.earliest)}, before ${e!.name} happens (${fmt(ew.earliest)}).` });
    }
  }
  return out;
}
