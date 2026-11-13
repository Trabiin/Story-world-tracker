/**
 * RV-6: the editor round trip (D-12). A Word file exported from the app (WR-5) goes to an editor, who
 * sends it back with tracked changes and comments. Reading it back finds each scene by the hidden
 * bookmark the export put around it (or, for older exports, by chapter titles and scene breaks), shows
 * the changes scene by scene, and lets the writer accept, reject or keep both. The editor's comments
 * become margin comments (NT-1).
 */
import type { Id, TextComment, TextNode, World } from '../model';
import { outline } from '../story';
import { Block, Run, blocksToDoc, docToBlocks, isSceneBreakText, runText } from '../writing/doc';
import { DocxContent, FRONT_MATTER_STYLES, RichPara } from '../writing/docxImport';
import { sceneBookmark } from '../writing/docxExport';
import { carryMarks, commentQuotes, mapRange, matchRanges } from './text';

export interface SceneReview {
  sceneId: Id;
  title: string;
  chapterTitle: string;
  /** The scene as it is in the app. */
  mine: Block[];
  /** The editor's version with every tracked change accepted. */
  theirs: Block[];
  /** The editor's version with tracked changes marked (Run.rev), to show them. */
  marked: Block[];
  insertions: number;
  deletions: number;
  /** Who made the tracked changes. */
  authors: string[];
  /** The editor's comments on this scene (ids as in the Word file). */
  comments: TextComment[];
  /** The text differs from the app's (tracked or not). */
  changed: boolean;
}

export interface Review {
  bookId?: Id;
  /** How scenes were found: our bookmarks, or chapter titles and scene breaks (older exports). */
  matchedBy: 'bookmarks' | 'chapters' | 'none';
  scenes: SceneReview[];
  /** Chapters in the file that could not be matched to scenes. */
  unplaced: string[];
}

const blockText = (b: Block) => (b.kind === 'break' ? '§' : runText(b.runs).trim());
const sameText = (a: Block[], b: Block[]) => a.length === b.length && a.every((x, i) => blockText(x) === blockText(b[i]) && x.kind === b[i].kind);

function toBlocks(paras: RichPara[]): Block[] {
  return paras.map((p): Block => {
    if (isSceneBreakText(runText(p.runs.filter((r) => r.rev?.kind !== 'del')))) return { kind: 'break' };
    if (p.heading && p.heading >= 2) return { kind: 'heading', level: Math.min(3, p.heading - 1), runs: p.runs };
    return { kind: 'p', runs: p.runs };
  });
}

/** The editor's version with every change accepted: deleted runs gone, the marks taken off. */
function accepted(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    if (b.kind === 'break') { out.push(b); continue; }
    const runs = b.runs.filter((r) => r.rev?.kind !== 'del').map(({ rev: _r, ...r }) => r as Run);
    // A paragraph that was deleted whole is gone.
    if (!runText(runs).trim() && b.runs.some((r) => r.rev?.kind === 'del')) continue;
    out.push({ ...b, runs });
  }
  return out;
}

function review(world: World, sceneId: Id, chapterTitle: string, paras: RichPara[], content: DocxContent): SceneReview {
  const scene = world.scenes.find((s) => s.id === sceneId)!;
  const marked = toBlocks(paras);
  const theirs = accepted(marked);
  const mine = docToBlocks(world.sceneTexts.find((t) => t.sceneId === sceneId)?.doc);
  let insertions = 0, deletions = 0;
  const authors = new Set<string>();
  const ids = new Set<string>();
  for (const b of marked) {
    if (b.kind === 'break') continue;
    let prev: Run['rev'];
    for (const r of b.runs) {
      if (r.rev && (r.rev.kind !== prev?.kind || r.rev.author !== prev?.author)) { if (r.rev.kind === 'ins') insertions++; else deletions++; }
      if (r.rev?.author) authors.add(r.rev.author);
      prev = r.rev;
      for (const c of r.comments ?? []) ids.add(c);
    }
  }
  return {
    sceneId, title: scene.title, chapterTitle, mine, theirs, marked, insertions, deletions, authors: [...authors],
    comments: content.comments.filter((c) => ids.has(c.id)), changed: !sameText(mine, theirs),
  };
}

