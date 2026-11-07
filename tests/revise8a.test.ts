import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  RevisionPass, World, applyEdits, buildDocx, carryMarks, checkWorld, decideScene, deleteRecord, docToBlocks, docToPlain, editDistance, findInWorld, findMentions, matchRanges,
  nameTypos, nameWordSet, passProgress, planReplace, plainToDoc, readDocxRich, renameFields, renamePairs, renameRecord, replaceRange, reviewDocx, richFromXml,
  claudeFolderFiles, dataModelGuide, sceneBookmark, styleHits, styleReport, toggleChapter, withTexts, docWords, blocksToDoc, outline,
} from '../src/core';
import { loadWorldFile, recordBase, worldToBytes } from '../src/storage';
import { sampleWorld } from '../src/ui/sample';

const W = () => sampleWorld();
const scene = (w: World, title: string) => w.scenes.find((s) => s.title === title)!;
const textOf = (w: World, title: string) => docToPlain(w.sceneTexts.find((t) => t.sceneId === scene(w, title).id)?.doc);
let n = 0;
const nid = () => `id-${++n}`;

describe('RV-3 find and replace', () => {
  it('matches whole words and case only when asked; apostrophes match either way', () => {
    expect(matchRanges('Kaela and kaela, Kaelas', 'Kaela')).toHaveLength(3);
    expect(matchRanges('Kaela and kaela, Kaelas', 'Kaela', { wholeWord: true })).toHaveLength(2);
    expect(matchRanges('Kaela and kaela, Kaelas', 'Kaela', { wholeWord: true, matchCase: true })).toEqual([[0, 5]]);
    expect(matchRanges('the regent’s face', "regent's")).toEqual([[4, 12]]);
  });
  it('replaces inside formatted runs and keeps the formatting of the first letter', () => {
    const runs = [{ text: 'a ' }, { text: 'bold', bold: true }, { text: ' word' }];
    expect(replaceRange(runs, 2, 6, 'BRAVE')).toEqual([{ text: 'a ' }, { text: 'BRAVE', bold: true }, { text: ' word' }]);
    expect(replaceRange(runs, 4, 8, 'x').map((r) => r.text).join('')).toBe('a boxord');
  });
  it('finds across the series in reading order and replaces only the chosen hits', () => {
    const w = W();
    const hits = findInWorld(w, 'Oren Hask', { wholeWord: true, matchCase: true }, { kind: 'series' });
    expect(hits.length).toBe(3);
    expect(hits[0].sceneId).toBe(scene(w, 'The regent’s errand').id);
    expect(hits[0].match).toBe('Oren Hask');
    const changes = planReplace(w, hits.slice(0, 1).map((h) => ({ ...h, text: 'Oren Hasker' })));
    const out = withTexts(w, changes, docWords, 'now');
    expect(textOf(out, 'The regent’s errand')).toContain('no one but Oren Hasker.');
    expect(textOf(out, 'The regent’s errand')).toContain('if Oren Hask is not');
    expect(changes[0].before).toBe(w.sceneTexts.find((t) => t.sceneId === hits[0].sceneId)!.doc);
  });
  it('limits the search to a scene, a chapter or a book', () => {
    const w = W();
    const s = scene(w, 'Riding south');
    expect(findInWorld(w, 'Kaela', {}, { kind: 'scene', sceneId: s.id }).every((h) => h.sceneId === s.id)).toBe(true);
    expect(findInWorld(w, 'Kaela', {}, { kind: 'chapter', chapterId: s.chapterId }).length).toBe(2);
    expect(findInWorld(w, 'Kaela', {}, { kind: 'book', bookId: w.books[0].id }).length).toBe(findInWorld(w, 'Kaela', {}, { kind: 'series' }).length);
  });
  it('keeps links and comments on text that is not replaced', () => {
    const doc = blocksToDoc([{ kind: 'p', runs: [{ text: 'Hello ', comments: ['c1'] }, { text: 'Varn', link: { kind: 'place', id: 'p1' } }, { text: ' road' }] }]);
    const out = applyEdits(doc, [{ block: 0, from: 11, to: 15, text: 'way' }]);
    const b = docToBlocks(out)[0] as { runs: { text: string; comments?: string[]; link?: unknown }[] };
    expect(b.runs.map((r) => r.text).join('')).toBe('Hello Varn way');
    expect(b.runs[0].comments).toEqual(['c1']);
    expect(b.runs[1].link).toEqual({ kind: 'place', id: 'p1' });
  });
});

