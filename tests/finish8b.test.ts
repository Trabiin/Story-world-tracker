import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  World, blocksToDoc, buildEpub, buildPdf, buildPubDocx, chapterBefore, daysWaiting, dialogueCounts, dialogueLines, docToBlocks, outline, pdfString,
  quoteAt, quoteSpans, readingCopy, recap, roughMeasure, seriesBible, sortedSubmissions, submissionSummary, untaggedQuotes,
} from '../src/core';
import { loadWorldFile, worldToBytes } from '../src/storage';
import { sampleWorld } from '../src/ui/sample';

const W = () => sampleWorld();
const books = (w: World) => outline(w).map((b) => b.book);
const who = (w: World, name: string) => w.characters.find((c) => c.name === name)!.id;
const ascii = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('');

describe('RV-7 dialogue by character', () => {
  it('keeps the speaker mark through the stored form', () => {
    const doc = blocksToDoc([{ kind: 'p', runs: [{ text: 'She said ' }, { text: '“Go.”', speaker: 'c1' }] }]);
    expect(docToBlocks(doc)).toEqual([{ kind: 'p', runs: [{ text: 'She said ' }, { text: '“Go.”', speaker: 'c1' }] }]);
  });
  it('lists tagged lines in reading order, joining runs across a link', () => {
    const w = W();
    const lines = dialogueLines(w);
    expect(lines.map((l) => [w.characters.find((c) => c.id === l.characterId)!.name, l.text])).toEqual([
      ['Kaela Venn', '“And if Oren Hask is not there?”'],
      ['Mira Solt', '“You’ll have a visitor,”'],
      ['Mira Solt', '“From Varn. She rides like she owes someone money.”'],
      ['Oren Hask', '“A courier from the Kingdom of Varn? Then the regent is frightened.”'],
    ]);
    expect(dialogueLines(w, { characterId: who(w, 'Mira Solt') })).toHaveLength(2);
    const counts = dialogueCounts(lines);
    expect(counts[0]).toMatchObject({ characterId: who(w, 'Mira Solt'), lines: 2, words: 13, scenes: 1 });
    expect(counts.find((c) => c.characterId === who(w, 'Oren Hask'))).toMatchObject({ lines: 1, words: 12 });
  });
  it('finds quotes, not apostrophes', () => {
    expect(quoteSpans('He said “go” and ‘don’t’ and it’s fine.')).toEqual([[8, 12], [17, 24]]);
    expect(quoteSpans('"Straight," she said, "quotes."')).toEqual([[0, 11], [22, 31]]);
    expect(quoteSpans('“Unclosed, going on')).toEqual([[0, 19]]);
    expect(quoteAt('a “bc” d', 3)).toEqual([2, 6]);
    expect(quoteAt('a “bc” d', 7)).toBeUndefined();
  });
  it('counts untagged quotes', () => {
    const w = W();
    expect(untaggedQuotes(w)).toBeGreaterThan(0);
    expect(untaggedQuotes(w, books(w)[1].id)).toBe(0);
  });
});

