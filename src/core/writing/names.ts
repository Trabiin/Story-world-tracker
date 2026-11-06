/**
 * WR-8: the world's own words. Names and aliases of characters, places, realms and other regions,
 * events and groups are kept out of the spell checker, so "Thornwick" is never underlined.
 */
import type { World } from '../model';

/** Every single word that appears in a name or alias, e.g. "Kaela", "Varn", "Keep". */
export function worldWords(world: World): Set<string> {
  const out = new Set<string>();
  const add = (s: string | undefined) => {
    for (const w of (s ?? '').split(/[^\p{L}\p{N}'’-]+/u)) {
      const t = w.replace(/^['’-]+|['’-]+$/g, '');
      if (t.length >= 2) out.add(t);
    }
  };
  for (const c of world.characters) { add(c.name); c.aliases.forEach(add); }
  for (const p of world.places) if (!p.isPlaceholder) { add(p.name); p.aliases.forEach(add); }
  for (const r of world.regions) add(r.name);
  for (const e of world.events) add(e.name);
  for (const g of world.groups) add(g.name);
  for (const f of world.mapFeatures) add(f.name);
  return out;
}

/** Word tokens in a text that belong to the world: [start, end) offsets. A possessive "’s" is left to the checker. */
export function nameRanges(text: string, words: Set<string>): [number, number][] {
  const out: [number, number][] = [];
  if (!words.size) return out;
  for (const m of text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)) {
    let w = m[0];
    const poss = w.match(/['’]s$/);
    if (poss) w = w.slice(0, -2);
    w = w.replace(/['’-]+$/, '');
    if (words.has(w)) out.push([m.index!, m.index! + w.length]);
  }
  return out;
}

/** WR-10, WR-11: a record a name in the text stands for. */
export interface NameRef { kind: 'character' | 'place' | 'region' | 'group' | 'event'; id: string }

/** WR-10: names as word sequences, keyed by their first word. Longest names first. */
export type NameIndex = Map<string, { words: string[]; ref: NameRef }[]>;

const tokens = (s: string) => s.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];

/**
 * WR-10: every name and alias in the world, so hovering "Varn Keep" or "Kaela" in the text can show
 * its card. A character's first name counts too when no other character or name uses it. Where two
 * records share a name, characters win, then places, realms and regions, groups and events.
 */
export function nameIndex(world: World): NameIndex {
  const seen = new Set<string>();
  const entries: { words: string[]; ref: NameRef }[] = [];
  const add = (name: string | undefined, ref: NameRef) => {
    const words = tokens(name ?? '');
    const key = words.join(' ');
    if (!words.length || key.length < 2 || seen.has(key)) return;
    seen.add(key);
    entries.push({ words, ref });
  };
  const chars = world.characters.filter((c) => !c.archived);
  for (const c of chars) { add(c.name, { kind: 'character', id: c.id }); c.aliases.forEach((a) => add(a, { kind: 'character', id: c.id })); }
  for (const p of world.places) if (!p.isPlaceholder) { add(p.name, { kind: 'place', id: p.id }); p.aliases.forEach((a) => add(a, { kind: 'place', id: p.id })); }
  for (const r of world.regions) add(r.name, { kind: 'region', id: r.id });
  for (const g of world.groups) add(g.name, { kind: 'group', id: g.id });
  for (const e of world.events) add(e.name, { kind: 'event', id: e.id });
  // First names: "Kaela" for "Kaela Stormborn", when only one character has it.
  const firsts = new Map<string, string[]>();
  for (const c of chars) {
    const first = tokens(c.name)[0];
    if (first && first !== c.name.trim() && first.length >= 3) firsts.set(first, [...(firsts.get(first) ?? []), c.id]);
  }
  for (const [first, ids] of firsts) if (ids.length === 1) add(first, { kind: 'character', id: ids[0] });
  const out: NameIndex = new Map();
  for (const e of entries) {
    const l = out.get(e.words[0]) ?? [];
    l.push(e);
    out.set(e.words[0], l);
  }
  for (const l of out.values()) l.sort((a, b) => b.words.length - a.words.length);
  return out;
}

/** WR-10: names found in a text: [start, end) offsets and the record. A trailing possessive "’s" is not part of the name. */
export function nameMatches(text: string, index: NameIndex): { from: number; to: number; ref: NameRef }[] {
  const out: { from: number; to: number; ref: NameRef }[] = [];
  if (!index.size) return out;
  const toks: { w: string; from: number; to: number }[] = [];
  for (const m of text.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)) {
    let w = m[0];
    if (/['’]s$/.test(w)) w = w.slice(0, -2);
    w = w.replace(/['’-]+$/, '');
    toks.push({ w, from: m.index!, to: m.index! + w.length });
  }
  for (let i = 0; i < toks.length; i++) {
    const cands = index.get(toks[i].w);
    if (!cands) continue;
    const hit = cands.find((c) => c.words.every((w, k) => toks[i + k]?.w === w && (k === 0 || /^\s+$/.test(text.slice(toks[i + k - 1].to, toks[i + k].from)))));
    if (!hit) continue;
    const last = toks[i + hit.words.length - 1];
    out.push({ from: toks[i].from, to: last.to, ref: hit.ref });
    i += hit.words.length - 1;
  }
  return out;
}
