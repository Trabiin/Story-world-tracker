/**
 * RV-1: rename everywhere. Renaming a character, place, realm, group or event changes every mention in
 * every book (and in scene titles and summaries, chapter titles and notes), after a preview where each
 * mention can be left as it is.
 */
import type { Id, World } from '../model';
import { NameRef, nameIndex, nameMatches } from '../writing/names';
import { FindHit, findInWorld } from './find';
import { blockTexts, matchRanges } from './text';
import type { TextNode } from '../model';

export type RenameKind = NameRef['kind'];

export function recordName(world: World, kind: RenameKind, id: Id): string | undefined {
  const list = kind === 'character' ? world.characters : kind === 'place' ? world.places : kind === 'region' ? world.regions : kind === 'group' ? world.groups : world.events;
  return (list as { id: Id; name: string }[]).find((r) => r.id === id)?.name;
}

const words = (s: string) => s.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];

/**
 * What to look for: the full old name, and, when the new name has as many words, each word that
 * changes ("Kaela Venn" → "Kayla Venn" also turns a lone "Kaela" into "Kayla").
 */
export function renamePairs(oldName: string, newName: string): { from: string; to: string; part?: boolean }[] {
  const out: { from: string; to: string; part?: boolean }[] = [];
  if (oldName.trim() && oldName.trim() !== newName.trim()) out.push({ from: oldName.trim(), to: newName.trim() });
  const a = words(oldName), b = words(newName);
  if (a.length > 1 && a.length === b.length) {
    a.forEach((w, i) => { if (w !== b[i] && w.length >= 3) out.push({ from: w, to: b[i], part: true }); });
  }
  return out;
}

export interface RenameMention {
  key: string;
  where: { kind: 'text'; hit: FindHit } | { kind: 'field'; collection: 'scenes' | 'chapters' | 'notes'; id: Id; field: 'title' | 'summary' | 'body'; label: string; from: number; to: number; before: string; after: string };
  from: string;
  to: string;
  /** A word of the name that other records' names also use: left unticked in the preview. */
  shared?: string;
}

/** Every mention a rename would change. A full name wins over a word of it; other records' full names are skipped. */
export function findMentions(world: World, ref: { kind: RenameKind; id: Id }, newName: string): RenameMention[] {
  const oldName = recordName(world, ref.kind, ref.id);
  if (!oldName) return [];
  const pairs = renamePairs(oldName, newName);
  if (!pairs.length) return [];
  const index = nameIndex(world);
  const otherNames: { name: string; id: Id }[] = [];
  for (const [, list] of index) for (const e of list) if (e.ref.id !== ref.id) otherNames.push({ name: e.words.join(' '), id: e.ref.id });
  const sharedBy = (w: string) => otherNames.find((o) => o.name.split(' ').includes(w))?.name;
  const texts = new Map(world.sceneTexts.map((t) => [t.sceneId, t]));
  const out: RenameMention[] = [];
  const taken = new Set<string>();
  for (const p of pairs) {
    const shared = p.part ? sharedBy(p.from) : undefined;
    for (const hit of findInWorld(world, p.from, { wholeWord: true, matchCase: true }, { kind: 'series' })) {
      const span = `${hit.sceneId}:${hit.block}`;
      if ([...taken].some((k) => { const [s, b, f, t] = k.split(':'); return `${s}:${b}` === span && hit.from < Number(t) && hit.to > Number(f); })) continue;
      // Inside another record's full name ("Mara Venn" when renaming "Kaela Venn"): not this record.
      const para = textOfBlock(texts.get(hit.sceneId)?.doc, hit.block);
      if (para !== undefined && nameMatches(para, index).some((m) => m.ref.id !== ref.id && m.from <= hit.from && hit.to <= m.to && m.to - m.from > hit.to - hit.from)) continue;
      taken.add(`${span}:${hit.from}:${hit.to}`);
      out.push({ key: `t:${hit.key}`, where: { kind: 'text', hit }, from: p.from, to: p.to, shared });
    }
    const field = (collection: 'scenes' | 'chapters' | 'notes', id: Id, f: 'title' | 'summary' | 'body', text: string | undefined, label: string) => {
      for (const [a, b] of matchRanges(text ?? '', p.from, { wholeWord: true, matchCase: true })) {
        const k = `f:${collection}:${id}:${f}`;
        if (out.some((m) => m.key.startsWith(k) && m.where.kind === 'field' && a < m.where.to && b > m.where.from)) continue;
        const t = text!;
        out.push({ key: `${k}:${a}`, where: { kind: 'field', collection, id, field: f, label, from: a, to: b, before: t.slice(Math.max(0, a - 40), a), after: t.slice(b, b + 40) }, from: p.from, to: p.to, shared });
      }
    };
    for (const s of world.scenes) { field('scenes', s.id, 'title', s.title, `Scene title: ${s.title}`); field('scenes', s.id, 'summary', s.summary, `Summary of ${s.title}`); }
    for (const c of world.chapters) field('chapters', c.id, 'title', c.title, `Chapter title: ${c.title}`);
    for (const n of world.notes) { field('notes', n.id, 'title', n.title, `Note: ${n.title}`); field('notes', n.id, 'body', n.body, `Note: ${n.title}`); }
  }
  return out;
}

