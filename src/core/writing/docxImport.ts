/**
 * WR-4: bring a Word .docx into the app's editor. Text, headings, bold, italics and scene breaks are
 * kept; Word comments become margin comments; passage links (ST-9) move with their text.
 * The Word file itself is only read.
 */
import JSZip from 'jszip';
import { attr, decode, headingStyles, locate } from '../manuscript';
import type { Book, Chapter, Id, ManuscriptLink, Paragraph, RecordBase, Scene, SceneText, TextComment, World } from '../model';
import { Block, Run, blocksToDoc, countWords, docWords, isSceneBreakText, runText } from './doc';

/** One paragraph of the Word file with its formatting. Blank paragraphs are left out, as in the reader (ST-10). */
export interface RichPara {
  runs: Run[];
  heading?: number;
  /** Word style id, e.g. our own title page styles, which are skipped on import. */
  style?: string;
  /** RV-6: the scene this paragraph came from, from the bookmark our export puts around each scene ("swt_" + scene id without dashes). */
  scene?: string;
}

export interface DocxContent {
  paras: RichPara[];
  comments: TextComment[];
  /** The document title from Word's file properties, if set. */
  title?: string;
}

/** Styles our own export uses for the title page and "THE END"; they are not part of the story. */
export const FRONT_MATTER_STYLES = ['SwtTitlePage', 'SwtEnd'];

const on = (rPr: string, tag: string) => {
  const m = rPr.match(new RegExp(`<w:${tag}\\b([^>]*)/?>`));
  if (!m) return false;
  const v = m[1].match(/w:val="([^"]*)"/)?.[1];
  return v === undefined || !/^(0|false|off|none)$/i.test(v);
};

