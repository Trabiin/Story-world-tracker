/**
 * PL-5: a picture (the map, the timeline) as a one-page PDF. The picture is a JPEG, which PDF can
 * hold as it is (DCTDecode); the page is A4 or Letter landscape (or portrait for a tall picture), with
 * a title and a caption in Times under it.
 */
import { pdfString } from './pdf';

export interface ImagePdfOptions {
  title: string;
  caption?: string;
  page?: 'a4' | 'letter';
}

/** Width and height of a baseline or progressive JPEG, from its SOF marker. */
export function jpegSize(b: Uint8Array): { w: number; h: number } | undefined {
  if (b[0] !== 0xff || b[1] !== 0xd8) return undefined;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    const len = (b[i + 2] << 8) | b[i + 3];
    if ((m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf)) {
      return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
    }
    i += 2 + len;
  }
  return undefined;
}

export function imagePdf(jpeg: Uint8Array, opts: ImagePdfOptions): Uint8Array {
  const size = jpegSize(jpeg);
  if (!size) throw new Error('The picture is not a JPEG.');
  const [a, b] = opts.page === 'letter' ? [612, 792] : [595.28, 841.89];
  const landscape = size.w >= size.h;
  const W = landscape ? b : a, H = landscape ? a : b;
  const margin = 36, titleH = 30, capH = opts.caption ? 22 : 0;
  const boxW = W - 2 * margin, boxH = H - 2 * margin - titleH - capH;
  const k = Math.min(boxW / size.w, boxH / size.h);
  const iw = size.w * k, ih = size.h * k;
  const ix = (W - iw) / 2, iy = margin + capH + (boxH - ih) / 2;
  const content = [
    `BT /F1 16 Tf ${margin} ${(H - margin - 16).toFixed(2)} Td ${pdfString(opts.title)} Tj ET`,
    `q ${iw.toFixed(2)} 0 0 ${ih.toFixed(2)} ${ix.toFixed(2)} ${iy.toFixed(2)} cm /Im1 Do Q`,
    ...(opts.caption ? [`BT /F2 10 Tf ${margin} ${(margin + 4).toFixed(2)} Td ${pdfString(opts.caption)} Tj ET`] : []),
  ].join('\n');

  // Objects as byte chunks, so the JPEG goes in untouched.
  const enc = (s: string) => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff; return u; };
  const objs: Uint8Array[][] = [];
  objs[1] = [enc('<< /Type /Catalog /Pages 2 0 R >>')];
  objs[2] = [enc('<< /Type /Pages /Kids [3 0 R] /Count 1 >>')];
  objs[3] = [enc(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> /XObject << /Im1 7 0 R >> >> /Contents 4 0 R >>`)];
  objs[4] = [enc(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)];
  objs[5] = [enc('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>')];
  objs[6] = [enc('<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic /Encoding /WinAnsiEncoding >>')];
  objs[7] = [enc(`<< /Type /XObject /Subtype /Image /Width ${size.w} /Height ${size.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, enc('\nendstream')];
  objs[8] = [enc(`<< /Title ${pdfString(opts.title)} /Producer (Story World Tracker) >>`)];
  const parts: Uint8Array[] = [enc('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')];
  let pos = parts[0].length;
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = pos;
    const chunk = [enc(`${i} 0 obj\n`), ...objs[i], enc('\nendobj\n')];
    for (const c of chunk) { parts.push(c); pos += c.length; }
  }
  const xref = pos;
  parts.push(enc(`xref\n0 ${objs.length}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length} /Root 1 0 R /Info 8 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