const cache = new WeakMap<object, string[]>();
function textOfBlock(doc: TextNode | undefined, block: number): string | undefined {
  if (!doc) return undefined;
  let v = cache.get(doc);
  if (!v) { v = blockTexts(doc); cache.set(doc, v); }
  return v[block];
}

/** Replace the chosen mentions in record fields (scene text is done by planReplace). */
export function renameFields(world: World, chosen: RenameMention[]): World {
  const fields = chosen.filter((m) => m.where.kind === 'field');
  if (!fields.length) return world;
  const edit = <T extends { id: Id }>(list: T[], collection: string): T[] => list.map((r) => {
    const mine = fields.filter((m) => m.where.kind === 'field' && m.where.collection === collection && m.where.id === r.id);
    if (!mine.length) return r;
    const next = { ...r } as Record<string, unknown>;
    for (const f of ['title', 'summary', 'body']) {
      const list2 = mine.filter((m) => m.where.kind === 'field' && m.where.field === f).sort((a, b) => (b.where as { from: number }).from - (a.where as { from: number }).from);
      let s = String(next[f] ?? '');
      for (const m of list2) { const w = m.where as { from: number; to: number }; s = s.slice(0, w.from) + m.to + s.slice(w.to); }
      if (list2.length) next[f] = s;
    }
    return next as T;
  });
  return { ...world, scenes: edit(world.scenes, 'scenes'), chapters: edit(world.chapters, 'chapters'), notes: edit(world.notes, 'notes') };
}

/** The record itself: new name, and (if asked) the old one kept as an alias. Characters and places have aliases. */
export function renameRecord(world: World, ref: { kind: RenameKind; id: Id }, newName: string, keepAlias: boolean): World {
  const oldName = recordName(world, ref.kind, ref.id) ?? '';
  const alias = (aliases: string[]) => (keepAlias && oldName && !aliases.includes(oldName) ? [...aliases, oldName] : aliases);
  switch (ref.kind) {
    case 'character': return { ...world, characters: world.characters.map((c) => (c.id === ref.id ? { ...c, name: newName, aliases: alias(c.aliases) } : c)) };
    case 'place': return { ...world, places: world.places.map((p) => (p.id === ref.id ? { ...p, name: newName, aliases: alias(p.aliases) } : p)), mapFeatures: world.mapFeatures.map((f) => (f.placeId === ref.id ? { ...f, name: newName } : f)) };
    case 'region': return { ...world, regions: world.regions.map((r) => (r.id === ref.id ? { ...r, name: newName } : r)) };
    case 'group': return { ...world, groups: world.groups.map((g) => (g.id === ref.id ? { ...g, name: newName } : g)) };
    case 'event': return { ...world, events: world.events.map((e) => (e.id === ref.id ? { ...e, name: newName } : e)) };
  }
}
