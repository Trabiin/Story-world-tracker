import { describe, expect, it } from 'vitest';
import { Character, Place, applyCsvImport, guessColumns, imagePdf, jpegSize, parseCsv, planCsvImport } from '../src/core';
import { recordBase } from '../src/storage';
import { sampleWorld } from '../src/ui/sample';
import { blankCharacter } from '../src/ui/util';

const ascii = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('');

describe('PL-6 CSV import', () => {
  it('reads quoted cells, doubled quotes, line breaks inside quotes, CRLF and semicolons', () => {
    expect(parseCsv('﻿Name,Notes\r\n"Venn, Kaela","said ""hi""\nthen left"\r\nOren,\r\n')).toEqual([['Name', 'Notes'], ['Venn, Kaela', 'said "hi"\nthen left'], ['Oren', '']]);
    expect(parseCsv('Name;Born\nBram;19/8/1023\n')).toEqual([['Name', 'Born'], ['Bram', '19/8/1023']]);
  });
  it('guesses columns from headings and plans adds, fills and skips', () => {
    const w = sampleWorld();
    const rows = parseCsv('Character,AKA,Born,Role,Tags\nKaela Venn,The Courier,14/3/1020,main,\nIlsa Marr,,~1018,supporting,smuggler; Saltmere\nIlsa Marr,,,,\nPip,,sometime,boss,\n');
    const cols = guessColumns('characters', rows[0]);
    expect(cols).toEqual({ name: 0, aliases: 1, birth: 2, importance: 3, tags: 4 });
    const plan = planCsvImport(w, 'characters', rows, cols, 'fill');
    expect(plan.rows.map((r) => [r.name, r.action])).toEqual([['Kaela Venn', 'fill'], ['Ilsa Marr', 'add'], ['Ilsa Marr', 'skip'], ['Pip', 'add']]);
    expect(plan.rows[3].problems).toEqual(['Born: "sometime" is not a date', 'Importance: "boss" (use main, secondary or minor)']);
    const after = applyCsvImport(w, plan, { character: (name) => ({ ...blankCharacter(w, recordBase()), name }), place: () => { throw new Error('no'); } });
    const ilsa = after.characters.find((c) => c.name === 'Ilsa Marr') as Character;
    expect(ilsa).toMatchObject({ importance: 'secondary', tags: ['smuggler', 'Saltmere'], birth: { year: 1018, precision: 'year', approximate: true } });
    // Kaela had no aliases: filled in; her birth was already set: kept.
    const kaela = after.characters.find((c) => c.name === 'Kaela Venn')!;
    expect(kaela.aliases).toEqual(['The Courier']);
    expect(kaela.birth).toEqual(w.characters.find((c) => c.name === 'Kaela Venn')!.birth);
    expect(after.characters.length).toBe(w.characters.length + 2);
  });
  it('links places to parents by name, also to places in the same file', () => {
    const w = sampleWorld();
    const rows = parseCsv('Name,Type,Inside,Lat,Lon\nNew Harbour,harbour,Old Quay,46.5,10.25\nOld Quay,district,Thornwick,,\nNowhere,village,,95,0\n');
    const plan = planCsvImport(w, 'places', rows, guessColumns('places', rows[0]), 'skip');
    expect(plan.rows[1].problems).toEqual(['Kind: "district" read as other']);
    expect(plan.rows[2].problems).toEqual(['Position: "95, 0" is not a latitude and longitude']);
    const after = applyCsvImport(w, plan, { character: () => { throw new Error('no'); }, place: (name) => ({ ...recordBase(), name, aliases: [], kind: 'other', notes: '', isPlaceholder: false }) });
    const byName = (n: string) => after.places.find((p) => p.name === n) as Place;
    expect(byName('New Harbour')).toMatchObject({ kind: 'port', location: { lat: 46.5, lng: 10.25 }, parentId: byName('Old Quay').id });
    expect(byName('Old Quay').parentId).toBe(byName('Thornwick').id);
  });
});

describe('PL-5 picture as PDF', () => {
  // A minimal JPEG header: SOI, then SOF0 with height 2 and width 3.
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 2, 0, 3, 3, 1, 0x11, 0, 0xff, 0xd9]);
  it('reads the JPEG size and embeds it untouched at the right offsets', () => {
    expect(jpegSize(jpeg)).toEqual({ w: 3, h: 2 });
    const pdf = imagePdf(jpeg, { title: 'The Salt Roads', caption: 'As of 05/05/1042' });
    const s = ascii(pdf);
    expect(s).toContain('/Width 3 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode');
    expect(s).toContain('/MediaBox [0 0 841.89 595.28]'); // landscape A4 for a wide picture
    const xref = Number(/startxref\n(\d+)/.exec(s)![1]);
    [...s.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].forEach((m, i) => expect(s.slice(Number(m[1]), Number(m[1]) + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    const at = s.indexOf('stream\n', s.indexOf('/DCTDecode')) + 7;
    expect(Array.from(pdf.slice(at, at + jpeg.length))).toEqual(Array.from(jpeg));
  });
});
