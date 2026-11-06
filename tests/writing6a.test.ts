import { describe, expect, it } from 'vitest';
import {
  Block, CANON, ManuscriptLink, Paragraph, SceneVersion, addVersion, applyImport, applyScenarioEdit, backlinksFor, blocksToDoc, buildDocx, countWords, deleteRecord,
  diffParagraphs, diffWords, docToBlocks, docToPlain, docWords, globalSearch, guessChapterLevel, isSceneBreakText, makeAnchor, makeVersion, moveLinks, nameRanges,
  planImport, plainParas, plainToDoc, readDocxRich, richFromXml, safeName, safetyCopyFiles, scenarioView, thinVersions, unpackDoc, worldWords,
} from '../src/core';
import { loadWorldFile, worldToBytes } from '../src/storage';
import { world } from './fixtures';

const base = { scenarioId: CANON, status: 'canon' as const, createdAt: '', updatedAt: '' };
let n = 0;
const rb = () => ({ ...base, id: `id${++n}` });

/** A book with two chapters: chapter 1 has two scenes (one with a scene break inside), chapter 2 one. */
function written() {
  const w = world();
  w.books = [{ ...base, id: 'b1', title: 'The Salt Roads', order: 1, notes: '' }];
  w.chapters = [
    { ...base, id: 'c1', bookId: 'b1', title: 'The Sealed Letter', order: 1, notes: '' },
    { ...base, id: 'c2', bookId: 'b1', title: 'Market: Days?', order: 2, notes: '' },
  ];
  w.scenes = [
    { ...base, id: 's1', chapterId: 'c1', title: 'Errand', order: 1, characterIds: [], summary: '' },
    { ...base, id: 's2', chapterId: 'c1', title: 'Riding south', order: 2, characterIds: [], summary: '' },
    { ...base, id: 's3', chapterId: 'c2', title: 'Carts', order: 1, characterIds: [], summary: '' },
  ];
  const text = (id: string, sceneId: string, blocks: Block[]) => { const doc = blocksToDoc(blocks); return { ...base, id, sceneId, doc, words: docWords(doc) }; };
  w.sceneTexts = [
    text('t1', 's1', [
      { kind: 'p', runs: [{ text: 'Kaela read ' }, { text: 'faces', italic: true }, { text: ' by lamplight.' }] },
      { kind: 'p', runs: [{ text: 'Bold', bold: true }, { text: ' and plain.' }] },
    ]),
    text('t2', 's2', [
      { kind: 'p', runs: [{ text: 'She left Varn on the twenty-eighth.' }] },
      { kind: 'break' },
      { kind: 'p', runs: [{ text: 'Thornwick at dusk.' }] },
    ]),
    text('t3', 's3', [{ kind: 'p', runs: [{ text: 'Oren counted carts at Thornwick.', link: { kind: 'place', id: 'thornwick' } }] }]),
  ];
  return w;
}

