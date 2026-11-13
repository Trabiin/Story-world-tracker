/**
 * RV-8, EU-16: a PDF without any library. The text is set in the PDF standard Times fonts (every
 * reader has them; Times New Roman on Windows has the same widths), justified, with a title page,
 * chapters on a new page and page numbers. Characters outside Windows-1252 are shown as "?".
 * The caller passes a measure function (the app measures with Times New Roman; tests use a simple one).
 */
import type { Run } from '../writing/doc';
import type { PubBlock, PubDoc } from './pubdoc';

export type FontStyle = 'R' | 'I' | 'B' | 'BI';
export type Measure = (text: string, font: FontStyle, size: number) => number;

export interface PdfOptions {
  /** Page size in points: "trade" 6×9 in (reading copy), "a4" or "letter" (bible, recap). */
  page: 'trade' | 'a4' | 'letter';
  size?: number;
  measure: Measure;
}

const PAGES = { trade: [432, 648], a4: [595.28, 841.89], letter: [612, 792] } as const;
const FONT_NAME: Record<FontStyle, string> = { R: 'Times-Roman', I: 'Times-Italic', B: 'Times-Bold', BI: 'Times-BoldItalic' };
const FONT_KEY: Record<FontStyle, string> = { R: 'F1', I: 'F2', B: 'F3', BI: 'F4' };

/** Windows-1252 for the characters above Latin-1 that writers use (quotes, dashes, ellipsis…). */
const CP1252: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e,
  '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};

/** Text as Windows-1252 bytes in a PDF string, escaped. One JS char per byte. */
export function pdfString(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    let b = c < 0x80 || (c >= 0xa0 && c <= 0xff) ? c : CP1252[ch];
    if (b === undefined) b = ch === ' ' || ch === ' ' ? 0x20 : 0x3f;
    if (b === 0x28 || b === 0x29 || b === 0x5c) out += '\\' + String.fromCharCode(b);
    else if (b < 0x20) out += ' ';
    else out += String.fromCharCode(b);
  }
  return `(${out})`;
}

const styleOf = (r: Run): FontStyle => (r.bold && r.italic ? 'BI' : r.bold ? 'B' : r.italic ? 'I' : 'R');

interface Word { parts: { text: string; font: FontStyle }[]; width: number; space: number; br?: boolean }

/** Split runs into words (a word can change font inside), each with its width and the width of the space after it. */
function words(runs: Run[], size: number, measure: Measure, force?: FontStyle): Word[] {
  const out: Word[] = [];
  let cur: Word | undefined;
  for (const r of runs) {
    if (r.br) { if (cur) out.push(cur); out.push({ parts: [], width: 0, space: 0, br: true }); cur = undefined; continue; }
    const font = force ?? styleOf(r);
    const pieces = r.text.replace(/\t/g, ' ').split(/( +)/);
    for (const piece of pieces) {
      if (!piece) continue;
      if (/^ +$/.test(piece)) { if (cur) { cur.space = measure(' ', font, size); out.push(cur); cur = undefined; } continue; }
      cur ??= { parts: [], width: 0, space: 0 };
      const last = cur.parts[cur.parts.length - 1];
      if (last?.font === font) last.text += piece; else cur.parts.push({ text: piece, font });
      cur.width += measure(piece, font, size);
    }
  }
  if (cur) out.push(cur);
  return out;
}

interface Line { words: Word[]; width: number; last: boolean }

function breakLines(ws: Word[], width: number, indent: number): Line[] {
  const lines: Line[] = [];
  let cur: Word[] = [], w = 0, avail = width - indent;
  const flush = (last: boolean) => { lines.push({ words: cur, width: w, last }); cur = []; w = 0; avail = width; };
  for (const word of ws) {
    if (word.br) { flush(true); continue; }
    const gap = cur.length ? cur[cur.length - 1].space || 0 : 0;
    if (cur.length && w + gap + word.width > avail) flush(false);
    w += (cur.length ? cur[cur.length - 1].space || 0 : 0) + word.width;
    cur.push(word);
  }
  if (cur.length || !lines.length) flush(true);
  else lines[lines.length - 1].last = true;
  return lines;
}

