/**
 * TL-4: relative dates. A date can hang on a world event, a chapter or a scene ("three days after
 * the Battle of Varn", "before chapter 12"). The date keeps ordinary year/month/day fields, kept up
 * to date here whenever the anchor moves, so the rest of the app needs to know nothing about it.
 */
import { DayWindow, FuzzyDate, Hemisphere, RelativeAnchor, fromDay, toWindow } from '../dates';
import type { Id, World } from '../model';

/** Collections whose records may hold dates. Manuscripts and terrain never do. */
const DATED: (keyof World)[] = ['characters', 'places', 'memberships', 'stays', 'journeys', 'scenes', 'events', 'relationships', 'secrets', 'mapFeatures', 'regions'];

const isDate = (v: unknown): v is FuzzyDate => !!v && typeof v === 'object' && typeof (v as FuzzyDate).year === 'number' && typeof (v as FuzzyDate).precision === 'string';

/** The window an anchor stands for: an event's start, a scene's start, or the earliest scene in a chapter. */
export function anchorWindow(world: World, a: { kind: RelativeAnchor['kind']; id: Id }, hemi: Hemisphere = world.settings.hemisphereForSeasons): DayWindow | undefined {
  if (a.kind === 'event') {
    const e = world.events.find((x) => x.id === a.id);
    return e?.start ? toWindow(e.start, hemi) : undefined;
  }
  if (a.kind === 'scene') {
    const s = world.scenes.find((x) => x.id === a.id);
    return s?.start ? toWindow(s.start, hemi) : undefined;
  }
  let best: DayWindow | undefined;
  for (const s of world.scenes) {
    if (s.chapterId !== a.id || !s.start) continue;
    const w = toWindow(s.start, hemi);
    if (!best || w.earliest < best.earliest) best = w;
  }
  return best;
}

/** The absolute date a relative one stands for now, or undefined while its anchor has no date. */
export function resolveOne(world: World, d: FuzzyDate): FuzzyDate | undefined {
  if (!d.rel) return d;
  const w = anchorWindow(world, d.rel);
  if (!w) return undefined;
  const exact = w.earliest === w.latest;
  const day = (exact ? w.earliest : Math.floor((w.earliest + w.latest) / 2)) + d.rel.days;
  // A day counted from a fuzzy anchor is only as sure as the anchor.
  return { ...fromDay(day), ...(exact ? {} : { approximate: true }), rel: d.rel };
}

const same = (a: FuzzyDate, b: FuzzyDate) => a.year === b.year && a.month === b.month && a.day === b.day && a.precision === b.precision && !!a.approximate === !!b.approximate;

/** Copy-on-write walk over a value, replacing relative dates that moved. */
function walk(world: World, v: unknown, depth: number): unknown {
  if (depth > 6 || !v || typeof v !== 'object') return v;
  if (isDate(v)) {
    if (!v.rel) return v;
    const r = resolveOne(world, v);
    return r && !same(r, v) ? r : v;
  }
  if (Array.isArray(v)) {
    let out: unknown[] | undefined;
    for (let i = 0; i < v.length; i++) {
      const n = walk(world, v[i], depth + 1);
      if (n !== v[i]) (out ??= v.slice())[i] = n;
    }
    return out ?? v;
  }
  let out: Record<string, unknown> | undefined;
  const o = v as Record<string, unknown>;
  for (const k in o) {
    const x = o[k];
    if (!x || typeof x !== 'object' || k === 'points' || k === 'area' || k === 'route' || k === 'roughPoints') continue;
    const n = walk(world, x, depth + 1);
    if (n !== x) (out ??= { ...o })[k] = n;
  }
  return out ?? v;
}

/** TL-4: bring every relative date in line with its anchor. Chains (an event three days after another) settle in a few passes. Returns the same world when nothing moved. */
export function resolveRelativeDates(world: World, passes = 6): World {
  let cur = world;
  for (let p = 0; p < passes; p++) {
    let next: World | undefined;
    for (const c of DATED) {
      const list = cur[c] as unknown[];
      const n = walk(cur, list, 0);
      if (n !== list) (next ??= { ...cur } as World)[c] = n as never;
    }
    if (!next) break;
    cur = next;
  }
  return cur;
}

export interface AnchorChoice {
  kind: RelativeAnchor['kind'];
  id: Id;
  name: string;
}

/** Names a relative date may hang on: events, chapters ("chapter 12" and the title) and scenes. */
export function anchorChoices(world: World): AnchorChoice[] {
  const out: AnchorChoice[] = world.events.map((e) => ({ kind: 'event' as const, id: e.id, name: e.name }));
  const books = [...world.books].sort((a, b) => a.order - b.order);
  let n = 0;
  for (const b of books) {
    for (const c of world.chapters.filter((x) => x.bookId === b.id).sort((x, y) => x.order - y.order)) {
      n++;
      out.push({ kind: 'chapter', id: c.id, name: `chapter ${n}` });
      if (c.title) out.push({ kind: 'chapter', id: c.id, name: c.title });
    }
  }
  for (const s of world.scenes) if (s.title) out.push({ kind: 'scene', id: s.id, name: s.title });
  return out;
}

const NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fourteen: 14, twenty: 20, thirty: 30, forty: 40, hundred: 100 };
const UNIT: Record<string, number> = { day: 1, days: 1, week: 7, weeks: 7, fortnight: 14, fortnights: 14, month: 30, months: 30, year: 365, years: 365 };

/**
 * TL-4: read "three days after the Battle of Varn", "2 weeks before chapter 12", "the day after X",
 * "before X" (one day before), "after X" (one day after), "on X" or "same day as X".
 */
export function parseRelativeDate(input: string, anchors: AnchorChoice[]): RelativeAnchor | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, ' ');
  const m = s.match(/^(?:(the )?((?:\d+|[a-z]+)(?: and a half)?) ?([a-z]+)? )?(after|before|on|same day as|the day of) (?:the )?(.+)$/);
  if (!m) return null;
  const target = m[5].trim();
  const hit = [...anchors].sort((a, b) => b.name.length - a.name.length).find((a) => {
    const n = a.name.toLowerCase().replace(/^the /, '');
    return n === target || n === target.replace(/^the /, '');
  });
  if (!hit) return null;
  const dir = m[4] === 'after' ? 1 : m[4] === 'before' ? -1 : 0;
  if (dir === 0) return m[2] ? null : { kind: hit.kind, id: hit.id, days: 0 };
  let days = 1;
  if (m[2]) {
    // "the day after" = 1 day; "three days after"; "a week before"
    const word = m[2];
    let count: number;
    let unit: number | undefined;
    if (m[3]) {
      count = /^\d+$/.test(word) ? parseInt(word, 10) : NUM[word.replace(/ and a half$/, '')];
      if (word.endsWith(' and a half')) count += 0.5;
      unit = UNIT[m[3]];
    } else {
      // "the day after", "the week before": number omitted
      count = 1;
      unit = UNIT[word];
    }
    if (!count || !unit) return null;
    days = Math.round(count * unit);
  }
  return { kind: hit.kind, id: hit.id, days: dir * days };
}

/** "3 days after the Battle of Varn", in words. */
export function describeRelative(world: World, rel: RelativeAnchor): string {
  const name = anchorName(world, rel);
  const n = Math.abs(rel.days);
  if (rel.days === 0) return `on ${name}`;
  const amount = n % 365 === 0 ? plural(n / 365, 'year') : n % 7 === 0 && n < 365 ? plural(n / 7, 'week') : plural(n, 'day');
  return `${amount} ${rel.days > 0 ? 'after' : 'before'} ${name}`;
}

const plural = (n: number, w: string) => (n === 1 ? `1 ${w}` : `${n} ${w}s`);

export function anchorName(world: World, rel: { kind: RelativeAnchor['kind']; id: Id }): string {
  if (rel.kind === 'event') return world.events.find((e) => e.id === rel.id)?.name ?? 'a deleted event';
  if (rel.kind === 'scene') return world.scenes.find((s) => s.id === rel.id)?.title || 'a scene';
  const c = anchorChoices(world).find((a) => a.kind === 'chapter' && a.id === rel.id && a.name.startsWith('chapter '));
  return c?.name ?? 'a deleted chapter';
}

/** Records whose dates hang on this anchor, for "what moves with it" and delete warnings. */
export function datesHangingOn(world: World, id: Id): number {
  const hangs = (v: unknown, depth: number): boolean => {
    if (depth > 6 || !v || typeof v !== 'object') return false;
    if (isDate(v)) return v.rel?.id === id;
    return Object.values(v as Record<string, unknown>).some((x) => hangs(x, depth + 1));
  };
  let n = 0;
  for (const c of DATED) for (const r of world[c] as unknown[]) if (hangs(r, 0)) n++;
  return n;
}

/** Before an anchor is deleted: its dependants keep the date they have now, no longer tied to it. */
export function detachAnchor(world: World, id: Id): World {
  const strip = (v: unknown, depth: number): unknown => {
    if (depth > 6 || !v || typeof v !== 'object') return v;
    if (isDate(v)) {
      if (v.rel?.id !== id) return v;
      const { rel, ...rest } = v;
      void rel;
      return rest;
    }
    if (Array.isArray(v)) {
      const out = v.map((x) => strip(x, depth + 1));
      return out.some((x, i) => x !== v[i]) ? out : v;
    }
    let out: Record<string, unknown> | undefined;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const n = strip(x, depth + 1);
      if (n !== x) (out ??= { ...(v as Record<string, unknown>) })[k] = n;
    }
    return out ?? v;
  };
  const next = { ...world } as World;
  for (const c of DATED) (next as unknown as Record<string, unknown>)[c] = strip(world[c], 0);
  return next;
}