describe('WR-1 scene text', () => {
  it('turns blocks into a ProseMirror document and back', () => {
    const blocks: Block[] = [
      { kind: 'heading', level: 2, runs: [{ text: 'Night' }] },
      { kind: 'p', runs: [{ text: 'One ' }, { text: 'two', italic: true, bold: true }, { text: '', br: true }, { text: 'three' }] },
      { kind: 'break' },
    ];
    const doc = blocksToDoc(blocks);
    expect(doc.type).toBe('doc');
    expect(doc.content!.map((n) => n.type)).toEqual(['heading', 'paragraph', 'scene_break']);
    expect(docToBlocks(doc)).toEqual(blocks);
    expect(docToPlain(doc)).toBe('Night\nOne two\nthree\n* * *');
  });

  it('counts words as writers do', () => {
    expect(countWords("Don't stop — well-known roads, 1042!")).toBe(5);
    expect(countWords('  ')).toBe(0);
    expect(docWords(plainToDoc('One two.\n\n***\n\nThree'))).toBe(3);
  });

  it('recognises scene-break marks', () => {
    for (const t of ['***', '* * *', '#', '~ ~ ~', '---', '§']) expect(isSceneBreakText(t)).toBe(true);
    for (const t of ['A', '**bold**', '# Heading', '1. One']) expect(isSceneBreakText(t)).toBe(false);
  });

  it('is stored in the world file with its versions', async () => {
    const w = written();
    const v = await makeVersion('s1', w.sceneTexts[0].doc, 'Kept by hand', true);
    w.sceneVersions = [v];
    const back = await loadWorldFile(await worldToBytes(w));
    expect(back.world.sceneTexts).toEqual(w.sceneTexts);
    expect(back.world.sceneVersions).toEqual([v]);
    expect(await unpackDoc(back.world.sceneVersions[0].data)).toEqual(w.sceneTexts[0].doc);
  });

  it('can differ in a what-if scenario without touching canon', () => {
    const w = written();
    w.scenarios = [{ ...base, id: 'sc', name: 'North', description: '', hidden: [] }];
    const before = scenarioView(w, 'sc');
    const after = { ...before, sceneTexts: before.sceneTexts.map((t) => (t.sceneId === 's2' ? { ...t, doc: plainToDoc('She went north instead.') } : t)) };
    const stored = applyScenarioEdit(w, 'sc', before, after);
    expect(docToPlain(scenarioView(stored, 'sc').sceneTexts.find((t) => t.sceneId === 's2')!.doc)).toBe('She went north instead.');
    expect(docToPlain(scenarioView(stored, CANON).sceneTexts.find((t) => t.sceneId === 's2')!.doc)).toContain('Varn');
  });

  it('goes with its scene when the scene is deleted', () => {
    const w = deleteRecord(written(), 'scenes', 's2', { kind: 'remove' });
    expect(w.sceneTexts.map((t) => t.sceneId)).toEqual(['s1', 's3']);
  });

  it('is found by search and its links show as backlinks', () => {
    const w = written();
    const hits = globalSearch(w, 'twenty-eighth');
    expect(hits.some((h) => h.kind === 'scene' && h.id === 's2' && h.inText)).toBe(true);
    const back = backlinksFor(w, 'place', 'thornwick');
    expect(back.find((b) => b.kind === 'text')).toMatchObject({ id: 's3', label: '“Oren counted carts at Thornwick.”' });
  });
});

describe('WR-6 scene history', () => {
  it('compares paragraphs and words', () => {
    const rows = diffParagraphs(['Same here.', 'The old grey horse.', 'Gone.'], ['Same here.', 'The young grey horse.', 'New.']);
    expect(rows[0]).toMatchObject({ changed: false });
    const words = diffWords('The old grey horse.', 'The young grey horse.');
    expect(words).toEqual([{ op: 'eq', text: 'The ' }, { op: 'del', text: 'old' }, { op: 'ins', text: 'young' }, { op: 'eq', text: ' grey horse.' }]);
    expect(rows.filter((r) => r.changed).length).toBe(2);
  });

  it('thins out old automatic versions but keeps pinned ones', () => {
    const now = Date.parse('2026-11-06T12:00:00Z');
    const mk = (hoursAgo: number, pinned = false): SceneVersion => ({ id: `v${hoursAgo}`, sceneId: 's', at: new Date(now - hoursAgo * 3600e3).toISOString(), label: '', pinned, words: 0, data: '' });
    const list = [mk(1), mk(2), mk(30), mk(31), mk(32), mk(24 * 60), mk(24 * 61), mk(24 * 400, true)];
    const kept = thinVersions(list, now).map((v) => v.id);
    expect(kept).toContain('v1');
    expect(kept).toContain('v2');
    expect(kept).toContain(`v${24 * 400}`);
    // 30-32 hours ago: one per day
    expect(kept.filter((id) => ['v30', 'v31', 'v32'].includes(id)).length).toBeLessThanOrEqual(2);
    const w = addVersion({ ...world(), sceneVersions: list }, mk(0), now);
    expect(w.sceneVersions.length).toBe(kept.length + 1);
  });
});