describe('RV-1 rename everywhere', () => {
  it('pairs the full name and each changed word', () => {
    expect(renamePairs('Kaela Venn', 'Kayla Venn')).toEqual([{ from: 'Kaela Venn', to: 'Kayla Venn' }, { from: 'Kaela', to: 'Kayla', part: true }]);
    expect(renamePairs('Varn', 'Vharn')).toEqual([{ from: 'Varn', to: 'Vharn' }]);
  });
  it('finds full names and lone first names, never inside another record\'s name', () => {
    const w = W();
    const kaela = w.characters.find((c) => c.name === 'Kaela Venn')!;
    const m = findMentions(w, { kind: 'character', id: kaela.id }, 'Kayla Venn');
    const texts = m.filter((x) => x.where.kind === 'text');
    expect(texts.filter((x) => x.from === 'Kaela Venn')).toHaveLength(1);
    expect(texts.filter((x) => x.from === 'Kaela').length).toBeGreaterThanOrEqual(2);
    // Renaming the surname: "Venn" is shared with Aldric, Sera and Bram Venn, so it is left unticked.
    const sur = findMentions(w, { kind: 'character', id: kaela.id }, 'Kaela Hart');
    expect(sur.find((x) => x.from === 'Venn')?.shared ?? 'none').toBe('none');
    expect(sur.some((x) => x.from === 'Kaela Venn')).toBe(true);
  });
  it('renames the record, keeps the old name as an alias if asked, and changes titles and notes', () => {
    const w = W();
    const oren = w.characters.find((c) => c.name === 'Oren Hask')!;
    w.notes.push({ ...w.notes[0], id: 'n-x', title: 'About Oren', body: 'Oren Hask owes Mira.' });
    const mentions = findMentions(w, { kind: 'character', id: oren.id }, 'Oren Hale');
    const out0 = renameRecord(w, { kind: 'character', id: oren.id }, 'Oren Hale', true);
    const out = withTexts(renameFields(out0, mentions), planReplace(w, mentions.flatMap((x) => (x.where.kind === 'text' ? [{ ...x.where.hit, text: x.to }] : []))), docWords, 'now');
    const o = out.characters.find((c) => c.id === oren.id)!;
    expect(o.name).toBe('Oren Hale');
    expect(o.aliases).toEqual(['Oren Hask']);
    expect(textOf(out, 'Carts at the gate')).toContain('Oren Hale counted carts');
    expect(out.notes.find((x) => x.id === 'n-x')!.body).toBe('Oren Hale owes Mira.');
  });
});

describe('RV-2 name typos', () => {
  it('measures edit distance with swaps', () => {
    expect(editDistance('kaela', 'kayla')).toBe(1);
    expect(editDistance('kaela', 'kalea')).toBe(1);
    expect(editDistance('thornwick', 'thornwik', 2)).toBe(1);
    expect(editDistance('oren', 'mira', 1)).toBeGreaterThan(1);
  });
  it('flags a near-miss of a name, not names, not common words, not words also used in lower case', () => {
    const w = W();
    const t = w.sceneTexts.find((x) => x.sceneId === scene(w, 'Salt on the wind').id)!;
    t.doc = plainToDoc('Kayla came. Oren waited. Open the gate. Mira saw Thornwik. Ashfrod? Never. Bram rode on; bran was cheap. Bran.');
    const typos = nameTypos(w);
    const words = typos.map((x) => x.word);
    expect(words).toContain('Kayla');
    expect(words).toContain('Thornwik');
    expect(words).toContain('Ashfrod');
    expect(words).not.toContain('Open');
    expect(words).not.toContain('Oren');
    expect(words).not.toContain('Bran');
    expect(typos.find((x) => x.word === 'Kayla')!.name).toBe('Kaela Venn');
    const warn = checkWorld(w).filter((x) => x.rule === 'name-typo');
    expect(warn.map((x) => x.key)).toContain('name-typo:Kayla');
    expect(warn[0].refs[0]).toEqual({ kind: 'scene', id: t.sceneId });
  });
});

