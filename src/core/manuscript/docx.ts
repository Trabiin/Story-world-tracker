/**
 * ST-8: read the text of a Word (.docx) file. Read-only: the file is never written.
 * Works without a DOM (desktop, browser and tests) by scanning the document XML.
 */
import JSZip from 'jszip';
import type { Paragraph } from '../model';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });
}

function attr(xml: string, tag: string, name = 'w:val'): string | undefined {
  const m = xml.match(new RegExp(`<${tag}\\b[^>]*\\b${name}="([^"]*)"`));
  return m ? decode(m[1]) : undefined;
}

/** Map style id → heading level, using names ("heading 1", "Title") and outline levels, so localized styles work. */
function headingStyles(stylesXml: string | undefined): Map<string, number> {
  const out = new Map<string, number>();
  if (!stylesXml) return out;
  for (const m of stylesXml.matchAll(/<w:style\b[^>]*w:type="paragraph"[^>]*>([\s\S]*?)<\/w:style>/g)) {
    const whole = m[0];
    const id = attr(whole, 'w:style', 'w:styleId');
    if (!id) continue;
    const name = (attr(whole, 'w:name') ?? '').toLowerCase();
    const outline = attr(whole, 'w:outlineLvl');
    const hm = name.match(/^heading\s*(\d)$/);
    if (hm) out.set(id, Number(hm[1]));
    else if (name === 'title') out.set(id, 1);
    else if (outline !== undefined && Number(outline) < 6) out.set(id, Number(outline) + 1);
  }
  return out;
}

export function paragraphsFromDocumentXml(documentXml: string, stylesXml?: string): Paragraph[] {
  const styles = headingStyles(stylesXml);
  const body = documentXml.slice(Math.max(0, documentXml.indexOf('<w:body')));
  const out: Paragraph[] = [];
  for (const m of body.matchAll(/<w:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:p>)/g)) {
    const inner = m[1] ?? '';
    // Text runs, tabs and breaks in document order; deleted text (w:delText) is ignored.
    let text = '';
    for (const t of inner.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\b[^>]*\/>|<w:cr\/>/g)) {
      if (t[0].startsWith('<w:t')) {
        if (t[0].startsWith('<w:tab')) text += '\t';
        else text += decode(t[1] ?? '');
      } else text += t[0].startsWith('<w:tab') ? '\t' : '\n';
    }
    const styleId = attr(inner, 'w:pStyle');
    const outline = attr(inner, 'w:outlineLvl');
    let heading = styleId ? styles.get(styleId) ?? (/^heading(\d)$/i.test(styleId) ? Number(styleId.slice(-1)) : undefined) : undefined;
    if (heading === undefined && outline !== undefined && Number(outline) < 6) heading = Number(outline) + 1;
    text = text.replace(/ /g, ' ');
    if (!text.trim() && heading === undefined) {
      // keep blank paragraphs out of the reader, they carry no passage
      continue;
    }
    out.push(heading ? { text, heading } : { text });
  }
  return out;
}

export async function readDocx(bytes: Uint8Array): Promise<Paragraph[]> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new Error('This file is not a Word .docx document.');
  }
  const doc = await zip.file('word/document.xml')?.async('string');
  if (!doc) throw new Error('This .docx has no document text (word/document.xml is missing).');
  const styles = await zip.file('word/styles.xml')?.async('string');
  return paragraphsFromDocumentXml(doc, styles);
}

/** Cheap stable fingerprint of the text (FNV-1a), to notice when the manuscript changed. */
export function textHash(paras: Paragraph[]): string {
  let h = 0x811c9dc5;
  for (const p of paras) {
    const s = (p.heading ?? 0) + p.text + '\u0001';
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h.toString(16).padStart(8, '0');
}