/** Read paragraphs with bold, italics, line breaks and comment ranges from document.xml. */
export function richFromXml(documentXml: string, stylesXml?: string, commentsXml?: string, opts: { revisions?: boolean } = {}): DocxContent {
  const styles = headingStyles(stylesXml);
  const body = documentXml.slice(Math.max(0, documentXml.indexOf('<w:body')));
  const paras: RichPara[] = [];
  const open = new Set<string>();
  // RV-6: our export's scene bookmark that is open now.
  let cur: { id: string; key: string } | undefined;
  const bookmark = (tag: string): 'start' | 'end' | undefined => {
    if (tag.startsWith('<w:bookmarkStart')) {
      const name = attr(tag, 'w:bookmarkStart', 'w:name') ?? '', id = attr(tag, 'w:bookmarkStart', 'w:id') ?? '';
      if (!name.startsWith('swt_')) return undefined;
      cur = { id, key: name };
      return 'start';
    }
    const id = attr(tag, 'w:bookmarkEnd', 'w:id');
    if (cur && id === cur.id) { cur = undefined; return 'end'; }
    return undefined;
  };
  for (const m of body.matchAll(/<w:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:p>)|<w:bookmark(?:Start|End)\b[^>]*\/>/g)) {
    if (m[0].startsWith('<w:bookmark')) { bookmark(m[0]); continue; }
    const inner = m[1] ?? '';
    const runs: Run[] = [];
    let scene: string | undefined;
    let rev: Run['rev'];
    for (const t of inner.matchAll(/<w:commentRangeStart\b[^>]*\/>|<w:commentRangeEnd\b[^>]*\/>|<w:bookmark(?:Start|End)\b[^>]*\/>|<w:(?:ins|del|moveFrom|moveTo)\b[^>]*>|<\/w:(?:ins|del|moveFrom|moveTo)>|<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g)) {
      const tag = t[0];
      if (tag.startsWith('<w:commentRangeStart')) { const id = attr(tag, 'w:commentRangeStart', 'w:id'); if (id) open.add(id); continue; }
      if (tag.startsWith('<w:commentRangeEnd')) { const id = attr(tag, 'w:commentRangeEnd', 'w:id'); if (id) open.delete(id); continue; }
      if (tag.startsWith('<w:bookmark')) { if (bookmark(tag) === 'start') scene = cur!.key; continue; }
      if (tag.startsWith('</w:')) { rev = undefined; continue; }
      if (!/^<w:r[\s>]/.test(tag)) {
        if (tag.endsWith('/>')) continue; // a revision mark on the paragraph itself
        const name = tag.match(/^<w:(\w+)/)![1];
        rev = { kind: name === 'del' || name === 'moveFrom' ? 'del' : 'ins', author: attr(tag, `w:${name}`, 'w:author'), date: attr(tag, `w:${name}`, 'w:date') };
        continue;
      }
      if (rev?.kind === 'del' && !opts.revisions) continue; // deleted text is not part of the edited file
      const run = t[1] ?? '';
      const rPr = run.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/)?.[1] ?? '';
      const bold = on(rPr, 'b'), italic = on(rPr, 'i');
      const comments = open.size ? [...open].map((id) => `docx-comment-${id}`) : undefined;
      const extra: Partial<Run> = opts.revisions && rev ? { rev } : {};
      const before = runs.length;
      for (const x of run.matchAll(/<w:(?:t|delText)(?:\s[^>]*)?>([\s\S]*?)<\/w:(?:t|delText)>|<w:t\/>|<w:tab\/>|<w:br\b[^>]*\/>|<w:cr\/>/g)) {
        if (x[0].startsWith('<w:tab')) runs.push({ text: '\t', bold, italic, comments, ...extra });
        else if (x[0].startsWith('<w:t') || x[0].startsWith('<w:delText')) { const s = decode(x[1] ?? '').replace(/ /g, ' '); if (s) runs.push({ text: s, bold, italic, comments, ...extra }); }
        else runs.push({ text: '', br: true });
      }
      if (runs.length > before && !scene && cur) scene = cur.key;
    }
    const styleId = attr(inner, 'w:pStyle');
    const outline = attr(inner, 'w:outlineLvl');
    let heading = styleId ? styles.get(styleId) ?? (/^heading(\d)$/i.test(styleId) ? Number(styleId.slice(-1)) : undefined) : undefined;
    if (heading === undefined && outline !== undefined && Number(outline) < 6) heading = Number(outline) + 1;
    if (!runText(runs).trim() && heading === undefined) continue;
    const p: RichPara = { runs: tidyRuns(runs) };
    if (heading) p.heading = heading;
    if (styleId) p.style = styleId;
    if (scene) p.scene = scene;
    paras.push(p);
  }
  const comments: TextComment[] = [];
  for (const c of (commentsXml ?? '').matchAll(/<w:comment\b([^>]*)>([\s\S]*?)<\/w:comment>/g)) {
    const head = `<w:comment ${c[1]}>`;
    const id = attr(head, 'w:comment', 'w:id');
    if (id === undefined) continue;
    const text = [...c[2].matchAll(/<w:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:p>)/g)]
      .map((p) => [...(p[1] ?? '').matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((t) => decode(t[1])).join(''))
      .filter(Boolean).join('\n');
    comments.push({ id: `docx-comment-${id}`, author: attr(head, 'w:comment', 'w:author') ?? '', date: attr(head, 'w:comment', 'w:date'), text });
  }
  return { paras, comments };
}

/** Join neighbouring runs with the same formatting (Word splits runs for spell-check marks and edits). */
function tidyRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && !last.br && !r.br && !!last.bold === !!r.bold && !!last.italic === !!r.italic && (last.comments ?? []).join() === (r.comments ?? []).join() && !last.link && !r.link && JSON.stringify(last.rev) === JSON.stringify(r.rev)) last.text += r.text;
    else out.push({ ...r });
  }
  return out;
}

export async function readDocxRich(bytes: Uint8Array, opts: { revisions?: boolean } = {}): Promise<DocxContent> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error('This file is not a Word .docx document.');
  }
  const doc = await zip.file('word/document.xml')?.async('string');
  if (!doc) throw new Error('This .docx has no document text (word/document.xml is missing).');
  const styles = await zip.file('word/styles.xml')?.async('string');
  const comments = await zip.file('word/comments.xml')?.async('string');
  const core = await zip.file('docProps/core.xml')?.async('string');
  const title = core?.match(/<dc:title>([\s\S]*?)<\/dc:title>/)?.[1];
  const out = richFromXml(doc, styles, comments, opts);
  if (title?.trim()) out.title = decode(title.trim());
  return out;
}

