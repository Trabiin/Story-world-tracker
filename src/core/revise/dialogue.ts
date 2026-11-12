/**
 * RV-7: dialogue by character. A line of dialogue is text tagged with a speaker mark in the scene
 * text (the Write page's "Speaker" button). Lines are listed in reading order. Guessing speakers
 * from untagged quotes comes later; for now the page shows how many quotes are still untagged.
 */
import type { Id, World } from '../model';
import { outline } from '../story';
import { docToBlocks, textOf } from '../writing/doc';

export interface DialogueLine {
  characterId: Id;
  sceneId: Id;
  bookId: Id;
  chapterTitle: string;
  sceneTitle: string;
  text: string;
  /** Position in reading order across the series, from 0. */
  index: number;
}

/** Quote marks: opening → closing. Straight double quotes close themselves. */
const QUOTES: Record<string, string> = { '“': '”', '"': '"', '‘': '’', '«': '»', '„': '“' };

/** Every tagged line in reading order (neighbouring runs with the same speaker in a paragraph make one line). */
export function dialogueLines(world: World, opts: { bookId?: Id; characterId?: Id } = {}): DialogueLine[] {
  const out: DialogueLine[] = [];
  let index = 0;
  for (const b of outline(world)) {
    for (const { chapter, scenes } of b.chapters) {
      for (const s of scenes) {
        for (const block of docToBlocks(textOf(world, s.id)?.doc)) {
          if (block.kind === 'break') continue;
          let cur: DialogueLine | undefined;
          for (const r of block.runs) {
            if (r.speaker && cur?.characterId === r.speaker && !r.br) { cur.text += r.text; continue; }
            if (cur) { cur = undefined; }
            if (!r.speaker || r.br) continue;
            cur = { characterId: r.speaker, sceneId: s.id, bookId: b.book.id, chapterTitle: chapter.title, sceneTitle: s.title, text: r.text, index: index++ };
            out.push(cur);
          }
        }
      }
    }
  }
  return out
    .map((l) => ({ ...l, text: l.text.trim() }))
    .filter((l) => l.text && (!opts.bookId || l.bookId === opts.bookId) && (!opts.characterId || l.characterId === opts.characterId));
}

export interface DialogueCount { characterId: Id; lines: number; words: number; scenes: number }

/** How much each character says, most first. */
export function dialogueCounts(lines: DialogueLine[]): DialogueCount[] {
  const m = new Map<Id, DialogueCount & { sceneSet: Set<Id> }>();
  for (const l of lines) {
    const c = m.get(l.characterId) ?? { characterId: l.characterId, lines: 0, words: 0, scenes: 0, sceneSet: new Set<Id>() };
    c.lines++;
    c.words += l.text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
    c.sceneSet.add(l.sceneId);
    m.set(l.characterId, c);
  }
  return [...m.values()].map(({ sceneSet, ...c }) => ({ ...c, scenes: sceneSet.size })).sort((a, b) => b.words - a.words || b.lines - a.lines);
}

/** Quoted spans in a paragraph's text: [from, to) including the quote marks. */
export function quoteSpans(text: string): [number, number][] {
  const out: [number, number][] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const close = QUOTES[ch];
    // A single opening quote only counts at the start of a word (not "rock ’n’ roll" or an apostrophe).
    if (close && (ch !== '‘' || i === 0 || /[\s(—–-]/.test(text[i - 1]))) {
      let j = i + 1;
      for (; j < text.length; j++) {
        if (text[j] !== close) continue;
        // A closing ’ followed by a letter is an apostrophe ("don’t"), not the end of the quote.
        if (close === '’' && /\p{L}/u.test(text[j + 1] ?? '')) continue;
        break;
      }
      if (j < text.length) { out.push([i, j + 1]); i = j + 1; continue; }
      // An unclosed quote runs to the end of the paragraph (the speech goes on in the next one).
      out.push([i, text.length]);
      break;
    }
    i++;
  }
  return out;
}

/** The quote around a position in a paragraph, for tagging a line with the cursor inside it. */
export function quoteAt(text: string, offset: number): [number, number] | undefined {
  return quoteSpans(text).find(([a, b]) => offset >= a && offset <= b);
}

/** How many quotes in a book have no speaker yet (for the "still untagged" hint). */
export function untaggedQuotes(world: World, bookId?: Id): number {
  let n = 0;
  for (const b of outline(world)) {
    if (bookId && b.book.id !== bookId) continue;
    for (const { scenes } of b.chapters) for (const s of scenes) {
      for (const block of docToBlocks(textOf(world, s.id)?.doc)) {
        if (block.kind !== 'p') continue;
        let text = '';
        const tagged: boolean[] = [];
        for (const r of block.runs) {
          const t = r.br ? '\n' : r.text;
          text += t;
          for (let k = 0; k < t.length; k++) tagged.push(!!r.speaker);
        }
        for (const [a, c] of quoteSpans(text)) if (!tagged.slice(a, c).some(Boolean)) n++;
      }
    }
  }
  return n;
}
