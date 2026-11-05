import { describe, expect, it } from 'vitest';
import { locate, makeAnchor, Paragraph, readDocx, reanchor, textHash } from '../src/core';
import { makeDocx } from './docxBuilder';

describe('docx reading', () => {
  it('reads paragraphs, headings (localized styles), tabs and entities, skipping deleted text', async () => {
    const bytes = await makeDocx([
      ['berschrift1', 'Chapter One'],
      [null, 'Kaela rode out of Varn at dawn & did not look back.'],
      ['H2x', 'The road'],
      [null, 'Left\tright'],
    ]);
    const paras = await readDocx(bytes);
    expect(paras).toEqual([
      { text: 'Chapter One', heading: 1 },
      { text: 'Kaela rode out of Varn at dawn & did not look back.' },
      { text: 'The road', heading: 2 },
      { text: 'Left\tright' },
    ]);
    expect(textHash(paras)).toMatch(/^[0-9a-f]{8}$/);
  });
  it('rejects files that are not docx', async () => {
    await expect(readDocx(new Uint8Array([1, 2, 3]))).rejects.toThrow('not a Word');
  });
});

describe('re-anchoring links after edits', () => {
  const v1: Paragraph[] = [
    { text: 'Chapter One', heading: 1 },
    { text: 'Kaela rode out of Varn at dawn. The gates closed behind her.' },
    { text: 'Chapter Two', heading: 1 },
    { text: 'Oren waited at Thornwick for three days, counting the carts.' },
  ];
  const quoteStart = v1[3].text.indexOf('waited at Thornwick');
  const anchor = makeAnchor(v1, 3, quoteStart, quoteStart + 'waited at Thornwick for three days'.length);

  it('makes anchors with context and heading', () => {
    expect(anchor.quote).toBe('waited at Thornwick for three days');
    expect(anchor.heading).toBe('Chapter Two');
    expect(anchor.prefix).toBe('Oren ');
  });
  it('finds an unchanged passage in place', () => {
    expect(locate(v1, anchor)?.state).toBe('ok');
  });
  it('finds a passage after paragraphs were inserted above', () => {
    const v2 = [v1[0], { text: 'A new opening paragraph.' }, ...v1.slice(1)];
    expect(locate(v2, anchor)).toMatchObject({ paraIndex: 4, state: 'moved' });
  });
  it('finds a slightly reworded passage approximately', () => {
    const v3 = [...v1.slice(0, 3), { text: 'Oren waited in Thornwick for three long days, counting the carts.' }];
    const found = locate(v3, anchor);
    expect(found?.state).toBe('fuzzy');
    expect(v3[3].text.slice(found!.start, found!.end)).toBe('waited in Thornwick for three long days');
  });
  it('reports a deleted passage as lost', () => {
    const v4 = v1.slice(0, 3);
    expect(locate(v4, anchor)).toBeNull();
    expect(reanchor(v4, [{ anchor, state: 'ok' }])[0].state).toBe('lost');
  });
  it('picks the right occurrence of repeated text using context', () => {
    const paras: Paragraph[] = [{ text: 'He said yes. She said yes.' }];
    const a = makeAnchor(paras, 0, 17, 25); // second "said yes"
    const edited: Paragraph[] = [{ text: 'Then he said yes. She said yes.' }];
    expect(locate(edited, a)).toMatchObject({ start: 22, state: 'moved' });
  });
});