/** The same paragraphs in the reader's plain form (ST-10), for passage anchors. */
export function plainParas(content: DocxContent): Paragraph[] {
  return content.paras.map((p) => (p.heading ? { text: runText(p.runs), heading: p.heading } : { text: runText(p.runs) }));
}

export interface ImportOptions {
  /** Headings of this level start a chapter; 0 = the whole file is one chapter. */
  chapterLevel: number;
  /** Paragraphs like "***" or "#" start a new scene (otherwise they stay as scene breaks in the text). */
  splitAtBreaks: boolean;
  /** Headings below the chapter level start a new scene, titled by the heading. */
  splitAtSubheadings: boolean;
  /** Title for the single chapter, or for text before the first chapter heading. */
  fallbackTitle: string;
}

export interface PlannedScene {
  title: string;
  blocks: Block[];
  /** For each block, the index of the Word paragraph it came from (-1 for breaks made up here). */
  source: number[];
}
export interface ImportPlan {
  chapters: { title: string; scenes: PlannedScene[] }[];
  /** Headings above the chapter level ("Part One"), which are not kept. */
  skipped: string[];
  words: number;
  scenes: number;
}

/** The heading level most likely to mark chapters: the highest level used more than once, else the highest used. */
export function guessChapterLevel(content: DocxContent): number {
  const counts = new Map<number, number>();
  for (const p of content.paras) if (p.heading && !FRONT_MATTER_STYLES.includes(p.style ?? '')) counts.set(p.heading, (counts.get(p.heading) ?? 0) + 1);
  const levels = [...counts.keys()].sort((a, b) => a - b);
  return levels.find((l) => counts.get(l)! > 1) ?? levels[0] ?? 0;
}

export function planImport(content: DocxContent, opts: ImportOptions): ImportPlan {
  const plan: ImportPlan = { chapters: [], skipped: [], words: 0, scenes: 0 };
  let chapter: ImportPlan['chapters'][number] | undefined;
  let scene: PlannedScene | undefined;
  const newChapter = (title: string) => { chapter = { title, scenes: [] }; plan.chapters.push(chapter); scene = undefined; };
  const newScene = (title?: string) => {
    if (!chapter) newChapter(opts.fallbackTitle);
    scene = { title: title ?? `Scene ${chapter!.scenes.length + 1}`, blocks: [], source: [] };
    chapter!.scenes.push(scene);
  };
  content.paras.forEach((p, i) => {
    if (FRONT_MATTER_STYLES.includes(p.style ?? '')) return;
    const text = runText(p.runs).trim();
    if (p.heading && opts.chapterLevel > 0) {
      if (p.heading === opts.chapterLevel) { newChapter(text || `Chapter ${plan.chapters.length + 1}`); return; }
      if (p.heading < opts.chapterLevel) { if (text) plan.skipped.push(text); return; }
      if (opts.splitAtSubheadings) {
        if (scene && !scene.blocks.length && /^Scene \d+$/.test(scene.title)) scene.title = text || scene.title;
        else newScene(text || undefined);
        return;
      }
    }
    if (isSceneBreakText(text)) {
      if (opts.splitAtBreaks) { if (scene?.blocks.length) scene = undefined; return; }
      if (!scene) newScene();
      scene!.blocks.push({ kind: 'break' });
      scene!.source.push(i);
      return;
    }
    if (!scene) newScene();
    const level = p.heading ? Math.min(3, Math.max(1, p.heading - Math.max(0, opts.chapterLevel))) : 0;
    scene!.blocks.push(level ? { kind: 'heading', level, runs: p.runs } : { kind: 'p', runs: p.runs });
    scene!.source.push(i);
    plan.words += countWords(text);
  });
  for (const c of plan.chapters) {
    c.scenes = c.scenes.filter((s) => s.blocks.length || c.scenes.length === 1);
    if (!c.scenes.length) c.scenes.push({ title: 'Scene 1', blocks: [], source: [] });
    // Drop scene breaks left at the start or end of a scene.
    for (const s of c.scenes) {
      while (s.blocks[0]?.kind === 'break') { s.blocks.shift(); s.source.shift(); }
      while (s.blocks[s.blocks.length - 1]?.kind === 'break') { s.blocks.pop(); s.source.pop(); }
    }
    plan.scenes += c.scenes.length;
  }
  return plan;
}

