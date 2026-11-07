/**
 * RV-1, RV-3, RV-6: small tools for changing scene text without losing its formatting, links or
 * margin comments. They work on the simple block form of a scene (writing/doc.ts).
 */
import type { Id, TextNode } from '../model';
import { Block, Run, blocksToDoc, docToBlocks, runText } from '../writing/doc';

export interface MatchOptions {
  /** Only whole words: "Kael" does not match inside "Kaela". */
  wholeWord?: boolean;
  /** "kaela" does not match "Kaela". */
  matchCase?: boolean;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WORD = '\\p{L}\\p{N}_';

/** [from, to) of every match of a literal query in a text. Curly and straight apostrophes match each other. */
export function matchRanges(text: string, query: string, opts: MatchOptions = {}): [number, number][] {
  if (!query) return [];
  let body = esc(query).replace(/['’]/g, "['’]");
  if (opts.wholeWord) body = `(?<![${WORD}])${body}(?![${WORD}])`;
  const re = new RegExp(body, `gu${opts.matchCase ? '' : 'i'}`);
  const out: [number, number][] = [];
  for (const m of text.matchAll(re)) if (m[0].length) out.push([m.index!, m.index! + m[0].length]);
  return out;
}

/** Split runs so that from and to fall on run edges; returns the new runs and the index range [a, b) covering from–to. */
function splitAt(runs: Run[], from: number, to: number): { runs: Run[]; a: number; b: number } {
  const out: Run[] = [];
  let pos = 0, a = -1, b = -1;
  for (const r of runs) {
    const len = r.br ? 1 : r.text.length;
    const start = pos, end = pos + len;
    pos = end;
    if (r.br || end <= from || start >= to) {
      if (a < 0 && start >= from) a = out.length;
      if (b < 0 && start >= to) b = out.length;
      out.push(r);
      continue;
    }
    const cuts = [start, Math.max(start, from), Math.min(end, to), end];
    for (let i = 0; i < 3; i++) {
      if (cuts[i + 1] <= cuts[i]) continue;
      if (cuts[i] === from && a < 0) a = out.length;
      if (cuts[i] === to && b < 0) b = out.length;
      out.push({ ...r, text: r.text.slice(cuts[i] - start, cuts[i + 1] - start) });
    }
  }
  if (a < 0) a = out.length;
  if (b < 0) b = out.length;
  return { runs: out, a, b };
}

/** Change the runs that cover from–to (in runText offsets). */
export function mapRange(runs: Run[], from: number, to: number, fn: (r: Run) => Run): Run[] {
  const s = splitAt(runs, from, to);
  return s.runs.map((r, i) => (i >= s.a && i < s.b && !r.br ? fn(r) : r));
}

/** Replace from–to with new text, which takes the formatting of the first replaced letter. */
export function replaceRange(runs: Run[], from: number, to: number, text: string): Run[] {
  const s = splitAt(runs, from, to);
  const first = s.runs.slice(s.a, s.b).find((r) => !r.br) ?? s.runs[s.a - 1] ?? { text: '' };
  const repl: Run[] = text ? [{ ...first, br: undefined, text }] : [];
  return [...s.runs.slice(0, s.a), ...repl, ...s.runs.slice(s.b)];
}

/** One replacement in a scene: which block (index into docToBlocks, scene breaks included) and where. */
export interface TextEdit { block: number; from: number; to: number; text: string }

/** Apply replacements to a scene's text. Edits in one block must not overlap. */
export function applyEdits(doc: TextNode | undefined, edits: TextEdit[]): TextNode {
  const blocks = docToBlocks(doc);
  const byBlock = new Map<number, TextEdit[]>();
  for (const e of edits) byBlock.set(e.block, [...(byBlock.get(e.block) ?? []), e]);
  const next = blocks.map((b, i) => {
    const list = byBlock.get(i);
    if (!list || b.kind === 'break') return b;
    let runs = b.runs;
    for (const e of [...list].sort((x, y) => y.from - x.from)) runs = replaceRange(runs, e.from, e.to, e.text);
    return { ...b, runs };
  });
  return blocksToDoc(next);
}

/** The text of each block (scene breaks as ""), the offsets edits use. */
export function blockTexts(doc: TextNode | undefined): string[] {
  return docToBlocks(doc).map((b) => (b.kind === 'break' ? '' : runText(b.runs)));
}

/** The words each margin comment covers, joined across runs (first stretch only). */
export function commentQuotes(blocks: Block[]): Map<Id, string> {
  const out = new Map<Id, string>();
  const done = new Set<Id>();
  for (const b of blocks) {
    if (b.kind === 'break') continue;
    let open = new Set<Id>();
    for (const r of b.runs) {
      const here = new Set(r.comments ?? []);
      for (const id of open) if (!here.has(id)) done.add(id);
      for (const id of here) if (!done.has(id)) out.set(id, (out.get(id) ?? '') + (r.br ? ' ' : r.text));
      open = here;
    }
    for (const id of open) done.add(id);
  }
  return out;
}

/**
 * RV-6: after a scene's text is replaced by another version (an editor's), put the old version's links
 * and margin comments back on the same words where those words are still there. Returns the comment
 * ids that found no home.
 */
export function carryMarks(oldDoc: TextNode | undefined, newBlocks: Block[]): { blocks: Block[]; lost: Id[] } {
  const old = docToBlocks(oldDoc);
  const marks: { text: string; apply: (r: Run) => Run; comment?: Id }[] = [];
  for (const b of old) {
    if (b.kind === 'break') continue;
    let cur: { text: string; link: NonNullable<Run['link']> } | undefined;
    const flush = () => { if (cur?.text.trim()) { const link = cur.link; marks.push({ text: cur.text, apply: (r) => ({ ...r, link }) }); } cur = undefined; };
    for (const r of b.runs) {
      if (r.link && !r.br && cur && cur.link.id === r.link.id && cur.link.kind === r.link.kind) cur.text += r.text;
      else { flush(); if (r.link && !r.br) cur = { text: r.text, link: r.link }; }
    }
    flush();
  }
  for (const [id, text] of commentQuotes(old)) if (text.trim()) marks.push({ text, comment: id, apply: (r) => ({ ...r, comments: [...new Set([...(r.comments ?? []), id])] }) });
  let blocks = newBlocks.map((b) => ({ ...b }));
  const lost: Id[] = [];
  for (const m of marks) {
    let placed = false;
    for (let i = 0; i < blocks.length && !placed; i++) {
      const b = blocks[i];
      if (b.kind === 'break') continue;
      const hit = matchRanges(runText(b.runs), m.text, { matchCase: true })[0];
      if (!hit) continue;
      blocks = blocks.map((x, k) => (k === i && x.kind !== 'break' ? { ...x, runs: mapRange(x.runs, hit[0], hit[1], m.apply) } : x));
      placed = true;
    }
    if (!placed && m.comment) lost.push(m.comment);
  }
  return { blocks, lost };
}
