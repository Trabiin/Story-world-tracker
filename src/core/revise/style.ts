/**
 * RV-4: repetition and style checks for English (D-11). Plain rules, no AI, each one can be switched
 * off: words repeated close together, overused words per book, very long sentences, adverbs and
 * filter words. They mark the text on the Write page and add up per chapter on the Revise page.
 */
import type { Id, TextNode, World } from '../model';
import { outline } from '../story';
import { countWords } from '../writing/doc';
import { blockTexts } from './text';

export type StyleRuleId = 'repeat' | 'long-sentence' | 'adverb' | 'filter' | 'overused';

export const STYLE_RULES: Record<StyleRuleId, { name: string; hint: string }> = {
  repeat: { name: 'Repeated close together', hint: 'The same word (four letters or more) again within 30 words. Small words and names are left out.' },
  'long-sentence': { name: 'Very long sentences', hint: 'Sentences of more than 40 words.' },
  adverb: { name: 'Adverbs', hint: 'Words ending in -ly ("quickly", "softly"), apart from ones that are not adverbs ("family", "only").' },
  filter: { name: 'Filter words', hint: 'Words that put a character between the reader and what happens: saw, heard, felt, noticed, realised, wondered, seemed, decided…' },
  overused: { name: 'Overused words', hint: 'Crutch words (just, really, very, suddenly, nodded, sighed…) used more than a few times per thousand words in the book.' },
};
export const STYLE_RULE_IDS = Object.keys(STYLE_RULES) as StyleRuleId[];

const STOP = new Set(`that this with from have were they them their there then than what when where which while would could should about into over your
been being some more most such only also very just like back down even ever much many make made said says your yours mine ours with will shall upon each
other another before after again still once here these those does done doing come came gone went know knew want into onto unto it's that's don't didn't
can't wasn't isn't won't couldn't wouldn't hadn't she'd he'd they'd you'd i'd i'll she'll he'll they'll we'll you'll`.split(/\s+/));

const NOT_ADVERBS = new Set('only family early holy reply rely apply supply ugly belly jelly bully lily ally rally tally fly july italy silly hilly chilly jolly folly melancholy anomaly assembly butterfly dragonfly firefly monopoly homily wily oily curly surly burly lovely lonely lively friendly deadly costly cowardly elderly kindly likely lowly manly orderly sickly stately timely ugly unlikely worldly hourly daily weekly yearly monthly nightly scaly woolly prickly bubbly wobbly grisly gristly sly'.split(' '));

const FILTER = new Set('saw see sees seeing seen heard hear hears hearing felt feel feels feeling noticed notice notices noticing realised realized realise realize realises realizes wondered wonder wonders seemed seem seems decided decide decides watched watch watches looked thought think thinks knew know knows'.split(' '));

/** Crutch words and the most a book should have per 1,000 words before they count as overused. */
export const CRUTCH: Record<string, number> = {
  just: 3, really: 1.5, very: 2, suddenly: 0.5, quite: 1, rather: 1, somehow: 0.5, actually: 1, simply: 0.5, almost: 1.5, slightly: 0.7,
  began: 1, started: 1, nodded: 0.7, shrugged: 0.5, sighed: 0.5, smiled: 1, grinned: 0.5, turned: 1.5, glanced: 0.7, gaze: 0.5, breath: 1,
};

export interface StyleHit { block: number; from: number; to: number; rule: StyleRuleId; note: string }

