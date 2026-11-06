/** EU-15: the home page: recent changes, loose ends and chapters not yet linked to the manuscript. */
import type { Id, World } from '../model';
import { linkChapters, readingOrder } from '../story/spoilers';
import { WorldIndex } from '../whereabouts';
import { DATA_COLLECTIONS, recordLabel } from './labels';

export interface Recent { collection: (typeof DATA_COLLECTIONS)[number]; id: Id; label: string; updatedAt: string }

const SKIP = new Set(['links', 'mapSymbols', 'regionLayers', 'detailMaps', 'todos']);

export function recentChanges(world: World, n = 12): Recent[] {
  const out: Recent[] = [];
  for (const c of DATA_COLLECTIONS) {
    if (SKIP.has(c)) continue;
    for (const r of world[c] as unknown as { id: Id; updatedAt: string; isPlaceholder?: boolean }[]) {
      if (r.isPlaceholder || !r.updatedAt) continue;
      out.push({ collection: c, id: r.id, label: recordLabel(world, c, r), updatedAt: r.updatedAt });
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, n);
}

export interface LooseEnd { kind: 'open-stay' | 'no-arrival' | 'draft' | 'no-date'; collection: 'stays' | 'journeys' | 'scenes' | 'events'; id: Id; text: string }

/** Stays left open although the character goes on elsewhere, journeys whose arrival can't be worked out, undated scenes, drafts. */
export function looseEnds(world: World): LooseEnd[] {
  const ix = new WorldIndex(world);
  const out: LooseEnd[] = [];
  const who = (s: { kind: string; id: Id }) => (s.kind === 'character' ? ix.characters.get(s.id)?.name : world.groups.find((g) => g.id === s.id)?.name) ?? '?';
  for (const s of world.stays) {
    if (s.departure || s.durationDays !== undefined) continue;
    const start = ix.win(s.arrival).earliest;
    const mine = (x: { id: Id; subject: { kind: string; id: Id } }) => x.id !== s.id && x.subject.kind === s.subject.kind && x.subject.id === s.subject.id;
    const later = world.stays.some((x) => mine(x) && ix.win(x.arrival).earliest > start) || world.journeys.some((x) => mine(x) && ix.win(x.departure).earliest > start);
    if (later) out.push({ kind: 'open-stay', collection: 'stays', id: s.id, text: `${who(s.subject)}'s stay at ${ix.places.get(s.placeId)?.name ?? '?'} has no end, but they go on elsewhere later.` });
  }
  for (const j of world.journeys) {
    if (j.arrival) continue;
    if (ix.journeyDistanceKm(j) === undefined) out.push({ kind: 'no-arrival', collection: 'journeys', id: j.id, text: `${who(j.subject)}'s journey to ${ix.places.get(j.destinationId)?.name ?? '?'} has no arrival date, and the places have no map position to work one out.` });
  }
  for (const s of world.scenes) if (!s.start) out.push({ kind: 'no-date', collection: 'scenes', id: s.id, text: `Scene “${s.title}” has no in-world date.` });
  const drafts = (['stays', 'journeys', 'scenes', 'events'] as const).flatMap((c) => (world[c] as unknown as { id: Id; status: string }[]).filter((r) => r.status === 'draft').map((r) => ({ c, r })));
  for (const { c, r } of drafts) out.push({ kind: 'draft', collection: c, id: r.id, text: `Draft ${c.slice(0, -1)}: ${recordLabel(world, c, r)}` });
  return out;
}

/** Chapters with no linked passage in any manuscript. */
export function unlinkedChapters(world: World): { chapterId: Id; label: string; scenes: number }[] {
  const order = readingOrder(world);
  const linked = new Set<number>();
  for (const [, idx] of linkChapters(world)) if (idx !== undefined) linked.add(idx);
  return order.filter((o) => !linked.has(o.index)).map((o) => ({ chapterId: o.chapter.id, label: o.label, scenes: world.scenes.filter((s) => s.chapterId === o.chapter.id).length }));
}