describe('WR-4, WR-5 Word import and export', () => {
  it('exports a manuscript that imports back to the same chapters, scenes and formatting', async () => {
    const w = written();
    w.settings.writing = { authorName: 'Ojon Example', contact: 'ojon@example.com' };
    const bytes = await buildDocx(w, { bookId: 'b1', style: 'manuscript' });
    const content = await readDocxRich(bytes);
    expect(guessChapterLevel(content)).toBe(1);
    const plan = planImport(content, { chapterLevel: 1, splitAtBreaks: true, splitAtSubheadings: false, fallbackTitle: 'Opening' });
    expect(plan.chapters.map((c) => c.title)).toEqual(['The Sealed Letter', 'Market: Days?']);
    // The break inside "Riding south" splits it too: 4 scenes in chapter 1 + 1 in chapter 2.
    expect(plan.chapters.map((c) => c.scenes.length)).toEqual([3, 1]);
    const first = plan.chapters[0].scenes[0].blocks[0];
    expect(first).toEqual({ kind: 'p', runs: [{ text: 'Kaela read ' }, { text: 'faces', italic: true, bold: false }, { text: ' by lamplight.' }].map((r) => ({ bold: false, italic: false, ...r })) });
    expect(plan.words).toBe(w.sceneTexts.reduce((s, t) => s + t.words, 0));
    // Without splitting at breaks, the breaks stay in the text.
    const kept = planImport(content, { chapterLevel: 1, splitAtBreaks: false, splitAtSubheadings: false, fallbackTitle: 'Opening' });
    expect(kept.chapters[0].scenes.length).toBe(1);
    expect(kept.chapters[0].scenes[0].blocks.filter((b) => b.kind === 'break').length).toBe(2);
  });

  it('exports a reading copy and a range of chapters', async () => {
    const content = await readDocxRich(await buildDocx(written(), { bookId: 'b1', style: 'reading', fromChapter: 1, toChapter: 1 }));
    const plan = planImport(content, { chapterLevel: 1, splitAtBreaks: true, splitAtSubheadings: false, fallbackTitle: 'Opening' });
    expect(plan.chapters.map((c) => c.title)).toEqual(['Market: Days?']);
  });

  it('reads comments, bold turned off, and higher headings', () => {
    const doc = `<w:document><w:body>
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Part One</w:t></w:r></w:p>
      <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Chapter 1</w:t></w:r></w:p>
      <w:p><w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>Not bold, </w:t></w:r><w:commentRangeStart w:id="7"/><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r><w:commentRangeEnd w:id="7"/></w:p>
      <w:p><w:r><w:t>* * *</w:t></w:r></w:p>
      <w:p><w:r><w:t>Next scene.</w:t></w:r></w:p>
      <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Chapter 2</w:t></w:r></w:p>
      <w:p><w:r><w:t>Two.</w:t></w:r></w:p>
    </w:body></w:document>`;
    const comments = `<w:comments><w:comment w:id="7" w:author="Ed" w:date="2026-11-01T10:00:00Z"><w:p><w:r><w:t>Stronger verb?</w:t></w:r></w:p></w:comment></w:comments>`;
    const content = richFromXml(doc, undefined, comments);
    expect(content.comments).toEqual([{ id: 'docx-comment-7', author: 'Ed', date: '2026-11-01T10:00:00Z', text: 'Stronger verb?' }]);
    expect(guessChapterLevel(content)).toBe(2);
    const plan = planImport(content, { chapterLevel: 2, splitAtBreaks: true, splitAtSubheadings: false, fallbackTitle: 'Opening' });
    expect(plan.skipped).toEqual(['Part One']);
    expect(plan.chapters.map((c) => [c.title, c.scenes.length])).toEqual([['Chapter 1', 2], ['Chapter 2', 1]]);
    const runs = (plan.chapters[0].scenes[0].blocks[0] as { runs: { text: string; bold?: boolean; comments?: string[] }[] }).runs;
    expect(runs).toMatchObject([{ text: 'Not bold, ', bold: false }, { text: 'bold', bold: true, comments: ['docx-comment-7'] }]);
    const w = world();
    const r = applyImport(w, plan, content, { newBookTitle: 'Imported' }, rb);
    expect(r.world.books.map((b) => b.title)).toEqual(['Imported']);
    expect(r.world.chapters.length).toBe(2);
    expect(r.world.scenes.length).toBe(3);
    expect(r.world.sceneTexts.find((t) => t.sceneId === r.sceneIds[0])!.comments).toEqual(content.comments);
    expect(r.world.sceneTexts.find((t) => t.sceneId === r.sceneIds[1])!.comments).toBeUndefined();
  });

  it('moves passage links with their text', () => {
    const doc = `<w:document><w:body>
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>One</w:t></w:r></w:p>
      <w:p><w:r><w:t xml:space="preserve">The lamps in the </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>Hall of Lamps</w:t></w:r><w:r><w:t xml:space="preserve"> never went out.</w:t></w:r></w:p>
    </w:body></w:document>`;
    const content = richFromXml(doc);
    const paras: Paragraph[] = plainParas(content);
    const k = paras[1].text.indexOf('Hall of Lamps');
    const link: ManuscriptLink = { ...base, id: 'l1', manuscriptId: 'm', anchor: makeAnchor(paras, 1, k, k + 13), target: { kind: 'place', id: 'hall' }, note: 'the hall', state: 'ok' };
    const plan = planImport(content, { chapterLevel: 1, splitAtBreaks: true, splitAtSubheadings: false, fallbackTitle: 'Opening' });
    const r = moveLinks(plan, paras, [link]);
    expect(r).toEqual({ moved: 1, lost: [] });
    const runs = (plan.chapters[0].scenes[0].blocks[0] as { runs: unknown[] }).runs;
    expect(runs).toMatchObject([{ text: 'The lamps in the ' }, { text: 'Hall of Lamps', italic: true, link: { kind: 'place', id: 'hall', note: 'the hall' } }, { text: ' never went out.' }]);
  });
});

