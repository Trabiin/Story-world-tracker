/**
 * RV-8, SR-2, EU-16: the documents the Finish page hands out, as PubDocs.
 * - readingCopy: a book's text, chapter by chapter, ready for ePub or PDF.
 * - recap ("Previously on…"): before book N, the story so far from scene summaries, and who's who and
 *   what the reader knows, from the reader's view at the end of the book before (EU-8).
 * - seriesBible: characters, places, groups and the timeline, either everything (the author's copy)
 *   or only what the reader knows by the end of a chosen book.
 */
import { formatFuzzy, toWindow } from '../dates';
import type { Id, World } from '../model';
import { relationLabel } from '../people/relationships';
import { outline, readingOrder, spoilerView } from '../story';
import { attributesOn, placeAt } from '../story/story';
import { WorldIndex } from '../whereabouts';
import { Run, docToBlocks, textOf } from '../writing/doc';
import { EVENT_KINDS } from '../events/events';
import { PubBlock, PubDoc, labelled, plain } from './pubdoc';

const authorOf = (w: World) => w.settings.writing?.authorName?.trim() ?? '';
const langOf = (w: World) => w.settings.writing?.spelling ?? 'en-GB';
const bookOf = (w: World, bookId: Id) => {
  const b = outline(w).find((x) => x.book.id === bookId);
  if (!b) throw new Error('That book no longer exists.');
  return b;
};

/** RV-8: a book's reading copy. Chapters start a new page; scenes are parted by a break. */
export function readingCopy(world: World, bookId: Id, opts: { fromChapter?: number; toChapter?: number } = {}): PubDoc {
  const b = bookOf(world, bookId);
  const blocks: PubBlock[] = [];
  const from = opts.fromChapter ?? 0, to = opts.toChapter ?? b.chapters.length - 1;
  b.chapters.slice(from, to + 1).forEach(({ chapter, scenes }, ci) => {
    blocks.push({ kind: 'heading', level: 1, text: chapter.title || `Chapter ${from + ci + 1}` });
    let first = true, any = false;
    for (const s of scenes) {
      const sb = docToBlocks(textOf(world, s.id)?.doc).filter((x) => x.kind === 'break' || x.runs.some((r) => r.br || r.text.trim()));
      if (!sb.length) continue;
      if (any) { blocks.push({ kind: 'break' }); first = true; }
      any = true;
      for (const x of sb) {
        if (x.kind === 'break') { blocks.push({ kind: 'break' }); first = true; continue; }
        if (x.kind === 'heading') { blocks.push({ kind: 'heading', level: x.level <= 1 ? 2 : 3, text: x.runs.map((r) => r.text).join('') }); first = true; continue; }
        blocks.push({ kind: 'p', runs: x.runs.map(clean), first });
        first = false;
      }
    }
  });
  return { title: b.book.title, author: authorOf(world), lang: langOf(world), blocks };
}

/** Only the formatting a reader sees. */
const clean = (r: Run): Run => (r.br ? { text: '', br: true } : { text: r.text, ...(r.bold ? { bold: true } : {}), ...(r.italic ? { italic: true } : {}) });

/** The reading index of the last chapter before a book (-1: the book is first, nothing comes before it). */
export function chapterBefore(world: World, bookId: Id): number {
  const first = readingOrder(world).find((p) => p.bookId === bookId);
  return first ? first.index - 1 : readingOrder(world).length - 1;
}

/** The reading index of a book's last chapter (-1 if it has none). */
export function endOfBook(world: World, bookId: Id): number {
  const chs = readingOrder(world).filter((p) => p.bookId === bookId);
  return chs.length ? chs[chs.length - 1].index : -1;
}

const IMPORTANCE = { main: 0, secondary: 1, minor: 2 } as const;
const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

