/**
 * ST-12: name spotting. Scan a manuscript chapter by chapter for character and place names
 * (and aliases) and suggest links: add a character to the chapter's cast, create a stay when a
 * character and a place share a chapter, or link the first mention to the record.
 */
import { DayWindow } from '../dates';
import type { Id, Manuscript, World } from '../model';
import { readingOrder } from '../story/spoilers';
import { WorldIndex } from '../whereabouts';
import { chapterOverview } from './order';

export interface Mention { kind: 'character' | 'place'; id: Id; count: number; paraIndex: number; start: number; end: number }

export interface SpottedSection {
  heading: string;
  /** The book chapter this part of the manuscript is, matched by title (or by order). */
  chapterId?: Id;
  firstPara: number;
  lastPara: number;
  mentions: Mention[];
}

export type Suggestion =
  | { kind: 'cast'; key: string; chapterId: Id; characterId: Id; text: string }
  | { kind: 'stay'; key: string; chapterId: Id; characterId: Id; placeId: Id; range: DayWindow; text: string }
  | { kind: 'link'; key: string; targetKind: 'character' | 'place'; targetId: Id; paraIndex: number; start: number; end: number; text: string };

const norm = (s: string) => s.toLowerCase().replace(/^chapter\s+\d+\s*[:.\-–]\s*/, '').replace(/\s+/g, ' ').trim();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Split a manuscript at its top-level headings and match each part to a chapter. */
export function manuscriptSections(world: World, m: Manuscript): SpottedSection[] {
  const levels = m.paragraphs.filter((p) => p.heading).map((p) => p.heading!);
  const top = levels.length ? Math.min(...levels) : 0;
  const parts: SpottedSection[] = [];
  m.paragraphs.forEach((p, i) => {
    if (p.heading && p.heading === top) parts.push({ heading: p.text, firstPara: i, lastPara: i, mentions: [] });
    else if (parts.length) parts[parts.length - 1].lastPara = i;
    else parts.push({ heading: '', firstPara: i, lastPara: i, mentions: [] });
  });
  const order = readingOrder(world).filter((o) => !m.bookId || o.bookId === m.bookId);
  const used = new Set<Id>();
  for (const s of parts) {
    const h = norm(s.heading);
    const hit = h ? order.find((o) => !used.has(o.chapter.id) && (norm(o.chapter.title) === h || norm(o.chapter.title).includes(h) || h.includes(norm(o.chapter.title)))) : undefined;
    if (hit) { s.chapterId = hit.chapter.id; used.add(hit.chapter.id); }
  }
  // Same number of headed parts as chapters: match the rest by order.
  const headed = parts.filter((p) => p.heading);
  if (headed.length === order.length) headed.forEach((p, i) => { if (!p.chapterId && !used.has(order[i].chapter.id)) p.chapterId = order[i].chapter.id; });
  return parts;
}

/** Find every name and alias, whole words only. Names shorter than three letters are skipped. */
export function spotMentions(world: World, m: Manuscript): SpottedSection[] {
  const targets: { kind: 'character' | 'place'; id: Id; re: RegExp }[] = [];
  const add = (kind: 'character' | 'place', id: Id, names: string[]) => {
    const ok = [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= 3))].sort((a, b) => b.length - a.length);
    if (ok.length) targets.push({ kind, id, re: new RegExp(`(?<![\\p{L}\\p{N}])(?:${ok.map(esc).join('|')})(?![\\p{L}\\p{N}])`, 'gu') });
  };
  for (const c of world.characters) {
    if (c.archived) continue;
    // A full name also matches by its first part ("Kaela" for "Kaela Venn").
    const first = c.name.split(/\s+/)[0];
    add('character', c.id, [c.name, ...c.aliases, ...(first !== c.name ? [first] : [])]);
  }
  for (const p of world.places) if (!p.isPlaceholder) add('place', p.id, [p.name, ...p.aliases]);
  const sections = manuscriptSections(world, m);
  for (const s of sections) {
    const found = new Map<string, Mention>();
    for (let pi = s.firstPara; pi <= s.lastPara; pi++) {
      const para = m.paragraphs[pi];
      if (para.heading) continue;
      for (const t of targets) {
        t.re.lastIndex = 0;
        let hit: RegExpExecArray | null;
        while ((hit = t.re.exec(para.text))) {
          const k = `${t.kind}:${t.id}`;
          const f = found.get(k);
          if (f) f.count++;
          else found.set(k, { kind: t.kind, id: t.id, count: 1, paraIndex: pi, start: hit.index, end: hit.index + hit[0].length });
        }
      }
    }
    s.mentions = [...found.values()].sort((a, b) => b.count - a.count);
  }
  return sections;
}