/** Read an edited Word file (read with revisions) against the world. */
export function reviewDocx(world: World, content: DocxContent): Review {
  const tree = outline(world);
  const byMark = new Map<string, { sceneId: Id; chapter: string; bookId: Id }>();
  for (const b of tree) for (const c of b.chapters) for (const s of c.scenes) byMark.set(sceneBookmark(s.id), { sceneId: s.id, chapter: c.chapter.title, bookId: b.book.id });
  const groups = new Map<string, RichPara[]>();
  for (const p of content.paras) if (p.scene && byMark.has(p.scene)) groups.set(p.scene, [...(groups.get(p.scene) ?? []), p]);
  if (groups.size) {
    const scenes = [...groups].map(([k, paras]) => review(world, byMark.get(k)!.sceneId, byMark.get(k)!.chapter, paras, content));
    const books = new Set([...groups.keys()].map((k) => byMark.get(k)!.bookId));
    return { bookId: books.size === 1 ? [...books][0] : undefined, matchedBy: 'bookmarks', scenes, unplaced: [] };
  }
  // An older export (or one whose bookmarks were lost): chapter titles, then scene breaks within a chapter.
  const chapters: { title: string; paras: RichPara[] }[] = [];
  for (const p of content.paras) {
    if (p.style && FRONT_MATTER_STYLES.includes(p.style)) continue;
    if (p.heading === 1) { chapters.push({ title: runText(p.runs.filter((r) => r.rev?.kind !== 'del')).trim(), paras: [] }); continue; }
    chapters[chapters.length - 1]?.paras.push(p);
  }
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  let best: (typeof tree)[number] | undefined, bestHits = 0;
  for (const b of tree) {
    const hits = chapters.filter((c) => b.chapters.some((x) => norm(x.chapter.title) === norm(c.title))).length;
    if (hits > bestHits || (hits === bestHits && hits && content.title && norm(b.book.title) === norm(content.title))) { best = b; bestHits = hits; }
  }
  if (!best) return { matchedBy: 'none', scenes: [], unplaced: chapters.map((c) => c.title) };
  const scenes: SceneReview[] = [];
  const unplaced: string[] = [];
  for (const c of chapters) {
    const ch = best.chapters.find((x) => norm(x.chapter.title) === norm(c.title));
    if (!ch || !ch.scenes.length) { unplaced.push(c.title); continue; }
    const isSep = (p: RichPara) => p.style === 'SwtSceneSep';
    const isBreak = (p: RichPara) => isSceneBreakText(runText(p.runs));
    const isTitle = (p: RichPara) => p.heading === 2 && ch.scenes.some((s) => norm(s.title) === norm(runText(p.runs)));
    const split = (cut: (p: RichPara) => boolean, dropCut: boolean) => {
      const out: RichPara[][] = [[]];
      for (const p of c.paras) { if (cut(p)) { if (out[out.length - 1].length || !dropCut) out.push([]); if (!dropCut) out[out.length - 1].push(p); continue; } out[out.length - 1].push(p); }
      return out.filter((x) => x.length);
    };
    let parts: RichPara[][] | undefined;
    if (ch.scenes.length === 1) parts = [c.paras.filter((p) => !isSep(p) && !isTitle(p))];
    else {
      for (const cut of [isSep, isTitle, isBreak]) {
        const p = split(cut, true).map((x) => x.filter((y) => !isTitle(y) && !isSep(y)));
        if (p.length === ch.scenes.length) { parts = p; break; }
      }
    }
    if (!parts) { unplaced.push(c.title); continue; }
    parts.forEach((paras, i) => scenes.push(review(world, ch.scenes[i].id, ch.chapter.title, paras, content)));
  }
  return { bookId: best.book.id, matchedBy: 'chapters', scenes, unplaced };
}

export type ReviewDecision = 'accept' | 'reject' | 'both';

/**
 * Apply a decision to one scene. accept: the editor's text, with the app's links and margin comments
 * put back where their words still are. reject and both: the app's text stays ("both" also keeps the
 * editor's version in the scene's history, which the caller saves). With bringComments the editor's
 * comments become margin comments on the same words (or, when the words are gone, at the end of the list).
 */
export function decideScene(r: SceneReview, oldDoc: TextNode | undefined, oldComments: TextComment[], decision: ReviewDecision, bringComments: boolean, newId: () => Id): { doc: TextNode; comments: TextComment[]; editorDoc: TextNode } {
  const ids = new Map(r.comments.map((c) => [c.id, newId()]));
  const remap = (blocks: Block[], keep: boolean): Block[] => blocks.map((b) => (b.kind === 'break' ? b : {
    ...b, runs: b.runs.map((x) => {
      const cs = (x.comments ?? []).filter((c) => !ids.has(c) || keep).map((c) => ids.get(c) ?? c);
      return { ...x, comments: cs.length ? cs : undefined };
    }),
  }));
  const editorDoc = blocksToDoc(remap(r.theirs, false));
  const incoming = bringComments ? r.comments.map((c) => ({ ...c, id: ids.get(c.id)! })) : [];
  if (decision === 'accept') {
    const carried = carryMarks(oldDoc, remap(r.theirs, bringComments));
    return { doc: blocksToDoc(carried.blocks), comments: [...oldComments, ...incoming], editorDoc };
  }
  // Keep the app's text; anchor the editor's comments on the same words if they are still there.
  let blocks = docToBlocks(oldDoc);
  if (bringComments) {
    const quotes = commentQuotes(remap(r.theirs, true));
    for (const c of incoming) {
      const q = quotes.get(c.id);
      if (!q?.trim()) continue;
      const i = blocks.findIndex((b) => b.kind !== 'break' && matchRanges(runText(b.runs), q, { matchCase: true }).length);
      if (i < 0) continue;
      const b = blocks[i] as Exclude<Block, { kind: 'break' }>;
      const [from, to] = matchRanges(runText(b.runs), q, { matchCase: true })[0];
      blocks = blocks.map((x, k) => (k === i ? { ...b, runs: mapRange(b.runs, from, to, (run) => ({ ...run, comments: [...(run.comments ?? []), c.id] })) } : x));
    }
  }
  return { doc: bringComments ? blocksToDoc(blocks) : oldDoc ?? blocksToDoc(blocks), comments: [...oldComments, ...incoming], editorDoc };
}
