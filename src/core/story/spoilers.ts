/**
 * EU-8, D-8: the "as of" spoiler filter. Shows the world only as the reader knows it at the end of a
 * chosen book or chapter, in reading order. The author always sees everything.
 *
 * When does the reader learn of something?
 * - Set by hand on the record (`revealedIn`: a chapter id, 'start' or 'never'), or otherwise
 * - Characters, places and groups: the first chapter that mentions them (a scene's POV, cast or place,
 *   a chapter's POV, or a linked manuscript passage). A known place makes the places around it known.
 * - Stays, journeys and memberships: when linked in the manuscript, or once everything they involve is
 *   known and they start no later than the latest in-world date the story has reached so far.
 * - Region borders, ties and attributes: those that start after that date stay hidden.
 */
import { DayWindow, FuzzyDate, toWindow } from '../dates';
import type { Chapter, Id, Region, World } from '../model';
import { WorldIndex } from '../whereabouts';
import { outline, scenePlace, scenePov } from './story';

export const REVEAL_START = 'start';
export const REVEAL_NEVER = 'never';

export interface ReadingPoint {
  /** Position of the chapter in reading order, from 0. */
  index: number;
  chapter: Chapter;
  bookId: Id;
  label: string;
}

/** Every chapter in reading order (books by order, then chapters by order). */
export function readingOrder(world: World): ReadingPoint[] {
  const out: ReadingPoint[] = [];
  for (const b of outline(world)) for (const c of b.chapters) out.push({ index: out.length, chapter: c.chapter, bookId: b.book.id, label: `${b.book.title} · ${c.chapter.title || 'Untitled chapter'}` });
  return out;
}