/** SR-2: "Previously on…" before a book. Undefined when nothing comes before it. */
export function recap(world: World, bookId: Id, opts: { minor?: boolean } = {}): PubDoc | undefined {
  const target = bookOf(world, bookId).book;
  const asOf = chapterBefore(world, bookId);
  if (asOf < 0) return undefined;
  const view = spoilerView(world, asOf);
  const ix = new WorldIndex(view);
  const blocks: PubBlock[] = [];

  // The story so far: scene summaries, book by book and chapter by chapter.
  blocks.push({ kind: 'heading', level: 1, text: 'The story so far' });
  for (const b of outline(view)) {
    const chs = b.chapters.map((c) => ({ c, sums: c.scenes.map((s) => s.summary.trim()).filter(Boolean) })).filter((x) => x.sums.length);
    if (!chs.length) continue;
    blocks.push({ kind: 'heading', level: 2, text: b.book.title });
    for (const { c, sums } of chs) {
      blocks.push({ kind: 'heading', level: 3, text: c.chapter.title || 'Untitled chapter' });
      // A chapter's scene summaries read as one paragraph.
      blocks.push({ kind: 'p', runs: plain(sums.map((t) => (/[.!?…”"’]$/.test(t) ? t : `${t}.`)).join(' ')), first: true });
    }
  }

  // Who's who, and where the story left them.
  const lastDay = latestDay(view);
  const people = view.characters.filter((c) => !c.archived && (opts.minor || c.importance !== 'minor'))
    .sort((a, b) => IMPORTANCE[a.importance] - IMPORTANCE[b.importance] || byName(a, b));
  if (people.length) {
    blocks.push({ kind: 'heading', level: 1, text: "Who's who" });
    for (const c of people) {
      const runs: Run[] = [{ text: c.name, bold: true }];
      if (c.aliases.length) runs.push({ text: ` (${c.aliases.join(', ')})` });
      const bits: string[] = [];
      if (c.description.trim()) bits.push(c.description.trim());
      if (c.death) bits.push(`Died ${formatFuzzy(c.death)}.`);
      else if (lastDay !== undefined) {
        const p = placeAt(ix, { kind: 'character', id: c.id }, lastDay);
        const place = p && ix.places.get(p);
        if (place && !place.isPlaceholder) bits.push(`Last seen in ${place.name}.`);
      }
      if (bits.length) runs.push({ text: ` — ${bits.join(' ')}` });
      blocks.push({ kind: 'p', runs, small: true });
    }
  }

  // What the reader knows: secrets with at least one knower by now.
  const secrets = view.secrets.filter((s) => s.knowers.length);
  if (secrets.length) {
    blocks.push({ kind: 'heading', level: 1, text: 'What the reader knows' });
    for (const s of secrets) {
      const who = s.knowers.map((k) => view.characters.find((c) => c.id === k.characterId)?.name).filter(Boolean);
      const runs: Run[] = [{ text: s.title, bold: true }];
      if (s.description.trim()) runs.push({ text: ` — ${s.description.trim()}` });
      if (who.length) runs.push({ text: ` Known to ${listing(who as string[])}.`, italic: true });
      blocks.push({ kind: 'p', runs, small: true });
    }
  }
  return { title: 'Previously on…', subtitle: `Before ${target.title}`, author: authorOf(world), lang: langOf(world), blocks };
}

/** The latest in-world day of any scene in a world (a reader's view: the story so far). */
function latestDay(w: World): number | undefined {
  let best: number | undefined;
  for (const s of w.scenes) {
    const d = s.end ?? s.start;
    if (!d) continue;
    const day = toWindow(d, w.settings.hemisphereForSeasons).latest;
    if (best === undefined || day > best) best = day;
  }
  return best;
}

const listing = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

export type BibleSection = 'characters' | 'places' | 'groups' | 'timeline';
export const BIBLE_SECTIONS: { id: BibleSection; label: string }[] = [
  { id: 'characters', label: 'Characters' },
  { id: 'places', label: 'Places' },
  { id: 'groups', label: 'Groups' },
  { id: 'timeline', label: 'Timeline' },
];

export interface BibleOptions {
  /** Only what the reader knows by the end of this book. Absent = everything (the author's copy). */
  throughBookId?: Id;
  sections?: BibleSection[];
  /** Leave out minor characters. */
  skipMinor?: boolean;
}

/** EU-16: the series bible. */
export function seriesBible(world: World, opts: BibleOptions = {}): PubDoc {
  const sections = opts.sections ?? BIBLE_SECTIONS.map((s) => s.id);
  const through = opts.throughBookId ? world.books.find((b) => b.id === opts.throughBookId) : undefined;
  const view = through ? spoilerView(world, endOfBook(world, through.id)) : world;
  const full = !through;
  const ix = new WorldIndex(view);
  const h = world.settings.hemisphereForSeasons;
  const day = through ? latestDay(view) : undefined;
  const blocks: PubBlock[] = [];
  const name = (id: Id) => ix.characters.get(id)?.name;

  if (sections.includes('characters')) {
    const people = view.characters.filter((c) => !c.archived && (!opts.skipMinor || c.importance !== 'minor'))
      .sort((a, b) => IMPORTANCE[a.importance] - IMPORTANCE[b.importance] || byName(a, b));
    blocks.push({ kind: 'heading', level: 1, text: 'Characters' });
    for (const c of people) {
      blocks.push({ kind: 'heading', level: 2, text: c.name });
      const facts: Run[][] = [];
      if (c.aliases.length) facts.push(labelled('Also known as', c.aliases.join(', ')));
      if (c.birth) facts.push(labelled('Born', formatFuzzy(c.birth)));
      if (c.death) facts.push(labelled('Died', formatFuzzy(c.death)));
      const attrs = day !== undefined ? attributesOn(ix, c.id, day) : Object.fromEntries((c.attributes ?? []).map((a) => [a.key, a.value]));
      for (const [k, v] of Object.entries(attrs)) facts.push(labelled(cap(k), v));
      const groups = view.memberships.filter((m) => m.characterId === c.id).map((m) => view.groups.find((g) => g.id === m.groupId)?.name).filter(Boolean) as string[];
      if (groups.length) facts.push(labelled('Groups', [...new Set(groups)].join(', ')));
      const rels = view.relationships.filter((r) => r.aId === c.id || r.bId === c.id)
        .map((r) => `${relationLabel(r, c.id)} ${name(r.aId === c.id ? r.bId : r.aId) ?? '?'}`);
      if (rels.length) facts.push(labelled('Relationships', rels.join('; ')));
      for (const f of facts) blocks.push({ kind: 'p', runs: f, small: true });
      if (c.description.trim()) paras(c.description).forEach((t, i) => blocks.push({ kind: 'p', runs: plain(t), first: i === 0 }));
      if (full && c.notes.trim()) blocks.push({ kind: 'p', runs: labelled('Notes', c.notes.trim()), small: true });
    }
  }

  if (sections.includes('places')) {
    blocks.push({ kind: 'heading', level: 1, text: 'Places' });
    const kids = new Map<Id | undefined, typeof view.places>();
    for (const p of view.places) {
      if (p.isPlaceholder) continue;
      const parent = p.parentId && ix.places.get(p.parentId) && !ix.places.get(p.parentId)!.isPlaceholder ? p.parentId : undefined;
      kids.set(parent, [...(kids.get(parent) ?? []), p]);
    }
    const walk = (parent: Id | undefined, depth: number, path: string[]) => {
      for (const p of (kids.get(parent) ?? []).sort(byName)) {
        if (depth === 0) blocks.push({ kind: 'heading', level: 2, text: p.name });
        else {
          const runs: Run[] = [{ text: p.name, bold: true }, { text: ` (${p.kind.replace('-', ' ')}, in ${path[path.length - 1]})` }];
          if (p.aliases.length) runs.push({ text: `, also ${p.aliases.join(', ')}` });
          if (p.notes.trim()) runs.push({ text: ` — ${p.notes.trim().replace(/\s*\n+\s*/g, ' ')}` });
          blocks.push({ kind: 'p', runs, small: true });
          walk(p.id, depth + 1, [...path, p.name]);
          continue;
        }
        const facts: Run[] = [{ text: cap(p.kind.replace('-', ' ')), italic: true }];
        if (p.aliases.length) facts.push({ text: `, also ${p.aliases.join(', ')}` });
        blocks.push({ kind: 'p', runs: facts, small: true });
        if (p.notes.trim()) paras(p.notes).forEach((t, i) => blocks.push({ kind: 'p', runs: plain(t), first: i === 0 }));
        walk(p.id, depth + 1, [...path, p.name]);
      }
    };
    walk(undefined, 0, []);
  }

  if (sections.includes('groups') && view.groups.length) {
    blocks.push({ kind: 'heading', level: 1, text: 'Groups' });
    for (const g of [...view.groups].sort(byName)) {
      blocks.push({ kind: 'heading', level: 2, text: g.name });
      if (g.description.trim()) paras(g.description).forEach((t, i) => blocks.push({ kind: 'p', runs: plain(t), first: i === 0 }));
      const members = [...new Set(view.memberships.filter((m) => m.groupId === g.id).map((m) => name(m.characterId)).filter(Boolean) as string[])].sort();
      if (members.length) blocks.push({ kind: 'p', runs: labelled('Members', members.join(', ')), small: true });
    }
  }

  if (sections.includes('timeline')) {
    type Item = { at: number; date: string; runs: Run[] };
    const items: Item[] = [];
    for (const e of view.events) {
      if (!e.start) continue;
      const kind = EVENT_KINDS.find((k) => k.id === e.kind)?.label ?? e.kind;
      const place = e.placeId ? ix.places.get(e.placeId)?.name : undefined;
      const runs: Run[] = [{ text: e.name, bold: true }, { text: ` (${kind}${place ? `, ${place}` : ''}${e.yearly ? ', every year' : ''})` }];
      if (e.description.trim()) runs.push({ text: ` — ${e.description.trim().replace(/\s*\n+\s*/g, ' ')}` });
      items.push({ at: toWindow(e.start, h).earliest, date: formatFuzzy(e.start), runs });
    }
    for (const c of view.characters) {
      if (c.archived || (opts.skipMinor && c.importance === 'minor')) continue;
      if (c.birth) items.push({ at: toWindow(c.birth, h).earliest, date: formatFuzzy(c.birth), runs: [{ text: `${c.name} is born` }] });
      if (c.death) items.push({ at: toWindow(c.death, h).earliest, date: formatFuzzy(c.death), runs: [{ text: `${c.name} dies` }] });
    }
    for (const b of outline(view)) for (const ch of b.chapters) for (const s of ch.scenes) {
      if (!s.start) continue;
      items.push({ at: toWindow(s.start, h).earliest, date: formatFuzzy(s.start), runs: [{ text: s.title, italic: true }, { text: ` (${b.book.title}, ${ch.chapter.title || 'untitled chapter'})${s.summary.trim() ? ` — ${s.summary.trim()}` : ''}` }] });
    }
    if (items.length) {
      blocks.push({ kind: 'heading', level: 1, text: 'Timeline' });
      for (const it of items.sort((a, b) => a.at - b.at)) blocks.push({ kind: 'p', runs: [{ text: `${it.date}: `, bold: true }, ...it.runs], small: true });
    }
  }

  const seriesName = world.settings.name?.trim() || 'Series';
  return {
    title: seriesName,
    subtitle: through ? `Series bible: what the reader knows by the end of ${through.title}` : "Series bible: everything (the author's copy)",
    author: authorOf(world),
    lang: langOf(world),
    blocks,
  };
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const paras = (s: string) => s.split(/\n\s*\n|\r?\n/).map((t) => t.trim()).filter(Boolean);