describe('RV-4 style checks', () => {
  it('marks close repeats, long sentences, adverbs and filter words; rules can be switched off', () => {
    const long = Array.from({ length: 45 }, (_, i) => `w${i}`).join(' ') + '.';
    const texts = ['The lantern swung. She quickly saw the lantern again.', long, 'A family of five.'];
    const hits = styleHits(texts);
    expect(hits.filter((h) => h.rule === 'repeat').map((h) => texts[h.block].slice(h.from, h.to))).toEqual(['lantern']);
    expect(hits.filter((h) => h.rule === 'adverb').map((h) => texts[h.block].slice(h.from, h.to))).toEqual(['quickly']);
    expect(hits.filter((h) => h.rule === 'filter').map((h) => texts[h.block].slice(h.from, h.to))).toEqual(['saw']);
    expect(hits.filter((h) => h.rule === 'long-sentence')).toHaveLength(1);
    expect(styleHits(texts, new Set(['repeat', 'adverb']))).toHaveLength(2);
    expect(styleHits(['Kaela ran. Kaela hid.'], new Set(), new Set(['Kaela']))).toHaveLength(0);
  });
  it('reports per chapter and finds overused crutch words in a book', () => {
    const w = W();
    const t = w.sceneTexts.find((x) => x.sceneId === scene(w, 'Salt on the wind').id)!;
    t.doc = plainToDoc('She just nodded. He just nodded. They just nodded. We just stood. Just so.');
    const r = styleReport(w, w.books[0].id, new Set(), nameWordSet(w));
    expect(r.chapters.map((c) => c.title)).toEqual(outline(w)[0].chapters.map((c) => c.chapter.title));
    expect(r.overused.map((o) => o.word)).toEqual(expect.arrayContaining(['just', 'nodded']));
    expect(styleReport(w, w.books[0].id, new Set(['overused'])).overused).toEqual([]);
    expect(styleHits(['She just left.'], new Set(), new Set(), new Set(['just'])).map((h) => h.rule)).toEqual(['overused']);
  });
});

describe('RV-5 revision passes', () => {
  it('ticks chapters off, counts progress, and goes with its book; deleted chapters leave the checklist', () => {
    const w = W();
    const book = w.books[0];
    const chs = outline(w)[0].chapters.map((c) => c.chapter.id);
    let p: RevisionPass = { ...recordBase(), bookId: book.id, name: 'Dialogue', note: '', done: [], order: 1 };
    p = toggleChapter(toggleChapter(p, chs[0]), chs[1]);
    w.passes = [p];
    expect(passProgress(w, w.passes[0])).toEqual({ done: 2, total: chs.length });
    expect(toggleChapter(p, chs[0]).done).toEqual([chs[1]]);
    const noCh = deleteRecord(w, 'chapters', chs[0], { kind: 'remove' });
    expect(noCh.passes[0].done).toEqual([chs[1]]);
    expect(deleteRecord(w, 'books', book.id, { kind: 'remove' }).passes).toEqual([]);
  });
  it('Claude sees the passes in story/revision.md and can propose them (AI-10)', () => {
    const w = W();
    const f = claudeFolderFiles(w, []).find((x) => x.path === 'story/revision.md')!;
    expect(f.text).toContain('### Dialogue');
    expect(f.text).toMatch(/- \[x\] Chapter 1/);
    expect(dataModelGuide()).toContain('Revision passes (RV-5)');
  });
  it('is saved in the world file', async () => {
    const w = W();
    w.passes.push({ ...recordBase(), bookId: w.books[0].id, name: 'Dialogue', note: '', done: [], order: 1 });
    const { world: back } = await loadWorldFile(await worldToBytes(w));
    expect(back.passes).toEqual(w.passes);
  });
});