/** Put a link mark on characters [start, end) of a paragraph's runs. */
export function linkRuns(runs: Run[], start: number, end: number, link: NonNullable<Run['link']>): Run[] {
  const out: Run[] = [];
  let pos = 0;
  for (const r of runs) {
    const len = r.br ? 1 : r.text.length;
    const a = pos, b = pos + len;
    pos = b;
    if (r.br || b <= start || a >= end) { out.push(r); continue; }
    const s = Math.max(start, a) - a, e = Math.min(end, b) - a;
    if (s > 0) out.push({ ...r, text: r.text.slice(0, s) });
    out.push({ ...r, text: r.text.slice(s, e), link });
    if (e < len) out.push({ ...r, text: r.text.slice(e) });
  }
  return out;
}

/** WR-4: move a manuscript's passage links (ST-9) into the planned text as link marks. Returns how many moved and which were lost. */
export function moveLinks(plan: ImportPlan, paras: Paragraph[], links: ManuscriptLink[]): { moved: number; lost: ManuscriptLink[] } {
  const where = new Map<number, { scene: PlannedScene; block: number }>();
  for (const c of plan.chapters) for (const s of c.scenes) s.source.forEach((src, b) => src >= 0 && where.set(src, { scene: s, block: b }));
  let moved = 0;
  const lost: ManuscriptLink[] = [];
  for (const l of links) {
    const found = locate(paras, l.anchor);
    const at = found && where.get(found.paraIndex);
    const block = at && at.scene.blocks[at.block];
    if (!found || !block || block.kind === 'break') { lost.push(l); continue; }
    block.runs = linkRuns(block.runs, found.start, found.end, { kind: l.target.kind, id: l.target.id, note: l.note || undefined });
    moved++;
  }
  return { moved, lost };
}

/** Add the planned chapters and scenes to a book (a new one when bookId is absent). */
export function applyImport(
  world: World,
  plan: ImportPlan,
  content: DocxContent,
  target: { bookId?: Id; newBookTitle?: string },
  base: () => RecordBase,
): { world: World; bookId: Id; sceneIds: Id[] } {
  const books = [...world.books];
  let bookId = target.bookId;
  if (!bookId || !books.some((b) => b.id === bookId)) {
    const b: Book = { ...base(), title: target.newBookTitle || 'Imported book', order: books.length ? Math.max(...books.map((x) => x.order)) + 1 : 1, notes: '' };
    books.push(b);
    bookId = b.id;
  }
  const chapters: Chapter[] = [...world.chapters];
  const scenes: Scene[] = [...world.scenes];
  const texts: SceneText[] = [...world.sceneTexts];
  const sceneIds: Id[] = [];
  let order = Math.max(0, ...chapters.filter((c) => c.bookId === bookId).map((c) => c.order));
  const commentById = new Map(content.comments.map((c) => [c.id, c]));
  for (const pc of plan.chapters) {
    const ch: Chapter = { ...base(), bookId, title: pc.title, order: ++order, notes: '' };
    chapters.push(ch);
    pc.scenes.forEach((ps, i) => {
      const sc: Scene = { ...base(), chapterId: ch.id, title: ps.title, order: i + 1, characterIds: [], summary: '' };
      scenes.push(sc);
      sceneIds.push(sc.id);
      const doc = blocksToDoc(ps.blocks);
      const used = new Set(ps.blocks.flatMap((b) => (b.kind === 'break' ? [] : b.runs.flatMap((r) => r.comments ?? []))));
      const comments = [...used].map((id) => commentById.get(id)).filter((c): c is TextComment => !!c);
      texts.push({ ...base(), sceneId: sc.id, doc, words: docWords(doc), ...(comments.length ? { comments } : {}) });
    });
  }
  return { world: { ...world, books, chapters, scenes, sceneTexts: texts }, bookId, sceneIds };
}
