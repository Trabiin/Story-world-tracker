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
