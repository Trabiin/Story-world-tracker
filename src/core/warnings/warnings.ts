/**
 * One warnings engine (DM-8, CC-7, D-9). Rules produce warnings, never blocks.
 * Phase 1a rules: CC-1 two places at once, CC-2 gaps, CC-3 impossible travel,
 * WH-13 missing journey between stays, WH-3 open-ended stays, WH-12 unresolved placeholders.
 */
import { formatDayNumber } from '../dates';
import type { Id, Journey, World } from '../model';
import { OPEN_END, Segment, WorldIndex, nominalEnd, nominalStart } from '../whereabouts';

export type RuleId = 'two-places' | 'gap' | 'impossible-travel' | 'missing-journey' | 'open-stay' | 'placeholder';

export const RULES: Record<RuleId, { name: string; requirement: string; severity: 'warning' | 'info' }> = {
  'two-places': { name: 'In two places at once', requirement: 'CC-1', severity: 'warning' },
  gap: { name: 'Whereabouts unaccounted for', requirement: 'CC-2', severity: 'warning' },
  'impossible-travel': { name: 'Impossible travel time', requirement: 'CC-3', severity: 'warning' },
  'missing-journey': { name: 'Moved without a journey', requirement: 'WH-13', severity: 'warning' },
  'open-stay': { name: 'Open-ended stay', requirement: 'WH-3', severity: 'info' },
  placeholder: { name: 'Unknown place to resolve', requirement: 'WH-12', severity: 'info' },
};

export interface RecordRef {
  kind: 'stay' | 'journey' | 'character' | 'place' | 'group';
  id: Id;
}

export interface SuggestedJourney {
  subject: { kind: 'character' | 'group'; id: Id };
  originId: Id;
  destinationId: Id;
  departureDay: number;
}

export interface Warning {
  key: string; // stable across runs, used for "intentional" dismissals
  rule: RuleId;
  severity: 'warning' | 'info';
  characterId?: Id;
  message: string;
  refs: RecordRef[];
  day?: number; // where on the timeline to jump to
  fix?: { kind: 'create-journey'; journey: SuggestedJourney };
  dismissed?: { note: string; at: string };
}

const ref = (s: Segment): RecordRef => ({ kind: s.kind, id: s.recordId });

function name(ix: WorldIndex, kind: 'character' | 'place', id: Id | undefined): string {
  if (!id) return '?';
  return (kind === 'character' ? ix.characters.get(id)?.name : ix.places.get(id)?.name) ?? '?';
}

function describe(ix: WorldIndex, s: Segment): string {
  return s.kind === 'stay'
    ? `stay at ${name(ix, 'place', s.placeId)}`
    : `journey ${name(ix, 'place', s.placeId)} → ${name(ix, 'place', s.destinationId)}`;
}

/** CC-1: certain overlap means each one certainly ends after the other certainly starts. */
function certainlyOverlap(a: Segment, b: Segment): boolean {
  return a.end.earliest > b.start.latest && b.end.earliest > a.start.latest;
}

function placesCompatible(ix: WorldIndex, a: Segment, b: Segment): boolean {
  if (a.kind === 'stay' && b.kind === 'stay') return ix.nested(a.placeId, b.placeId) || ix.isPlaceholder(a.placeId) || ix.isPlaceholder(b.placeId);
  return false;
}

export function checkCharacter(ix: WorldIndex, characterId: Id): Warning[] {
  const out: Warning[] = [];
  const segs = ix.segmentsFor(characterId);
  const who = name(ix, 'character', characterId);

  // CC-1
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const a = segs[i], b = segs[j];
      if (a.recordId === b.recordId) continue;
      // Own entries win over group entries (DM-5): no conflict between own and group.
      if (!!a.viaGroupId !== !!b.viaGroupId) continue;
      if (!certainlyOverlap(a, b) || placesCompatible(ix, a, b)) continue;
      out.push({
        key: `two-places:${characterId}:${[a.recordId, b.recordId].sort().join('+')}`,
        rule: 'two-places',
        severity: 'warning',
        characterId,
        message: `${who} is in two places at once: ${describe(ix, a)} overlaps ${describe(ix, b)}${a.viaGroupId || b.viaGroupId ? ' (via group)' : ''}.`,
        refs: [ref(a), ref(b)],
        day: Math.max(a.start.latest, b.start.latest),
      });
    }
  }

  // CC-2 gaps and WH-13 missing journeys, walking the chain in time order.
  let coveredUntil = -Infinity; // latest possible end so far
  let prev: Segment | undefined;
  for (const s of segs) {
    if (prev && s.start.earliest > coveredUntil + 1) {
      const from = coveredUntil + 1, to = s.start.earliest - 1;
      out.push({
        key: `gap:${characterId}:${prev.recordId}>${s.recordId}`,
        rule: 'gap',
        severity: 'warning',
        characterId,
        message: `${who}'s whereabouts are unknown from ${formatDayNumber(from)} to ${formatDayNumber(to)} (${to - from + 1} days), between the ${describe(ix, prev)} and the ${describe(ix, s)}.`,
        refs: [ref(prev), ref(s)],
        day: from,
      });
    }
    // WH-13: two stays in a row at different places with no journey between.
    if (prev && prev.kind === 'stay' && s.kind === 'stay' && !ix.nested(prev.placeId, s.placeId) && !ix.isPlaceholder(prev.placeId) && !ix.isPlaceholder(s.placeId)) {
      const subject = prev.viaGroupId && prev.viaGroupId === s.viaGroupId ? { kind: 'group' as const, id: prev.viaGroupId } : { kind: 'character' as const, id: characterId };
      out.push({
        key: `missing-journey:${characterId}:${prev.recordId}>${s.recordId}`,
        rule: 'missing-journey',
        severity: 'warning',
        characterId,
        message: `${who} goes from ${name(ix, 'place', prev.placeId)} to ${name(ix, 'place', s.placeId)} with no journey between them.`,
        refs: [ref(prev), ref(s)],
        day: nominalEnd(prev) === OPEN_END ? nominalStart(s) : nominalEnd(prev),
        fix: {
          kind: 'create-journey',
          journey: { subject, originId: prev.placeId, destinationId: s.placeId, departureDay: nominalEnd(prev) === OPEN_END ? nominalStart(s) : nominalEnd(prev) },
        },
      });
    }
    coveredUntil = Math.max(coveredUntil, s.end.latest);
    prev = s;
  }
  return out;
}