describe('WR-7 safety copies', () => {
  it('writes every scene as text, foldered by book and chapter, with names Windows accepts', () => {
    const files = safetyCopyFiles(written());
    expect(files.map((f) => f.path.join('/'))).toEqual([
      '01 The Salt Roads/01 The Sealed Letter/01 Errand.txt',
      '01 The Salt Roads/01 The Sealed Letter/02 Riding south.txt',
      '01 The Salt Roads/02 Market Days/01 Carts.txt',
      'READ ME.txt',
    ]);
    expect(files[1].text).toBe('Riding south\r\n\r\nShe left Varn on the twenty-eighth.\r\n\r\n* * *\r\n\r\nThornwick at dusk.\r\n');
    expect(safeName('CON')).toBe('_CON');
    expect(safeName('a/b: c?. ')).toBe('a b c');
  });
});

describe('WR-8 world words', () => {
  it('keeps names and aliases out of the spell checker', () => {
    const w = world();
    w.characters[0].aliases = ['the Courier'];
    const words = worldWords(w);
    expect(words.has('Kaela')).toBe(true);
    expect(words.has('Thornwick')).toBe(true);
    expect(words.has('Courier')).toBe(true);
    const text = 'Kaela’s horse reached Thornwick.';
    expect(nameRanges(text, words).map(([a, b]) => text.slice(a, b))).toEqual(['Kaela', 'Thornwick']);
  });
});
