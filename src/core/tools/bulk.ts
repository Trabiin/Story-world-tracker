/**
 * EU-4: change many records at once. "Push everything after the siege back two weeks" shifts
 * every exact date on or after a day; relative dates follow their anchors by themselves.
 */
import { DayWindow, FuzzyDate, fromDay, toWindow } from '../dates';
import type { Character, Id, Importance, World } from '../model';

export interface ShiftOptions {
  /** Shift dates that start on or after this day. */
  fromDay: number;
  days: number;
  /** Only records about these characters (and groups they belong to). Absent = everyone. */
  characterIds?: Id[];
}

export interface ShiftResult { world: World; shifted: number; records: number; skipped: number }

const isDate = (v: unknown): v is FuzzyDate => !!v && typeof v === 'object' && typeof (v as FuzzyDate).year === 'number' && typeof (v as FuzzyDate).precision === 'string';

/** Collections a shift touches. Births, deaths and the map's history are left alone. */
const SHIFTED = ['stays', 'journeys', 'scenes', 'events', 'memberships', 'relationships', 'secrets', 'characters'] as const;
const SKIP_KEYS = new Set(['birth', 'death', 'createdAt', 'updatedAt']);

export function shiftDates(world: World, o: ShiftOptions): ShiftResult {
  const h = world.settings.hemisphereForSeasons;
  let shifted = 0, skipped = 0, records = 0;
  const shiftOne = (d: FuzzyDate): FuzzyDate => {
    if (d.rel) return d; // follows its anchor
    const w: DayWindow = toWindow(d, h);
    if (w.earliest < o.fromDay) return d;
    if (d.precision === 'day') { shifted++; return { ...fromDay(w.earliest + o.days), ...(d.approximate ? { approximate: true } : {}) }; }
    if (o.days % 365 === 0) { shifted++; return { ...d, year: d.year + o.days / 365 }; }
    skipped++;
    return d;
  };
  const walk = (v: unknown, depth: number): unknown => {
    if (depth > 6 || !v || typeof v !== 'object') return v;
    if (isDate(v)) return shiftOne(v);
    if (Array.isArray(v)) {
      let out: unknown[] | undefined;
      v.forEach((x, i) => { const n = walk(x, depth + 1); if (n !== x) (out ??= v.slice())[i] = n; });
      return out ?? v;
    }
    let out: Record<string, unknown> | undefined;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (SKIP_KEYS.has(k) || !x || typeof x !== 'object' || k === 'route' || k === 'area') continue;
      const n = walk(x, depth + 1);
      if (n !== x) (out ??= { ...(v as Record<string, unknown>) })[k] = n;
    }
    return out ?? v;
  };
  const ids = o.characterIds ? new Set(o.characterIds) : undefined;
  const groups = ids ? new Set(world.memberships.filter((m) => ids.has(m.characterId)).map((m) => m.groupId)) : undefined;
  const about = (c: (typeof SHIFTED)[number], r: Record<string, unknown>): boolean => {
    if (!ids) return true;
    const subj = r.subject as { kind: string; id: Id } | undefined;
    if (subj) return subj.kind === 'character' ? ids.has(subj.id) : !!groups?.has(subj.id) && o.characterIds!.length > 0 && allMembersChosen(world, subj.id, ids);
    if (c === 'characters') return ids.has(r.id as Id);
    if (c === 'memberships') return ids.has(r.characterId as Id);
    if (c === 'relationships') return ids.has(r.aId as Id) || ids.has(r.bId as Id);
    if (c === 'scenes') return ids.has(r.povCharacterId as Id) || (r.characterIds as Id[]).some((x) => ids.has(x));
    if (c === 'events') return (r.characterIds as Id[]).some((x) => ids.has(x));
    if (c === 'secrets') return false;
    return false;
  };
  const next = { ...world } as World;
  for (const c of SHIFTED) {
    const list = world[c] as unknown as Record<string, unknown>[];
    let changed = false;
    const out = list.map((r) => {
      if (!about(c, r)) return r;
      const before = shifted;
      const n = walk(r, 0) as Record<string, unknown>;
      if (n !== r) { changed = true; if (shifted > before) records++; }
      return n;
    });
    if (changed) (next as unknown as Record<string, unknown>)[c] = out;
  }
  return { world: shifted ? next : world, shifted, records, skipped };
}

/** A group's own stays move with a character filter only when every member is chosen. */
function allMembersChosen(world: World, groupId: Id, ids: Set<Id>): boolean {
  const members = world.memberships.filter((m) => m.groupId === groupId).map((m) => m.characterId);
  return members.length > 0 && members.every((m) => ids.has(m));
}

export type BulkCharacterEdit =
  | { kind: 'add-tag'; tag: string }
  | { kind: 'remove-tag'; tag: string }
  | { kind: 'importance'; importance: Importance }
  | { kind: 'archive'; archived: boolean };

/** EU-4: one change to many characters. */
export function bulkEditCharacters(world: World, ids: Id[], e: BulkCharacterEdit): World {
  const set = new Set(ids);
  const edit = (c: Character): Character => {
    switch (e.kind) {
      case 'add-tag': return c.tags.includes(e.tag) ? c : { ...c, tags: [...c.tags, e.tag] };
      case 'remove-tag': return c.tags.includes(e.tag) ? { ...c, tags: c.tags.filter((t) => t !== e.tag) } : c;
      case 'importance': return c.importance === e.importance ? c : { ...c, importance: e.importance };
      case 'archive': return c.archived === e.archived ? c : { ...c, archived: e.archived };
    }
  };
  return { ...world, characters: world.characters.map((c) => (set.has(c.id) ? edit(c) : c)) };
}
