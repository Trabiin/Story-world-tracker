/**
 * WR-1: scene text. Each scene's text is a ProseMirror document stored as plain JSON, so the core,
 * the tests, the exports and (later) Claude can read it without the editor.
 *
 * Nodes:  doc > (paragraph | heading{level 1–3} | scene_break)+
 *         paragraph, heading > (text | hard_break)*
 * Marks on text: strong (bold), em (italics), comment{id} (WR-4, NT-1),
 *                link{kind, id, note} (a passage linked to a record; ST-9 links brought in by WR-4).
 *
 * The editor's schema (ui/writing/schema.ts) must match this description.
 */
import type { Id, LinkTargetKind, SceneText, TextMark, TextNode, World } from '../model';

/** One run of text with the same formatting. */
export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  /** Comment ids that cover this run. */
  comments?: Id[];
  link?: { kind: LinkTargetKind; id: Id; note?: string };
  /** A line break inside the paragraph (Shift+Enter). text is ignored. */
  br?: boolean;
}

/** A paragraph-level block, the simple form used by import, export, safety copies and search. */
export type Block =
  | { kind: 'p'; runs: Run[] }
  | { kind: 'heading'; level: number; runs: Run[] }
  | { kind: 'break' };

export const SCENE_BREAK_TEXT = '* * *';

