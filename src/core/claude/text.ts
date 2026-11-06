/**
 * AI-1, AI-3: scene text as Claude reads and writes it. The Claude folder shows each scene as simple
 * Markdown (**bold**, *italics*, "* * *" for a scene break, "#" headings); a whole-scene proposal is
 * read back the same way. Passage proposals ("find this, replace with that") keep the formatting,
 * comments and links of everything around the passage.
 */
import type { TextNode } from '../model';
import { Block, Run, SCENE_BREAK_TEXT, blocksToDoc, docToBlocks, runText } from '../writing/doc';

const esc = (s: string) => s.replace(/([*_\\])/g, '\\$1');

function runsToMarkdown(runs: Run[]): string {
  return runs.map((r) => {
    if (r.br) return '  \n';
    if (!r.text) return '';
    const lead = r.text.match(/^\s*/)![0], trail = r.text.match(/\s*$/)![0];
    const core = esc(r.text.trim());
    if (!core) return r.text;
    const wrap = r.bold && r.italic ? '***' : r.bold ? '**' : r.italic ? '*' : '';
    return `${lead}${wrap}${core}${wrap}${trail}`;
  }).join('');
}

/** A scene's text as Markdown, one paragraph per block separated by a blank line. */
export function docToMarkdown(doc: TextNode | undefined): string {
  return docToBlocks(doc).map((b) => (b.kind === 'break' ? SCENE_BREAK_TEXT : b.kind === 'heading' ? `${'#'.repeat(b.level)} ${runsToMarkdown(b.runs)}` : runsToMarkdown(b.runs))).filter((x, i, a) => x || i < a.length - 1).join('\n\n');
}

/** Inline Markdown → runs: ***bold italics***, **bold**, *italics* or _italics_, backslash escapes. */
export function markdownRuns(text: string): Run[] {
  const runs: Run[] = [];
  let bold = false, italic = false, buf = '';
  const flush = () => { if (buf) runs.push({ text: buf, ...(bold ? { bold: true } : {}), ...(italic ? { italic: true } : {}) }); buf = ''; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\' && i + 1 < text.length) { buf += text[++i]; continue; }
    if (c === '*' && text.startsWith('***', i)) { flush(); bold = !bold; italic = !italic; i += 2; continue; }
    if (c === '*' && text[i + 1] === '*') { flush(); bold = !bold; i++; continue; }
    if (c === '*' || (c === '_' && (italic || /\S/.test(text[i + 1] ?? '')) && !/\w/.test(text[i - 1] ?? ''))) { flush(); italic = !italic; continue; }
    buf += c;
  }
  flush();
  return runs;
}

const isBreak = (line: string) => /^\s*(\*\s*\*\s*\*|-\s*-\s*-|#)\s*$/.test(line);

/** Markdown → a scene document. Blank lines (or single new lines) separate paragraphs. */
export function markdownToDoc(text: string): TextNode {
  const blocks: Block[] = [];
  for (const line of text.replace(/\r\n?/g, '\n').split(/\n/)) {
    if (!line.trim()) continue;
    if (isBreak(line)) { blocks.push({ kind: 'break' }); continue; }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) blocks.push({ kind: 'heading', level: h[1].length, runs: markdownRuns(h[2].trim()) });
    else blocks.push({ kind: 'p', runs: markdownRuns(line.trim()) });
  }
  return blocksToDoc(blocks);
}

/** How many times a passage occurs in the text (paragraph by paragraph; passages do not cross paragraphs). */
export function countPassage(doc: TextNode | undefined, find: string): number {
  if (!find) return 0;
  let n = 0;
  for (const b of docToBlocks(doc)) {
    if (b.kind === 'break') continue;
    const t = runText(b.runs);
    for (let i = t.indexOf(find); i >= 0; i = t.indexOf(find, i + find.length)) n++;
  }
  return n;
}

/** Cut runs at a character offset range: what is before, and what is after. */
function splitRuns(runs: Run[], start: number, end: number): { before: Run[]; after: Run[]; at?: Run } {
  const before: Run[] = [], after: Run[] = [];
  let at: Run | undefined;
  let pos = 0;
  for (const r of runs) {
    const len = r.br ? 1 : r.text.length;
    const a = pos, b = pos + len;
    pos = b;
    if (b <= start) { before.push(r); continue; }
    if (a >= end) { after.push(r); continue; }
    at ??= r;
    if (r.br) continue;
    if (a < start) before.push({ ...r, text: r.text.slice(0, start - a) });
    if (b > end) after.push({ ...r, text: r.text.slice(end - a) });
  }
  return { before, after, at };
}

/**
 * Replace the one occurrence of `find` with `replace`. The new words take the bold/italic of the
 * text they replace (Markdown in `replace` adds its own); a blank line in `replace` starts a new paragraph.
 * Returns undefined when the passage does not occur exactly once.
 */
export function replacePassage(doc: TextNode | undefined, find: string, replace: string): TextNode | undefined {
  if (countPassage(doc, find) !== 1) return undefined;
  const blocks = docToBlocks(doc);
  const out: Block[] = [];
  for (const b of blocks) {
    if (b.kind === 'break') { out.push(b); continue; }
    const t = runText(b.runs);
    const i = t.indexOf(find);
    if (i < 0) { out.push(b); continue; }
    const { before, after, at } = splitRuns(b.runs, i, i + find.length);
    const style = (r: Run): Run => ({ ...r, bold: r.bold || at?.bold || undefined, italic: r.italic || at?.italic || undefined });
    const parts = replace.replace(/\r\n?/g, '\n').split(/\n\s*\n/);
    parts.forEach((part, k) => {
      const mid = markdownRuns(part.replace(/\n/g, ' ')).map(style);
      const runs = [...(k === 0 ? before : []), ...mid, ...(k === parts.length - 1 ? after : [])];
      out.push(b.kind === 'heading' && k === 0 ? { kind: 'heading', level: b.level, runs } : { kind: 'p', runs });
    });
  }
  return blocksToDoc(out);
}
