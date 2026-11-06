/** VW-7: one filter for every view: book, plot thread, faction, tag, POV, scene stage (WR-13) and drafts. */
import type { Id, ViewFilter, World } from '../model';
import { scenePov } from '../story/story';
import { withoutDrafts } from './scenarios';
import { stageOf } from '../writing/goals';

export const NO_FILTER: ViewFilter = { drafts: 'show' };

export function isFiltering(f: ViewFilter | undefined): boolean {
  return !!f && (!!f.bookId || !!f.threadId || !!f.faction || !!f.tag || !!f.povId || !!f.stage || f.drafts === 'hide');
}

/** A thread and every branch that grows from it. */
export function threadFamily(world: World, threadId: Id): Set<Id> {
  const out = new Set<Id>([threadId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const t of world.threads) if (t.parentId && out.has(t.parentId) && !out.has(t.id)) { out.add(t.id); grew = true; }
  }
  return out;
}

/** Values the faction filter offers: faction and allegiance attributes, and group names. */
export function factionChoices(world: World): string[] {
  const out = new Set<string>();
  for (const c of world.characters) for (const a of c.attributes ?? []) if ((a.key === 'faction' || a.key === 'allegiance') && a.value.trim()) out.add(a.value.trim());
  for (const g of world.groups) out.add(g.name);
  return [...out].sort((a, b) => a.localeCompare(b));
}

export function applyFilter(world: World, f: ViewFilter | undefined): World {
  if (!isFiltering(f)) return world;
  let w = f!.drafts === 'hide' ? withoutDrafts(world) : world;
  if (!f!.bookId && !f!.threadId && !f!.faction && !f!.tag && !f!.povId && !f!.stage) return w;

  let scenes = w.scenes;
  let chapters = w.chapters;
  let books = w.books;
  let chars: Set<Id> | undefined;
  const narrow = (ids: Iterable<Id>) => {
    const s = new Set(ids);
    chars = chars ? new Set([...chars].filter((x) => s.has(x))) : s;
  };
  const cast = (list: typeof scenes) => {
    const out = new Set<Id>();
    for (const s of list) {
      const p = scenePov(w, s);
      if (p) out.add(p);
      for (const c of s.characterIds) out.add(c);
    }
    return out;
  };
  if (f!.bookId) {
    books = books.filter((b) => b.id === f!.bookId);
    chapters = chapters.filter((c) => c.bookId === f!.bookId);
    const ch = new Set(chapters.map((c) => c.id));
    scenes = scenes.filter((s) => ch.has(s.chapterId));
    narrow([...cast(scenes), ...chapters.map((c) => c.povCharacterId).filter(Boolean) as Id[]]);
  }
  if (f!.threadId) {
    const fam = threadFamily(w, f!.threadId);
    scenes = scenes.filter((s) => s.threadIds?.some((t) => fam.has(t)));
    narrow([...cast(scenes), ...w.threads.filter((t) => fam.has(t.id)).flatMap((t) => t.characterIds)]);
  }
  if (f!.povId) {
    scenes = scenes.filter((s) => scenePov(w, s) === f!.povId);
    narrow(cast(scenes));
  }
  if (f!.stage) scenes = scenes.filter((s) => stageOf(s) === f!.stage);
  if (f!.bookId || f!.threadId || f!.povId || f!.stage) {
    const ch = new Set(scenes.map((s) => s.chapterId));
    chapters = chapters.filter((c) => ch.has(c.id) || (!f!.stage && f!.povId && c.povCharacterId === f!.povId && (!f!.bookId || c.bookId === f!.bookId)));
    const bk = new Set(chapters.map((c) => c.bookId));
    books = books.filter((b) => bk.has(b.id));
  }
  if (f!.tag) narrow(w.characters.filter((c) => c.tags.includes(f!.tag!)).map((c) => c.id));
  if (f!.faction) {
    const v = f!.faction.toLowerCase();
    const groups = new Set(w.groups.filter((g) => g.name.toLowerCase() === v).map((g) => g.id));
    narrow(w.characters.filter((c) => c.attributes?.some((a) => (a.key === 'faction' || a.key === 'allegiance') && a.value.trim().toLowerCase() === v) || w.memberships.some((m) => m.characterId === c.id && groups.has(m.groupId))).map((c) => c.id));
  }
  const keep = chars ?? new Set(w.characters.map((c) => c.id));
  const subjectOk = (s: { kind: string; id: Id }) => s.kind === 'group' || keep.has(s.id);
  w = {
    ...w,
    books, chapters, scenes,
    characters: w.characters.filter((c) => keep.has(c.id)),
    stays: w.stays.filter((s) => subjectOk(s.subject)),
    journeys: w.journeys.filter((j) => subjectOk(j.subject)),
    memberships: w.memberships.filter((m) => keep.has(m.characterId)),
    relationships: w.relationships.filter((r) => keep.has(r.aId) && keep.has(r.bId)),
  };
  return w;
}