/** Make an edited copy of an exported file: a tracked change and a comment inside a scene. */
async function editDocx(bytes: Uint8Array, find: string, replace: string, comment?: string): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  let xml = await zip.file('word/document.xml')!.async('string');
  const i = xml.indexOf(find);
  expect(i).toBeGreaterThan(0);
  // Split the run that holds the words: close it before, add <w:del> + <w:ins>, reopen it after.
  const runStart = xml.lastIndexOf('<w:r>', i);
  const tStart = xml.indexOf('>', xml.indexOf('<w:t', runStart)) + 1;
  const tEnd = xml.indexOf('</w:t>', i);
  const text = xml.slice(tStart, tEnd);
  const at = text.indexOf(find);
  const before = text.slice(0, at), after = text.slice(at + find.length);
  const r = (s: string) => `<w:r><w:t xml:space="preserve">${s}</w:t></w:r>`;
  const change = `${r(before)}${comment ? '<w:commentRangeStart w:id="0"/>' : ''}<w:del w:id="91" w:author="Ed Itor" w:date="2026-11-01T00:00:00Z"><w:r><w:delText>${find}</w:delText></w:r></w:del><w:ins w:id="92" w:author="Ed Itor" w:date="2026-11-01T00:00:00Z">${r(replace)}</w:ins>${comment ? '<w:commentRangeEnd w:id="0"/>' : ''}${r(after)}`;
  const runEnd = xml.indexOf('</w:r>', tEnd) + 6;
  xml = xml.slice(0, runStart) + change + xml.slice(runEnd);
  zip.file('word/document.xml', xml);
  if (comment) zip.file('word/comments.xml', `<?xml version="1.0"?><w:comments xmlns:w="w"><w:comment w:id="0" w:author="Ed Itor" w:date="2026-11-01T00:00:00Z"><w:p><w:r><w:t>${comment}</w:t></w:r></w:p></w:comment></w:comments>`);
  return zip.generateAsync({ type: 'uint8array' });
}