export function emptyDoc(): TextNode {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

export function runText(runs: Run[]): string {
  return runs.map((r) => (r.br ? '\n' : r.text)).join('');
}

/** ProseMirror JSON → blocks. Unknown node types are read as paragraphs, so nothing is lost. */
export function docToBlocks(doc: TextNode | undefined): Block[] {
  const out: Block[] = [];
  for (const n of doc?.content ?? []) {
    if (n.type === 'scene_break' || n.type === 'horizontal_rule') { out.push({ kind: 'break' }); continue; }
    const runs = inlineRuns(n);
    if (n.type === 'heading') out.push({ kind: 'heading', level: clampLevel(n.attrs?.level), runs });
    else out.push({ kind: 'p', runs });
  }
  return out;
}

function clampLevel(v: unknown): number {
  const n = Number(v);
  return n >= 1 && n <= 3 ? Math.round(n) : 2;
}

function inlineRuns(n: TextNode): Run[] {
  const runs: Run[] = [];
  const walk = (node: TextNode) => {
    if (node.type === 'text') {
      const r: Run = { text: node.text ?? '' };
      for (const m of node.marks ?? []) {
        if (m.type === 'strong') r.bold = true;
        else if (m.type === 'em') r.italic = true;
        else if (m.type === 'comment' && m.attrs?.id) (r.comments ??= []).push(String(m.attrs.id));
        else if (m.type === 'link' && m.attrs?.id) r.link = { kind: m.attrs.kind as LinkTargetKind, id: String(m.attrs.id), note: m.attrs.note ? String(m.attrs.note) : undefined };
      }
      runs.push(r);
    } else if (node.type === 'hard_break') runs.push({ text: '', br: true });
    else for (const c of node.content ?? []) walk(c);
  };
  for (const c of n.content ?? []) walk(c);
  return runs;
}

/** Blocks → ProseMirror JSON. Neighbouring runs with the same formatting are joined. */
export function blocksToDoc(blocks: Block[]): TextNode {
  const content: TextNode[] = blocks.map((b) => {
    if (b.kind === 'break') return { type: 'scene_break' };
    const inline = runsToNodes(b.runs);
    const node: TextNode = b.kind === 'heading' ? { type: 'heading', attrs: { level: clampLevel(b.level) } } : { type: 'paragraph' };
    if (inline.length) node.content = inline;
    return node;
  });
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

function marksOf(r: Run): TextMark[] {
  const m: TextMark[] = [];
  if (r.bold) m.push({ type: 'strong' });
  if (r.italic) m.push({ type: 'em' });
  for (const id of r.comments ?? []) m.push({ type: 'comment', attrs: { id } });
  if (r.link) m.push({ type: 'link', attrs: { kind: r.link.kind, id: r.link.id, note: r.link.note ?? '' } });
  return m;
}

function runsToNodes(runs: Run[]): TextNode[] {
  const out: TextNode[] = [];
  for (const r of runs) {
    if (r.br) { out.push({ type: 'hard_break' }); continue; }
    if (!r.text) continue;
    const marks = marksOf(r);
    const prev = out[out.length - 1];
    if (prev?.type === 'text' && JSON.stringify(prev.marks ?? []) === JSON.stringify(marks)) { prev.text += r.text; continue; }
    out.push(marks.length ? { type: 'text', text: r.text, marks } : { type: 'text', text: r.text });
  }
  return out;
}

/** Plain text: one line per paragraph or heading, scene breaks as "* * *". */
export function docToPlain(doc: TextNode | undefined, paragraphGap = '\n'): string {
  return docToBlocks(doc).map((b) => (b.kind === 'break' ? SCENE_BREAK_TEXT : runText(b.runs))).join(paragraphGap);
}

/** Paragraph texts without the breaks, for name spotting, search and passage anchors. */
export function docParagraphs(doc: TextNode | undefined): { text: string; heading?: number }[] {
  return docToBlocks(doc).filter((b) => b.kind !== 'break').map((b) => (b.kind === 'heading' ? { text: runText(b.runs), heading: b.level } : { text: runText((b as { runs: Run[] }).runs) }));
}

/** Words as a writer counts them: anything between spaces that has a letter or digit. "don't" and "well-known" are one word each. */
export function countWords(text: string): number {
  let n = 0;
  for (const w of text.split(/[\s—–]+/)) if (/[\p{L}\p{N}]/u.test(w)) n++;
  return n;
}

export function docWords(doc: TextNode | undefined): number {
  return docToBlocks(doc).reduce((n, b) => n + (b.kind === 'break' ? 0 : countWords(runText(b.runs))), 0);
}

/** Plain text → document: blank lines or new lines split paragraphs, "***" or "#" lines are scene breaks. */
export function plainToDoc(text: string): TextNode {
  const blocks: Block[] = [];
  for (const line of text.replace(/\r\n?/g, '\n').split(/\n/)) {
    if (!line.trim()) continue;
    if (isSceneBreakText(line)) blocks.push({ kind: 'break' });
    else blocks.push({ kind: 'p', runs: [{ text: line.trim() }] });
  }
  return blocksToDoc(blocks);
}

/** WR-4: a paragraph that is only a scene-break mark: "***", "* * *", "#", "~ ~ ~", "---", "§". */
export function isSceneBreakText(text: string): boolean {
  const t = text.replace(/\s+/g, '');
  return /^(\*{3,}|#{1,3}|~{1,3}|-{3,}|_{3,}|§{1,3}|•{3}|o{3}|0{3}|(\*~){1,2}\*?|\+{3})$/.test(t);
}

/** The text record of a scene, if it has any. */
export function textOf(world: World, sceneId: Id): SceneText | undefined {
  return world.sceneTexts.find((t) => t.sceneId === sceneId);
}

/** Every link mark in a scene's text, with the words it covers. */
export function linksInDoc(doc: TextNode | undefined): { kind: LinkTargetKind; id: Id; note?: string; text: string }[] {
  const out: { kind: LinkTargetKind; id: Id; note?: string; text: string }[] = [];
  for (const b of docToBlocks(doc)) {
    if (b.kind === 'break') continue;
    for (const r of b.runs) {
      if (!r.link) continue;
      const last = out[out.length - 1];
      if (last && last.id === r.link.id && last.kind === r.link.kind) last.text += r.text;
      else out.push({ ...r.link, text: r.text });
    }
  }
  return out;
}

/** Take a margin comment's mark off the text (the comment itself is removed from the record by the caller). */
export function removeCommentMarks(doc: TextNode, commentId: Id): TextNode {
  const walk = (n: TextNode): TextNode => {
    let out = n;
    if (n.marks?.some((m) => m.type === 'comment' && m.attrs?.id === commentId)) {
      const marks = n.marks.filter((m) => !(m.type === 'comment' && m.attrs?.id === commentId));
      out = { ...n, marks: marks.length ? marks : undefined };
      if (!marks.length) delete out.marks;
    }
    if (n.content) out = { ...out, content: n.content.map(walk) };
    return out;
  };
  return walk(doc);
}