/** Choices for the filter: the end of each book and of each chapter. Value = chapter index. */
export function readingChoices(world: World): { value: number; label: string; book: boolean }[] {
  const order = readingOrder(world);
  const out: { value: number; label: string; book: boolean }[] = [];
  for (const b of outline(world)) {
    const chs = order.filter((p) => p.bookId === b.book.id);
    if (!chs.length) continue;
    for (const c of chs) out.push({ value: c.index, label: `${c.chapter.title || 'Untitled chapter'}`, book: false });
    out.push({ value: chs[chs.length - 1].index, label: `End of ${b.book.title}`, book: true });
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** The chapter (reading index) each record is first mentioned in. */
export function firstMentions(world: World): Map<Id, number> {
  const order = readingOrder(world);
  const idx = new Map(order.map((p) => [p.chapter.id, p.index]));
  const ix = new WorldIndex(world);
  const out = new Map<Id, number>();
  const note = (id: Id | undefined, i: number | undefined) => {
    if (!id || i === undefined) return;
    const cur = out.get(id);
    if (cur === undefined || i < cur) out.set(id, i);
  };
  for (const c of world.chapters) note(c.povCharacterId, idx.get(c.id));
  for (const s of world.scenes) {
    const i = idx.get(s.chapterId);
    note(scenePov(world, s), i);
    s.characterIds.forEach((c) => note(c, i));
    note(scenePlace(ix, s).placeId, i);
  }
  for (const [l, i] of linkChapters(world)) {
    note(l.target.id, i);
    // A passage about a stay or journey also tells the reader where it happens.
    if (l.target.kind === 'stay') note(world.stays.find((x) => x.id === l.target.id)?.placeId, i);
    if (l.target.kind === 'journey') {
      const j = world.journeys.find((x) => x.id === l.target.id);
      if (j) [j.originId, j.destinationId].forEach((p) => note(p, i));
    }
  }
  return out;
}

/** Manuscript passages: the chapter whose title matches the passage's heading, else the end of its book. */
export function linkChapters(world: World): Map<World['links'][number], number | undefined> {
  const order = readingOrder(world);
  const out = new Map<World['links'][number], number | undefined>();
  for (const l of world.links) {
    const m = world.manuscripts.find((x) => x.id === l.manuscriptId);
    const heading = norm(l.anchor.heading ?? '');
    const inBook = order.filter((p) => !m?.bookId || p.bookId === m.bookId);
    const hit = inBook.find((p) => heading && norm(p.chapter.title) === heading) ?? inBook.find((p) => heading && p.chapter.title.trim() && heading.includes(norm(p.chapter.title)));
    out.set(l, hit?.index ?? inBook[inBook.length - 1]?.index);
  }
  return out;
}

/** The latest in-world day the story has reached by the end of a chapter (or undefined: no dated scene yet). */
export function readerDay(world: World, asOf: number): number | undefined {
  const order = readingOrder(world);
  const hemi = world.settings.hemisphereForSeasons;
  let best: number | undefined;
  for (const p of order) {
    if (p.index > asOf) break;
    for (const s of world.scenes) {
      if (s.chapterId !== p.chapter.id) continue;
      const d = s.end ?? s.start;
      if (!d) continue;
      const day = toWindow(d, hemi).latest;
      if (best === undefined || day > best) best = day;
    }
  }
  return best;
}

/** EU-8: the world as the reader knows it at the end of chapter `asOf` (reading index). */
export function spoilerView(world: World, asOf: number): World {
  const order = readingOrder(world);
  const chapterIdx = new Map(order.map((p) => [p.chapter.id, p.index]));
  const mentions = firstMentions(world);
  const hemi = world.settings.hemisphereForSeasons;
  const win = (d: FuzzyDate): DayWindow => toWindow(d, hemi);
  const until = readerDay(world, asOf) ?? -Infinity;
  const startsBy = (d: FuzzyDate | undefined) => !d || win(d).earliest <= until;

  /** undefined = no decision by hand. */
  const byHand = (r: { revealedIn?: string }): boolean | undefined => {
    if (!r.revealedIn) return undefined;
    if (r.revealedIn === REVEAL_START) return true;
    if (r.revealedIn === REVEAL_NEVER) return false;
    const i = chapterIdx.get(r.revealedIn);
    return i === undefined ? undefined : i <= asOf;
  };
  const mentioned = (id: Id) => (mentions.get(id) ?? Infinity) <= asOf;
  const known = (r: { id: Id; revealedIn?: string }) => byHand(r) ?? mentioned(r.id);

  // Characters
  const characters = world.characters.filter(known).map((c) => ({
    ...c,
    attributes: c.attributes?.filter((a) => startsBy(a.start)),
    death: c.death && startsBy(c.death) ? c.death : undefined,
  }));
  const charIds = new Set(characters.map((c) => c.id));

  // Places: mentioned ones, the places around them, map features (the map itself is known) and placeholders.
  const byId = new Map(world.places.map((p) => [p.id, p]));
  const placeIds = new Set<Id>();
  const featurePlaces = new Set(world.mapFeatures.map((f) => f.placeId).filter(Boolean) as Id[]);
  for (const p of world.places) {
    const decided = byHand(p);
    if (decided === false) continue;
    if (decided || mentioned(p.id) || p.isPlaceholder || featurePlaces.has(p.id)) {
      let q: typeof p | undefined = p;
      const seen = new Set<Id>();
      while (q && !seen.has(q.id)) {
        if (byHand(q) === false && q !== p) break;
        placeIds.add(q.id);
        seen.add(q.id);
        q = q.parentId ? byId.get(q.parentId) : undefined;
      }
    }
  }
  const places = world.places.filter((p) => placeIds.has(p.id)).map((p) => (p.parentId && !placeIds.has(p.parentId) ? { ...p, parentId: undefined } : p));

  // Groups: mentioned, set by hand, or with a known member who has joined by now.
  const memberships = world.memberships.filter((m) => {
    const h = byHand(m);
    return h ?? (charIds.has(m.characterId) && startsBy(m.start));
  });
  const groups = world.groups.filter((g) => byHand(g) ?? (mentioned(g.id) || memberships.some((m) => m.groupId === g.id)));
  const groupIds = new Set(groups.map((g) => g.id));
  const keptMemberships = memberships.filter((m) => groupIds.has(m.groupId) && charIds.has(m.characterId));
  const subjectKnown = (s: { kind: 'character' | 'group'; id: Id }) => (s.kind === 'character' ? charIds.has(s.id) : groupIds.has(s.id));

  const stays = world.stays.filter((s) => {
    const h = byHand(s);
    if (h !== undefined) return h && subjectKnown(s.subject) && placeIds.has(s.placeId);
    return subjectKnown(s.subject) && placeIds.has(s.placeId) && (mentioned(s.id) || startsBy(s.arrival));
  });
  const journeys = world.journeys.filter((j) => {
    const ok = subjectKnown(j.subject) && placeIds.has(j.originId) && placeIds.has(j.destinationId);
    const h = byHand(j);
    if (h !== undefined) return h && ok;
    return ok && (mentioned(j.id) || startsBy(j.departure));
  }).map((j) => (j.waypointIds.every((w) => placeIds.has(w)) ? j : { ...j, waypointIds: j.waypointIds.filter((w) => placeIds.has(w)) }));

  // Regions: borders, overlords and ties from after the reader's date stay hidden.
  const regions: Region[] = [];
  for (const r of world.regions) {
    if (byHand(r) === false) continue;
    if (byHand(r) !== true && !startsBy(r.start)) continue;
    const versions = r.versions.filter((v) => startsBy(v.start));
    if (!versions.length) continue;
    regions.push({
      ...r,
      end: r.end && startsBy(r.end) ? r.end : undefined,
      versions,
      overlords: r.overlords.filter((o) => startsBy(o.start)).map((o) => (o.end && !startsBy(o.end) ? { ...o, end: undefined } : o)),
      ties: r.ties.filter((t) => charIds.has(t.characterId) && startsBy(t.start)).map((t) => (t.end && !startsBy(t.end) ? { ...t, end: undefined } : t)),
    });
  }

  // Story structure: chapters after the chosen one are not read yet.
  const chapters = world.chapters.filter((c) => (chapterIdx.get(c.id) ?? Infinity) <= asOf);
  const chapterIds = new Set(chapters.map((c) => c.id));
  const books = world.books.filter((b) => chapters.some((c) => c.bookId === b.id));
  const scenes = world.scenes.filter((s) => chapterIds.has(s.chapterId));
  // TL-5 events the story has reached; CH-4 relationships begun by then between known characters; CH-8 knowledge gained by then.
  const events = world.events
    .filter((e) => byHand(e) ?? (mentioned(e.id) || (!!e.start && startsBy(e.start))))
    .map((e) => ({ ...e, characterIds: e.characterIds.filter((id) => charIds.has(id)), placeId: e.placeId && placeIds.has(e.placeId) ? e.placeId : undefined }));
  const eventIds = new Set(events.map((e) => e.id));
  const relationships = world.relationships
    .filter((r) => charIds.has(r.aId) && charIds.has(r.bId) && (byHand(r) ?? startsBy(r.start)))
    .map((r) => (r.end && !startsBy(r.end) ? { ...r, end: undefined } : r));
  const secrets = world.secrets
    .filter((sc) => byHand(sc) !== false && (!sc.eventId || eventIds.has(sc.eventId)))
    .map((sc) => ({ ...sc, knowers: sc.knowers.filter((k) => charIds.has(k.characterId) && startsBy(k.from)) }))
    .filter((sc) => sc.knowers.length > 0 || byHand(sc) === true);

  const keepTarget = (t: { kind: string; id: Id }) => {
    switch (t.kind) {
      case 'character': return charIds.has(t.id);
      case 'place': return placeIds.has(t.id);
      case 'group': return groupIds.has(t.id);
      case 'stay': return stays.some((s) => s.id === t.id);
      case 'journey': return journeys.some((j) => j.id === t.id);
      case 'chapter': return chapterIds.has(t.id);
      case 'scene': return scenes.some((s) => s.id === t.id);
      case 'book': return books.some((b) => b.id === t.id);
      case 'event': return events.some((e) => e.id === t.id);
      default: return true;
    }
  };
  const linkAt = linkChapters(world);
  const links = world.links.filter((l) => keepTarget(l.target) && (linkAt.get(l) ?? Infinity) <= asOf);

  return { ...world, characters, places, groups, memberships: keptMemberships, stays, journeys, regions, chapters, books, scenes, links, events, relationships, secrets };
}
