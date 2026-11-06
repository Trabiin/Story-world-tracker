/** TL-5: named world events, and TL-6 yearly holidays. */
import { DayWindow, fromDayNumber, toDayNumber, toWindow, daysInMonth } from '../dates';
import type { Id, World, WorldEvent } from '../model';
import type { WorldIndex } from '../whereabouts';

export const EVENT_KINDS: { id: WorldEvent['kind']; label: string; icon: string }[] = [
  { id: 'battle', label: 'Battle', icon: '⚔' },
  { id: 'coronation', label: 'Coronation', icon: '♛' },
  { id: 'festival', label: 'Festival or holiday', icon: '✶' },
  { id: 'eclipse', label: 'Eclipse or omen', icon: '☀' },
  { id: 'treaty', label: 'Treaty', icon: '✍' },
  { id: 'disaster', label: 'Disaster', icon: '☄' },
  { id: 'birth', label: 'Birth', icon: '✦' },
  { id: 'death', label: 'Death', icon: '✝' },
  { id: 'wedding', label: 'Wedding', icon: '♥' },
  { id: 'discovery', label: 'Discovery', icon: '✧' },
  { id: 'other', label: 'Other', icon: '◆' },
];
export const eventIcon = (k: WorldEvent['kind']) => EVENT_KINDS.find((x) => x.id === k)?.icon ?? '●';

/** The days an event covers. One-day events without an end cover their start window. */
export function eventWindow(world: World, e: WorldEvent): DayWindow | undefined {
  if (!e.start) return undefined;
  const h = world.settings.hemisphereForSeasons;
  const a = toWindow(e.start, h);
  const b = e.end ? toWindow(e.end, h) : a;
  return { earliest: a.earliest, latest: Math.max(a.latest, b.latest) };
}

export interface Occurrence {
  event: WorldEvent;
  from: number;
  to: number;
  /** Set for a yearly event's later (or earlier) repeats. */
  repeat?: number;
}

/** Events in a day range, with yearly holidays repeated every year from their first date on (TL-6). */
export function occurrences(world: World, from: number, to: number): Occurrence[] {
  const out: Occurrence[] = [];
  for (const e of world.events) {
    const w = eventWindow(world, e);
    if (!w) continue;
    if (!e.yearly || !e.start || e.start.month === undefined) {
      if (w.latest >= from && w.earliest <= to) out.push({ event: e, from: w.earliest, to: w.latest });
      continue;
    }
    const first = fromDayNumber(w.earliest);
    const len = w.latest - w.earliest; // a yearly event's end gives its length each year
    const y0 = Math.max(first.year, fromDayNumber(from).year - 1);
    const y1 = fromDayNumber(to).year;
    for (let y = y0; y <= y1; y++) {
      const day = Math.min(first.day, daysInMonth(y, first.month));
      const d = toDayNumber({ year: y, month: first.month, day });
      if (d + len < from || d > to) continue;
      out.push({ event: e, from: d, to: d + len, repeat: y === first.year ? undefined : y });
    }
  }
  return out.sort((a, b) => a.from - b.from);
}

/** Events a character takes part in, or that happen at a place or anywhere inside it. */
export function eventsFor(ix: WorldIndex, kind: 'character' | 'place', id: Id): WorldEvent[] {
  const w = ix.world;
  const list = kind === 'character'
    ? w.events.filter((e) => e.characterIds.includes(id))
    : w.events.filter((e) => e.placeId && (e.placeId === id || ix.ancestors(e.placeId).includes(id)));
  return list.sort((a, b) => (eventWindow(w, a)?.earliest ?? 0) - (eventWindow(w, b)?.earliest ?? 0));
}
