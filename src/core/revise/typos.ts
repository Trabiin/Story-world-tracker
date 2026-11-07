/**
 * RV-2: name typo check. A capitalised word in the text that is one letter away from a name or alias
 * in the world ("Kayla" for Kaela, "Thornwik" for Thornwick) and is not a name itself is a warning.
 * Plain English words are left alone: any word that also appears in lower case in the text, and a
 * short list of words that often start a sentence.
 */
import type { Id, World } from '../model';
import { outline } from '../story';
import { docParagraphs } from '../writing/doc';

/** Common words that can start a sentence and sit one letter from a name ("Open" and "Oren"). */
const COMMON = new Set(`about above after again against almost alone along already also although always among another anyone anything around away back
because been before behind being below beside besides better between beyond both bring brought came cannot come could dark dawn days dead does done door down
during each else even ever every eyes face fact fair fall far fast fear feel feet fell felt find fine fire first five four free from full gave give given goes gone
good great half hand hard have head hear heard held help here high himself hold home hope horse hour house however inside into just keep kept kind knew know
land last late later least left less like line little long look lord lost made make many maybe mind more most much must name near need never next nice night
none nothing only open other over part past perhaps place plain rain rare read real rest ride right road rock room rose said same sand save seen self sent
shall ship short should show side since small some soon still stone such sure take taken talk tell than that their them then there these they thing
think this those though three through thus time told took town tree true turn under until upon very wait walk wall want warm water well went were what when
where which while white whole whom whose wide will wind with within without word work would year years yellow young your yours
mark open oven king queen prince lady lords sir master mistress father mother brother sister uncle aunt
monday tuesday wednesday thursday friday saturday sunday january february march april june july august september october november december`.split(/\s+/));

/** Damerau–Levenshtein distance, stopping early above max. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

/** Every single word of a name or alias, with the name it comes from. */
function nameWords(world: World): Map<string, string> {
  const out = new Map<string, string>();
  const add = (name: string | undefined) => {
    for (const w of (name ?? '').match(/[\p{L}][\p{L}'’-]*/gu) ?? []) if (w.length >= 4 && /^\p{Lu}/u.test(w) && !out.has(w)) out.set(w, name!);
  };
  for (const c of world.characters) { add(c.name); c.aliases.forEach(add); }
  for (const p of world.places) if (!p.isPlaceholder) { add(p.name); p.aliases.forEach(add); }
  for (const r of world.regions) add(r.name);
  for (const g of world.groups) add(g.name);
  for (const e of world.events) add(e.name);
  for (const f of world.mapFeatures) add(f.name);
  return out;
}

export interface NameTypo {
  /** The word as written ("Kayla"). */
  word: string;
  /** The name word it is close to ("Kaela") and the full name ("Kaela Venn"). */
  like: string;
  name: string;
  count: number;
  sceneIds: Id[];
}

/** RV-2: near-misses of names across the whole series, most frequent first. */
export function nameTypos(world: World): NameTypo[] {
  const names = nameWords(world);
  if (!names.size) return [];
  const list = [...names.keys()];
  const texts = new Map(world.sceneTexts.map((t) => [t.sceneId, t]));
  const lower = new Set<string>();
  const seen = new Map<string, { count: number; scenes: Id[] }>();
  for (const b of outline(world)) for (const c of b.chapters) for (const s of c.scenes) {
    for (const p of docParagraphs(texts.get(s.id)?.doc)) {
      for (const m of p.text.matchAll(/[\p{L}][\p{L}'’-]*/gu)) {
        const w = m[0].replace(/['’]s$/, '').replace(/['’-]+$/, '');
        if (/^\p{Ll}/u.test(w)) { lower.add(w); continue; }
        if (w.length < 4 || names.has(w)) continue;
        const e = seen.get(w) ?? { count: 0, scenes: [] };
        e.count++;
        if (!e.scenes.includes(s.id)) e.scenes.push(s.id);
        seen.set(w, e);
      }
    }
  }
  const out: NameTypo[] = [];
  for (const [w, e] of seen) {
    const lw = w.toLowerCase();
    if (COMMON.has(lw) || lower.has(lw) || w === w.toUpperCase()) continue;
    const max = w.length >= 8 ? 2 : 1;
    let best: string | undefined, bestD = max + 1;
    for (const n of list) {
      if (n.toLowerCase() === lw) { best = undefined; bestD = -1; break; }
      const d = editDistance(lw, n.toLowerCase(), max);
      if (d < bestD) { bestD = d; best = n; }
    }
    if (!best || bestD > max || bestD < 1) continue;
    out.push({ word: w, like: best, name: names.get(best)!, count: e.count, sceneIds: e.scenes });
  }
  return out.sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
}