const wordRe = /[\p{L}][\p{L}'’]*/gu;

/** RV-4: the style marks in one scene's paragraphs (block offsets as in text.ts). Names are passed in so they are never "repeated". */
export function styleHits(texts: string[], off: ReadonlySet<StyleRuleId> = new Set(), names: ReadonlySet<string> = new Set(), overused: ReadonlySet<string> = new Set()): StyleHit[] {
  const out: StyleHit[] = [];
  const recent: { w: string; n: number }[] = [];
  let n = 0;
  texts.forEach((text, block) => {
    if (!off.has('long-sentence')) {
      for (const s of text.matchAll(/[^.!?…]+(?:[.!?…]+["”’)]*|$)/g)) {
        const words = countWords(s[0]);
        if (words > 40) {
          const lead = s[0].length - s[0].trimStart().length;
          out.push({ block, from: s.index! + lead, to: s.index! + s[0].trimEnd().length, rule: 'long-sentence', note: `${words} words in one sentence` });
        }
      }
    }
    for (const m of text.matchAll(wordRe)) {
      const raw = m[0].replace(/['’]s$/, '');
      const w = raw.toLowerCase().replace(/’/g, "'");
      const from = m.index!, to = from + raw.length;
      n++;
      if (!off.has('adverb') && w.length > 4 && w.endsWith('ly') && !NOT_ADVERBS.has(w) && !names.has(raw)) out.push({ block, from, to, rule: 'adverb', note: 'Adverb' });
      if (!off.has('overused') && overused.has(w)) out.push({ block, from, to, rule: 'overused', note: 'Used often in this book' });
      if (!off.has('filter') && FILTER.has(w)) out.push({ block, from, to, rule: 'filter', note: 'Filter word' });
      if (!off.has('repeat') && w.length >= 4 && !STOP.has(w) && !names.has(raw)) {
        while (recent.length && n - recent[0].n > 30) recent.shift();
        const prev = recent.find((r) => r.w === w);
        if (prev) out.push({ block, from, to, rule: 'repeat', note: `"${raw}" also ${n - prev.n} words before` });
        recent.push({ w, n });
      }
    }
  });
  return out;
}

export interface StyleReport {
  words: number;
  /** Per chapter: words and counts per rule. */
  chapters: { chapterId: Id; title: string; words: number; counts: Record<StyleRuleId, number> }[];
  /** RV-4 overused words in the book: how often, per 1,000 words, and the limit. */
  overused: { word: string; count: number; per1000: number; limit: number }[];
  /** The book's most used words (not small words or names), for a look. */
  top: { word: string; count: number }[];
}

/** RV-4 over a book: counts per chapter, overused crutch words and the most used words. */
export function styleReport(world: World, bookId: Id, off: ReadonlySet<StyleRuleId> = new Set(), names: ReadonlySet<string> = new Set()): StyleReport {
  const b = outline(world).find((x) => x.book.id === bookId);
  const texts = new Map(world.sceneTexts.map((t) => [t.sceneId, t.doc]));
  const freq = new Map<string, number>();
  const report: StyleReport = { words: 0, chapters: [], overused: [], top: [] };
  for (const c of b?.chapters ?? []) {
    const counts = Object.fromEntries(STYLE_RULE_IDS.map((r) => [r, 0])) as Record<StyleRuleId, number>;
    let words = 0;
    for (const s of c.scenes) {
      const t = blockTexts(texts.get(s.id) as TextNode | undefined);
      for (const h of styleHits(t, off, names)) counts[h.rule]++;
      for (const text of t) {
        words += countWords(text);
        for (const m of text.matchAll(wordRe)) {
          const raw = m[0].replace(/['’]s$/, '');
          if (names.has(raw)) continue;
          const w = raw.toLowerCase();
          freq.set(w, (freq.get(w) ?? 0) + 1);
        }
      }
    }
    report.words += words;
    report.chapters.push({ chapterId: c.chapter.id, title: c.chapter.title, words, counts });
  }
  if (!off.has('overused') && report.words) {
    for (const [word, limit] of Object.entries(CRUTCH)) {
      const count = freq.get(word) ?? 0;
      const per1000 = (count * 1000) / report.words;
      if (per1000 > limit && count >= 3) report.overused.push({ word, count, per1000, limit });
    }
    report.overused.sort((a, b2) => b2.per1000 / b2.limit - a.per1000 / a.limit);
    for (const c of report.chapters) c.counts.overused = 0;
  }
  report.top = [...freq].filter(([w]) => w.length >= 4 && !STOP.has(w)).sort((a, b2) => b2[1] - a[1]).slice(0, 15).map(([word, count]) => ({ word, count }));
  return report;
}

/** RV-4: which rules are on for this world. */
export function styleOff(world: World): Set<StyleRuleId> {
  return new Set((world.settings.writing?.styleOff ?? []) as StyleRuleId[]);
}

/** Words of names in the world, so names are not counted as repeated or overused. */
export function nameWordSet(world: World): Set<string> {
  const out = new Set<string>();
  const add = (s?: string) => { for (const w of (s ?? '').match(wordRe) ?? []) out.add(w); };
  for (const c of world.characters) { add(c.name); c.aliases.forEach(add); }
  for (const p of world.places) { add(p.name); p.aliases.forEach(add); }
  for (const r of world.regions) add(r.name);
  for (const g of world.groups) add(g.name);
  for (const e of world.events) add(e.name);
  return out;
}