describe('RV-8 reading copies', () => {
  it('builds a book: chapters as level-1 headings, scenes parted by breaks, only reader formatting', () => {
    const w = W();
    const d = readingCopy(w, books(w)[0].id);
    expect(d.title).toBe('The Salt Roads');
    expect(d.blocks.filter((b) => b.kind === 'heading').map((b) => b.kind === 'heading' && b.text)).toEqual(['Chapter 1: The Sealed Letter', 'Chapter 2: Market Days', 'Chapter 3: Two Roads']);
    expect(d.blocks[1]).toMatchObject({ kind: 'p', first: true });
    expect(d.blocks.some((b) => b.kind === 'break')).toBe(true);
    for (const b of d.blocks) if (b.kind === 'p') for (const r of b.runs) expect(Object.keys(r).every((k) => ['text', 'bold', 'italic', 'br'].includes(k))).toBe(true);
    expect(d.blocks.some((b) => b.kind === 'p' && b.runs.some((r) => r.italic && r.text === 'heavier'))).toBe(true);
  });
  it('writes a valid PDF: header, objects at the offsets the xref gives, a title page and page numbers', () => {
    const w = W();
    const bytes = buildPdf(readingCopy(w, books(w)[0].id), { page: 'trade', measure: roughMeasure });
    const s = ascii(bytes);
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
    const xref = Number(/startxref\n(\d+)/.exec(s)![1]);
    expect(s.slice(xref, xref + 4)).toBe('xref');
    const offsets = [...s.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    offsets.forEach((o, i) => expect(s.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    const pages = Number(/\/Count (\d+)/.exec(s)![1]);
    expect(pages).toBeGreaterThanOrEqual(4); // title page + three chapters
    expect(s).toContain('(The Salt Roads) Tj');
    expect(s).toContain('/BaseFont /Times-Italic');
    // Content streams declare their true length.
    for (const m of s.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) expect(s.slice(m.index! + m[0].length + Number(m[1]), m.index! + m[0].length + Number(m[1]) + 10)).toBe('\nendstream');
  });
  it('sets curly quotes and dashes in Windows-1252 and escapes brackets', () => {
    expect(pdfString('“Hi” — (a)\\')).toBe(`(${String.fromCharCode(0x93)}Hi${String.fromCharCode(0x94)} ${String.fromCharCode(0x97)} \\(a\\)\\\\)`);
    expect(pdfString('漢')).toBe('(?)');
  });
  it('writes an ePub with the mimetype first and stored, a nav and a file per chapter', async () => {
    const w = W();
    const bytes = await buildEpub(readingCopy(w, books(w)[0].id), { id: '00000000-0000-0000-0000-000000000001', modified: '2026-11-12T10:00:00.000Z' });
    expect(ascii(bytes.slice(30, 38))).toBe('mimetype');
    expect(ascii(bytes.slice(38, 58))).toBe('application/epub+zip');
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files)).toEqual(expect.arrayContaining(['META-INF/container.xml', 'OEBPS/content.opf', 'OEBPS/nav.xhtml', 'OEBPS/toc.ncx', 'OEBPS/part3.xhtml']));
    const opf = await zip.file('OEBPS/content.opf')!.async('string');
    expect(opf).toContain('<meta property="dcterms:modified">2026-11-12T10:00:00Z</meta>');
    const p1 = await zip.file('OEBPS/part1.xhtml')!.async('string');
    expect(p1).toContain('<em>heavier</em>');
    expect(p1).toContain('<p class="first">');
  });
});

describe('SR-2 "Previously on…"', () => {
  it('has nothing before the first book', () => {
    const w = W();
    expect(chapterBefore(w, books(w)[0].id)).toBe(-1);
    expect(recap(w, books(w)[0].id)).toBeUndefined();
  });
  it('before book two: the story so far from summaries, who is who, and what the reader knows', () => {
    const w = W();
    const r = recap(w, books(w)[1].id)!;
    expect(r.subtitle).toBe('Before The Glass Mere');
    const heads = r.blocks.filter((b) => b.kind === 'heading').map((b) => b.kind === 'heading' && b.text);
    expect(heads.slice(0, 3)).toEqual(['The story so far', 'The Salt Roads', 'Chapter 1: The Sealed Letter']);
    expect(heads).toContain("Who's who");
    const text = r.blocks.map((b) => (b.kind === 'p' ? b.runs.map((x) => x.text).join('') : '')).join('\n');
    expect(text).toContain('Kaela is handed the sealed letter in the Hall of Lamps.');
    expect(text).toContain('Kaela Venn');
    // Book two's own outline is not in it.
    expect(text).not.toContain('crosses the mere');
  });
});

describe('EU-16 series bible', () => {
  it("the author's copy has everyone; through book one only what the reader knows", () => {
    const w = W();
    const full = seriesBible(w);
    const names = (d: typeof full) => d.blocks.filter((b) => b.kind === 'heading' && b.level === 2).map((b) => b.kind === 'heading' && b.text);
    expect(names(full)).toContain('Aldric Venn');
    expect(full.blocks.filter((b) => b.kind === 'heading' && b.level === 1).map((b) => b.kind === 'heading' && b.text)).toEqual(['Characters', 'Places', 'Groups', 'Timeline']);
    const one = seriesBible(w, { throughBookId: books(w)[0].id });
    expect(one.subtitle).toBe('Series bible: what the reader knows by the end of The Salt Roads');
    expect(names(one)).not.toContain('Aldric Venn');
    expect(names(one)).toContain('Kaela Venn');
    const only = seriesBible(w, { sections: ['timeline'] });
    expect(only.blocks[0]).toEqual({ kind: 'heading', level: 1, text: 'Timeline' });
    const tl = only.blocks.slice(1).map((b) => (b.kind === 'p' ? b.runs[0].text : ''));
    expect(tl.length).toBeGreaterThan(3);
  });
  it('writes the bible as Word with heading styles and as PDF', async () => {
    const w = W();
    const doc = seriesBible(w);
    const zip = await JSZip.loadAsync(await buildPubDocx(doc, { now: '2026-11-12T10:00:00Z' }));
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('<w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t xml:space="preserve">Characters</w:t>');
    expect(xml).toContain('Series bible: everything');
    expect(ascii(buildPdf(doc, { page: 'a4', measure: roughMeasure })).startsWith('%PDF')).toBe(true);
  });
});

describe('RV-9 submissions', () => {
  it('sorts newest first, counts and works out days waiting', () => {
    const w = W();
    const list = sortedSubmissions(w, books(w)[0].id);
    expect(list.map((s) => s.to)).toEqual(['Harbourside first-novel prize', 'Petra Lind, Northlight Literary', 'Petra Lind, Northlight Literary', 'Hollis Grey, Grey & Marsh']);
    expect(submissionSummary(list)).toEqual({ sent: 4, open: 2, requests: 1, offers: 0, rejections: 1 });
    expect(daysWaiting({ ...list[0], sentOn: '2026-11-01' }, '2026-11-12')).toBe(11);
    expect(daysWaiting({ ...list[0], answer: 'rejected' }, '2026-11-12')).toBeUndefined();
  });
  it('are saved in the world file', async () => {
    const w = W();
    const back = (await loadWorldFile(await worldToBytes(w))).world;
    expect(back.submissions).toEqual(w.submissions);
  });
});