describe('RV-6 editor round trip', () => {
  it('the export puts a bookmark around each scene', async () => {
    const w = W();
    const zip = await JSZip.loadAsync(await buildDocx(w, { bookId: w.books[0].id, style: 'manuscript' }));
    const xml = await zip.file('word/document.xml')!.async('string');
    for (const s of w.scenes.filter((x) => w.sceneTexts.some((t) => t.sceneId === x.id && docWords(t.doc)))) expect(xml).toContain(`w:name="${sceneBookmark(s.id)}"`);
    expect(sceneBookmark('01906ccb-2fdd-4c6c-b3b6-cf0826d30a2e')).toBe('swt_01906ccb2fdd4c6cb3b6cf0826d30a2e');
  });
  it('a plain re-import ignores deleted text and keeps inserted text', async () => {
    const w = W();
    const edited = await editDocx(await buildDocx(w, { bookId: w.books[0].id, style: 'manuscript' }), 'river mist', 'morning fog');
    const plain = await readDocxRich(edited);
    const all = plain.paras.map((p) => p.runs.map((r) => r.text).join('')).join('\n');
    expect(all).toContain('through the morning fog');
    expect(all).not.toContain('river mist');
  });
  it('reads tracked changes and comments scene by scene, and only changed scenes differ', async () => {
    const w = W();
    const edited = await editDocx(await buildDocx(w, { bookId: w.books[0].id, style: 'reading' }), 'river mist', 'morning fog', 'Mist again?');
    const r = reviewDocx(w, await readDocxRich(edited, { revisions: true }));
    expect(r.matchedBy).toBe('bookmarks');
    expect(r.bookId).toBe(w.books[0].id);
    const changed = r.scenes.filter((s) => s.changed);
    expect(changed.map((s) => s.title)).toEqual(['Riding south']);
    expect(changed[0].insertions).toBe(1);
    expect(changed[0].deletions).toBe(1);
    expect(changed[0].authors).toEqual(['Ed Itor']);
    expect(changed[0].comments.map((c) => c.text)).toEqual(['Mist again?']);
    expect(changed[0].marked.some((b) => b.kind !== 'break' && b.runs.some((x) => x.rev?.kind === 'del' && x.text === 'river mist'))).toBe(true);
  });
  it('accept takes the editor\'s text and brings the comment; links and old comments stay on their words', async () => {
    const w = W();
    const s = scene(w, 'Riding south');
    const t = w.sceneTexts.find((x) => x.sceneId === s.id)!;
    // A link on "Varn" and a margin comment on "milestones" in the app's text.
    let blocks = docToBlocks(t.doc);
    const b0 = blocks[0] as { kind: 'p'; runs: { text: string; link?: unknown; comments?: string[] }[] };
    const i0 = b0.runs.map((x) => x.text).join('').indexOf('Varn');
    blocks = [{ ...b0, runs: [{ text: b0.runs.map((x) => x.text).join('').slice(0, i0) }, { text: 'Varn', link: { kind: 'place', id: 'varn' } }, { text: b0.runs.map((x) => x.text).join('').slice(i0 + 4) }] } as never, ...blocks.slice(1)];
    t.doc = blocksToDoc(blocks);
    const edited = await editDocx(await buildDocx(w, { bookId: w.books[0].id, style: 'reading' }), 'river mist', 'morning fog', 'Mist again?');
    const rv = reviewDocx(w, await readDocxRich(edited, { revisions: true })).scenes.find((x) => x.sceneId === s.id)!;
    const out = decideScene(rv, t.doc, [], 'accept', true, nid);
    expect(docToPlain(out.doc)).toContain('through the morning fog');
    const runs = docToBlocks(out.doc).flatMap((b) => (b.kind === 'break' ? [] : b.runs));
    expect(runs.find((x) => x.link)?.text).toBe('Varn');
    expect(out.comments).toHaveLength(1);
    expect(runs.find((x) => x.comments?.includes(out.comments[0].id))?.text).toBe('morning fog');
    // Reject: the app's text stays, and the comment finds no words ("morning fog" is not there) so it is unanchored.
    const rej = decideScene(rv, t.doc, [], 'reject', true, nid);
    expect(docToPlain(rej.doc)).toContain('river mist');
    expect(rej.comments).toHaveLength(1);
    expect(docToPlain(rej.editorDoc)).toContain('morning fog');
    const none = decideScene(rv, t.doc, [], 'both', false, nid);
    expect(none.doc).toBe(t.doc);
    expect(none.comments).toEqual([]);
  });
  it('an older export without bookmarks is matched by chapter titles and scene separators', () => {
    const w = W();
    const tree = outline(w)[0];
    const xml = ['<w:body>'];
    const p = (s: string, style?: string) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t>${s}</w:t></w:r></w:p>`;
    for (const c of tree.chapters) {
      xml.push(p(c.chapter.title, 'Heading1'));
      c.scenes.forEach((s, i) => { if (i) xml.push(p('#', 'SwtSceneSep')); xml.push(p(`Text of ${s.title}`)); });
    }
    xml.push('</w:body>');
    const r = reviewDocx(w, richFromXml(xml.join('')));
    expect(r.matchedBy).toBe('chapters');
    expect(r.unplaced).toEqual([]);
    expect(r.scenes.map((s) => docToPlain(blocksToDoc(s.theirs)))).toEqual(tree.chapters.flatMap((c) => c.scenes.map((s) => `Text of ${s.title}`)));
  });
  it('carryMarks reports comments whose words are gone', () => {
    const old = blocksToDoc([{ kind: 'p', runs: [{ text: 'gone words', comments: ['c9'] }, { text: ' stay' }] }]);
    const r = carryMarks(old, [{ kind: 'p', runs: [{ text: 'new stay' }] }]);
    expect(r.lost).toEqual(['c9']);
  });
});