/** ST-12: suggestions for one manuscript, skipping what the world already records. */
export function nameSuggestions(world: World, m: Manuscript, sections = spotMentions(world, m)): { sections: SpottedSection[]; suggestions: Suggestion[] } {
  const ix = new WorldIndex(world);
  const name = (kind: 'character' | 'place', id: Id) => (kind === 'character' ? ix.characters.get(id)?.name : ix.places.get(id)?.name) ?? '?';
  const chapterTitle = (id: Id) => world.chapters.find((c) => c.id === id)?.title ?? 'this chapter';
  const out: Suggestion[] = [];
  const linked = new Set(world.links.filter((l) => l.manuscriptId === m.id).map((l) => `${l.target.kind}:${l.target.id}`));
  for (const s of sections) {
    if (s.chapterId) {
      const ov = chapterOverview(ix, s.chapterId);
      const cast = new Set(ov.characters.filter((c) => c.scenes > 0 || c.pov).map((c) => c.id));
      const hasScenes = world.scenes.some((x) => x.chapterId === s.chapterId);
      for (const mn of s.mentions) {
        if (mn.kind === 'character' && hasScenes && !cast.has(mn.id)) {
          out.push({ kind: 'cast', key: `cast:${s.chapterId}:${mn.id}`, chapterId: s.chapterId, characterId: mn.id, text: `${name('character', mn.id)} is named ${mn.count === 1 ? 'once' : `${mn.count} times`} in ${chapterTitle(s.chapterId)} but is not in any of its scenes. Add them?` });
        }
      }
      // A cast member with no whereabouts while the chapter happens, and a place named in it: suggest a stay there.
      if (ov.range) {
        const place = s.mentions.find((x) => x.kind === 'place');
        const people = s.mentions.filter((x) => x.kind === 'character' && cast.has(x.id));
        for (const pe of place ? people : []) {
          const known = ix.segmentsFor(pe.id).some((seg) => seg.start.earliest <= ov.range!.latest && seg.end.latest >= ov.range!.earliest);
          if (known) continue;
          out.push({ kind: 'stay', key: `stay:${s.chapterId}:${pe.id}:${place!.id}`, chapterId: s.chapterId, characterId: pe.id, placeId: place!.id, range: ov.range, text: `${name('character', pe.id)} is in ${chapterTitle(s.chapterId)} but has no whereabouts then. ${name('place', place!.id)} is the place named most. Create a stay there?` });
        }
      }
    }
    for (const mn of s.mentions) {
      const k = `${mn.kind}:${mn.id}`;
      if (linked.has(k)) continue;
      linked.add(k);
      const quote = m.paragraphs[mn.paraIndex].text.slice(mn.start, mn.end);
      out.push({ kind: 'link', key: `link:${k}`, targetKind: mn.kind, targetId: mn.id, paraIndex: mn.paraIndex, start: mn.start, end: mn.end, text: `Link the first mention of ${name(mn.kind, mn.id)} (“${quote}”${s.heading ? ` in ${s.heading}` : ''}) to its ${mn.kind === 'character' ? 'character' : 'place'} page.` });
    }
  }
  return { sections, suggestions: out };
}