export function buildPdf(doc: PubDoc, opts: PdfOptions): Uint8Array {
  const [W, H] = PAGES[opts.page];
  const size = opts.size ?? 11;
  const lead = size * 1.45;
  const margin = opts.page === 'trade' ? 54 : 72;
  const left = margin, right = W - margin, top = H - margin, bottom = margin + 18;
  const textW = right - left;
  const pages: string[][] = [];
  let ops: string[] = [];
  let y = top;
  const newPage = () => { ops = []; pages.push(ops); y = top; };
  const text = (x: number, yy: number, font: FontStyle, sz: number, s: string, tw = 0) => ops.push(`BT /${FONT_KEY[font]} ${sz} Tf ${tw ? `${tw.toFixed(3)} Tw ` : ''}${x.toFixed(2)} ${yy.toFixed(2)} Td ${pdfString(s)} Tj ET`);
  const centred = (s: string, font: FontStyle, sz: number, yy: number) => text((W - opts.measure(s, font, sz)) / 2, yy, font, sz, s);

  // Title page.
  newPage();
  centred(doc.title, 'R', 24, H * 0.62);
  if (doc.subtitle) centred(doc.subtitle, 'I', 13, H * 0.62 - 30);
  if (doc.author) centred(doc.author, 'R', 14, H * 0.62 - (doc.subtitle ? 60 : 40));

  const drawLines = (lines: Line[], indent: number, sz: number, align: 'justify' | 'left' | 'center') => {
    for (const [i, ln] of lines.entries()) {
      if (y - lead < bottom) newPage();
      y -= sz * 1.45;
      let x = left + (i === 0 ? indent : 0);
      const spaces = ln.words.length - 1;
      const room = textW - (i === 0 ? indent : 0) - ln.width;
      if (align === 'center') x = (W - ln.width) / 2;
      const extra = align === 'justify' && !ln.last && spaces > 0 && room > 0 && room < textW * 0.35 ? room / spaces : 0;
      for (const [k, word] of ln.words.entries()) {
        for (const p of word.parts) {
          text(x, y, p.font, sz, p.text);
          x += opts.measure(p.text, p.font, sz);
        }
        if (k < ln.words.length - 1) x += (word.space || 0) + extra;
      }
    }
  };

  let first = true;
  for (const b of doc.blocks as PubBlock[]) {
    if (b.kind === 'heading') {
      if (b.level === 1) { newPage(); y = top - H * 0.12; }
      else { y -= lead * 0.8; if (y - lead * 3 < bottom) newPage(); }
      const sz = b.level === 1 ? size * 1.6 : b.level === 2 ? size * 1.2 : size;
      const font: FontStyle = b.level === 3 ? 'I' : b.level === 2 ? 'B' : 'R';
      drawLines(breakLines(words([{ text: b.text }], sz, opts.measure, font), textW, 0), 0, sz, b.level === 1 ? 'center' : 'left');
      y -= b.level === 1 ? lead * 1.5 : lead * 0.3;
      first = true;
      continue;
    }
    if (b.kind === 'break') {
      if (y - lead * 2 < bottom) newPage();
      y -= lead * 0.5;
      drawLines(breakLines(words([{ text: '*   *   *' }], size, opts.measure), textW, 0), 0, size, 'center');
      y -= lead * 0.5;
      first = true;
      continue;
    }
    const sz = b.small ? size * 0.9 : size;
    const indent = b.first || first || b.small ? 0 : size * 1.5;
    drawLines(breakLines(words(b.runs, sz, opts.measure), textW, indent), indent, sz, b.small ? 'left' : 'justify');
    if (b.small) y -= sz * 0.25;
    first = false;
  }

  // Page numbers (not on the title page).
  pages.forEach((p, i) => { if (i > 0) { const n = String(i); p.push(`BT /F1 9 Tf ${((W - opts.measure(n, 'R', 9)) / 2).toFixed(2)} ${(margin - 6).toFixed(2)} Td (${n}) Tj ET`); } });

  // Assemble: catalog 1, pages 2, fonts 3-6, then for each page: page object and content stream.
  const objs: string[] = [];
  const fontObjs = (['R', 'I', 'B', 'BI'] as FontStyle[]).map((f) => `<< /Type /Font /Subtype /Type1 /BaseFont /${FONT_NAME[f]} /Encoding /WinAnsiEncoding >>`);
  const pageIds = pages.map((_, i) => 7 + i * 2);
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  fontObjs.forEach((f, i) => { objs[3 + i] = f; });
  pages.forEach((p, i) => {
    const content = p.join('\n');
    objs[7 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R >> >> /Contents ${8 + i * 2} 0 R >>`;
    objs[8 + i * 2] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  const info = objs.length;
  objs[info] = `<< /Title ${pdfString(doc.title)} /Author ${pdfString(doc.author)} /Producer (Story World Tracker) >>`;
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}

/** A rough measure for tests and as a fallback: average Times widths. */
export const roughMeasure: Measure = (text, font, size) => {
  let w = 0;
  for (const ch of text) w += /[il.,;:'’!|]/.test(ch) ? 0.28 : /[mwMW—]/.test(ch) ? 0.85 : /[A-Z]/.test(ch) ? 0.68 : ch === ' ' ? 0.25 : 0.48;
  return w * size * (font === 'B' || font === 'BI' ? 1.05 : 1);
};