/** CC-3 per journey record (checked once, whoever travels). */
export function checkJourney(ix: WorldIndex, j: Journey): Warning[] {
  if (!j.arrival) return [];
  const dep = ix.win(j.departure);
  const arr = ix.win(j.arrival);
  const subjectName = j.subject.kind === 'character' ? name(ix, 'character', j.subject.id) : ix.world.groups.find((g) => g.id === j.subject.id)?.name ?? '?';
  const route = `${name(ix, 'place', j.originId)} → ${name(ix, 'place', j.destinationId)}`;
  const maxDays = arr.latest - dep.earliest;
  if (maxDays < 0) {
    return [{ key: `impossible-travel:${j.id}:order`, rule: 'impossible-travel', severity: 'warning', message: `${subjectName} arrives before leaving on the journey ${route}.`, refs: [{ kind: 'journey', id: j.id }], day: dep.earliest }];
  }
  const km = ix.journeyDistanceKm(j);
  if (km === undefined) return [];
  const speed = ix.speedOf(j.modeId);
  const neededDays = (km * ix.detourOf(j)) / speed;
  // A journey arriving on its departure day still gets that one day (inclusive counting).
  if (neededDays <= maxDays + 1) return [];
  const mode = ix.world.settings.travelModes.find((m) => m.id === j.modeId)?.name.toLowerCase() ?? j.modeId;
  return [{
    key: `impossible-travel:${j.id}`,
    rule: 'impossible-travel',
    severity: 'warning',
    message: `${subjectName} travels ${route} (${Math.round(km)} km straight, ~${Math.round(km * ix.detourOf(j))} km by road) by ${mode} in at most ${maxDays + 1} day(s), but it needs about ${Math.ceil(neededDays)}.`,
    refs: [{ kind: 'journey', id: j.id }],
    day: dep.earliest,
  }];
}

export function checkWorld(world: World): Warning[] {
  const ix = new WorldIndex(world);
  const out: Warning[] = [];
  for (const c of world.characters) if (!c.archived) out.push(...checkCharacter(ix, c.id));
  for (const j of world.journeys) out.push(...checkJourney(ix, j));
  for (const s of world.stays) {
    const subj = s.subject.kind === 'character' ? name(ix, 'character', s.subject.id) : world.groups.find((g) => g.id === s.subject.id)?.name ?? '?';
    if (!s.departure && s.durationDays === undefined) {
      out.push({ key: `open-stay:${s.id}`, rule: 'open-stay', severity: 'info', message: `${subj} stays at ${name(ix, 'place', s.placeId)} until further notice.`, refs: [{ kind: 'stay', id: s.id }], day: ix.win(s.arrival).earliest });
    }
    if (ix.isPlaceholder(s.placeId)) {
      out.push({ key: `placeholder:${s.id}`, rule: 'placeholder', severity: 'info', message: `${subj} is somewhere unknown (${name(ix, 'place', s.placeId)}) from ${formatDayNumber(ix.win(s.arrival).earliest)}.`, refs: [{ kind: 'stay', id: s.id }], day: ix.win(s.arrival).earliest });
    }
  }
  const disabled = new Set(world.settings.disabledRules);
  const dismissed = new Map(world.dismissals.map((d) => [d.key, d]));
  // De-duplicate (group conflicts show once per member, which is intended; identical keys collapse).
  const seen = new Set<string>();
  return out
    .filter((w) => !disabled.has(w.rule) && !seen.has(w.key) && seen.add(w.key))
    .map((w) => {
      const d = dismissed.get(w.key);
      return d ? { ...w, dismissed: { note: d.note, at: d.at } } : w;
    });
}
