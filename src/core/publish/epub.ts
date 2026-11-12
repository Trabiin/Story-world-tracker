/**
 * RV-8: an ePub 3 reading copy (with an ePub 2 table of contents too, for older readers). Each level-1
 * heading starts a new file; the title page comes first.
 */
import JSZip from 'jszip';
import type { Run } from '../writing/doc';
import type { PubBlock, PubDoc } from './pubdoc';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function runsHtml(runs: Run[]): string {
  return runs.map((r) => {
    if (r.br) return '<br/>';
    let t = esc(r.text);
    if (r.italic) t = `<em>${t}</em>`;
    if (r.bold) t = `<strong>${t}</strong>`;
    return t;
  }).join('');
}

function blockHtml(b: PubBlock): string {
  if (b.kind === 'break') return '<p class="break">* * *</p>';
  if (b.kind === 'heading') return `<h${b.level}>${esc(b.text)}</h${b.level}>`;
  const cls = [b.first ? 'first' : '', b.small ? 'small' : ''].filter(Boolean).join(' ');
  return `<p${cls ? ` class="${cls}"` : ''}>${runsHtml(b.runs)}</p>`;
}

const page = (lang: string, title: string, body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head><meta charset="UTF-8"/><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>${body}</body>
</html>`;

const CSS = `body { font-family: Georgia, serif; line-height: 1.5; margin: 0 5%; }
h1 { text-align: center; margin: 3em 0 1.5em; font-weight: normal; font-size: 1.6em; page-break-before: always; }
h2 { font-size: 1.2em; margin: 1.5em 0 0.5em; }
h3 { font-size: 1em; font-style: italic; margin: 1em 0 0.3em; }
p { margin: 0; text-indent: 1.5em; text-align: justify; }
p.first, h1 + p, h2 + p, h3 + p, p.break + p { text-indent: 0; }
p.small { font-size: 0.9em; text-indent: 0; margin: 0.2em 0; text-align: left; }
p.break { text-align: center; text-indent: 0; margin: 1em 0; }
.title { text-align: center; margin-top: 30%; }
.title h1 { font-size: 2em; page-break-before: avoid; margin: 0 0 0.5em; }
.title p { text-align: center; text-indent: 0; }`;

export async function buildEpub(doc: PubDoc, opts: { id: string; modified?: string } ): Promise<Uint8Array> {
  const lang = doc.lang || 'en-GB';
  // Split at level-1 headings.
  const parts: { title: string; blocks: PubBlock[] }[] = [];
  for (const b of doc.blocks) {
    if (b.kind === 'heading' && b.level === 1) parts.push({ title: b.text, blocks: [b] });
    else (parts[parts.length - 1] ?? (parts.push({ title: doc.title, blocks: [] }), parts[0])).blocks.push(b);
  }
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file('OEBPS/style.css', CSS);
  zip.file('OEBPS/title.xhtml', page(lang, doc.title, `<div class="title"><h1>${esc(doc.title)}</h1>${doc.subtitle ? `<p>${esc(doc.subtitle)}</p>` : ''}${doc.author ? `<p>${esc(doc.author)}</p>` : ''}</div>`));
  parts.forEach((p, i) => zip.file(`OEBPS/part${i + 1}.xhtml`, page(lang, p.title, p.blocks.map(blockHtml).join('\n'))));
  const nav = `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${parts.map((p, i) => `<li><a href="part${i + 1}.xhtml">${esc(p.title)}</a></li>`).join('')}</ol></nav>`;
  zip.file('OEBPS/nav.xhtml', page(lang, 'Contents', nav));
  const uid = `urn:uuid:${opts.id}`;
  zip.file('OEBPS/toc.ncx', `<?xml version="1.0" encoding="UTF-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${uid}"/></head><docTitle><text>${esc(doc.title)}</text></docTitle><navMap>${parts.map((p, i) => `<navPoint id="n${i + 1}" playOrder="${i + 1}"><navLabel><text>${esc(p.title)}</text></navLabel><content src="part${i + 1}.xhtml"/></navPoint>`).join('')}</navMap></ncx>`);
  const modified = (opts.modified ?? new Date().toISOString()).replace(/\.\d+Z$/, 'Z');
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="${lang}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">${uid}</dc:identifier><dc:title>${esc(doc.title)}</dc:title><dc:language>${lang}</dc:language>${doc.author ? `<dc:creator>${esc(doc.author)}</dc:creator>` : ''}
<meta property="dcterms:modified">${modified}</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="css" href="style.css" media-type="text/css"/>
<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>
${parts.map((_, i) => `<item id="part${i + 1}" href="part${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('\n')}
</manifest>
<spine toc="ncx"><itemref idref="title"/>${parts.map((_, i) => `<itemref idref="part${i + 1}"/>`).join('')}</spine>
</package>`);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/epub+zip' });
}
