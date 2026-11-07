/**
 * WR-5: export a book (or some of its chapters) as a Word .docx, either in standard manuscript
 * format (title page, Times New Roman 12, double spacing, running header with page numbers,
 * "#" scene breaks, chapters on a new page) or as a plain reading copy.
 */
import JSZip from 'jszip';
import type { Id, World } from '../model';
import { outline } from '../story';
import { Block, Run, countWords, docToBlocks, runText, textOf } from './doc';

export interface ExportOptions {
  bookId: Id;
  /** First and last chapter to include (indexes in reading order); absent = all. */
  fromChapter?: number;
  toChapter?: number;
  style: 'manuscript' | 'reading';
  /** Put each scene's title above it (off for a finished manuscript). */
  sceneTitles?: boolean;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function runsXml(runs: Run[]): string {
  return runs.map((r) => {
    if (r.br) return '<w:r><w:br/></w:r>';
    if (!r.text) return '';
    const pr = (r.bold ? '<w:b/>' : '') + (r.italic ? '<w:i/>' : '');
    return r.text.split('\t').map((part, i) => `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}${i ? '<w:tab/>' : ''}${part ? `<w:t xml:space="preserve">${esc(part)}</w:t>` : ''}</w:r>`).join('');
  }).join('');
}

const para = (style: string, inner: string, extra = '') => `<w:p><w:pPr><w:pStyle w:val="${style}"/>${extra}</w:pPr>${inner}</w:p>`;
const textRun = (s: string) => `<w:r><w:t xml:space="preserve">${esc(s)}</w:t></w:r>`;

/** RV-6: the bookmark name our export puts around a scene (Word allows letters, digits and _ up to 40 characters). */
export function sceneBookmark(sceneId: Id): string {
  return `swt_${sceneId.replace(/[^A-Za-z0-9]/g, '')}`.slice(0, 40);
}

/** "about 90,000 words": nearest thousand for a novel, nearest hundred for something short. */
export function roundedWords(n: number): string {
  const r = n >= 10000 ? Math.round(n / 1000) * 1000 : Math.max(100, Math.round(n / 100) * 100);
  return `about ${r.toLocaleString('en-US')} words`;
}

/** What goes into the export: chapters in order, each with its scenes' blocks. */
export function exportContent(world: World, opts: ExportOptions) {
  const book = outline(world).find((b) => b.book.id === opts.bookId);
  if (!book) throw new Error('That book no longer exists.');
  const from = opts.fromChapter ?? 0, to = opts.toChapter ?? book.chapters.length - 1;
  const chapters = book.chapters.slice(from, to + 1).map(({ chapter, scenes }) => ({
    title: chapter.title,
    scenes: scenes.map((s) => ({ id: s.id, title: s.title, blocks: docToBlocks(textOf(world, s.id)?.doc) })),
  }));
  const words = chapters.reduce((n, c) => n + c.scenes.reduce((m, s) => m + s.blocks.reduce((k, b) => k + (b.kind === 'break' ? 0 : countWords(runText(b.runs))), 0), 0), 0);
  return { book: book.book, chapters, words };
}

export async function buildDocx(world: World, opts: ExportOptions): Promise<Uint8Array> {
  const { book, chapters, words } = exportContent(world, opts);
  const ms = opts.style === 'manuscript';
  const ws = world.settings.writing ?? {};
  const author = ws.authorName?.trim() || '';
  const surname = ws.authorSurname?.trim() || author.split(/\s+/).pop() || '';
  const a4 = ws.spelling !== 'en-US';
  const body: string[] = [];

  // Title page.
  if (ms) {
    body.push(para('SwtTitlePage', textRun(author || 'Author name') + '<w:r><w:tab/></w:r>' + textRun(roundedWords(words))));
    for (const line of (ws.contact ?? '').split(/\r?\n/).filter((l) => l.trim())) body.push(para('SwtTitlePage', textRun(line.trim())));
    body.push(para('SwtTitlePage', textRun(book.title.toUpperCase()), '<w:spacing w:before="4320"/><w:jc w:val="center"/>'));
    if (author) body.push(para('SwtTitlePage', textRun(`by ${author}`), '<w:jc w:val="center"/>'));
  } else {
    body.push(para('SwtTitlePage', `<w:r><w:rPr><w:sz w:val="48"/><w:szCs w:val="48"/></w:rPr><w:t xml:space="preserve">${esc(book.title)}</w:t></w:r>`, '<w:spacing w:before="3600" w:after="240"/><w:jc w:val="center"/>'));
    if (author) body.push(para('SwtTitlePage', textRun(author), '<w:jc w:val="center"/>'));
  }

  const breakMark = ms ? '#' : '* * *';
  let mark = 0;
  for (const c of chapters) {
    body.push(para('Heading1', textRun(c.title)));
    let first = true;
    c.scenes.forEach((s, si) => {
      if (si > 0) { body.push(para('SwtSceneSep', textRun(breakMark))); first = true; }
      if (opts.sceneTitles) { body.push(para('Heading2', textRun(s.title))); first = true; }
      // RV-6: a hidden bookmark around each scene's text, so an edited copy can be read back scene by scene.
      const start = body.length;
      for (const b of s.blocks as Block[]) {
        if (b.kind === 'break') { body.push(para('SwtSceneBreak', textRun(breakMark))); first = true; continue; }
        if (b.kind === 'heading') { body.push(para(b.level === 1 ? 'Heading2' : 'Heading3', runsXml(b.runs))); first = true; continue; }
        body.push(para(first ? 'SwtFirst' : 'SwtBody', runsXml(b.runs)));
        first = false;
      }
      if (body.length > start) {
        const id = ++mark;
        body[start] = body[start].replace('</w:pPr>', `</w:pPr><w:bookmarkStart w:id="${id}" w:name="${sceneBookmark(s.id)}"/>`);
        body[body.length - 1] = body[body.length - 1].replace(/<\/w:p>$/, `<w:bookmarkEnd w:id="${id}"/></w:p>`);
      }
    });
  }
  if (ms) body.push(para('SwtEnd', textRun('THE END')));

  const page = a4 ? '<w:pgSz w:w="11906" w:h="16838"/>' : '<w:pgSz w:w="12240" w:h="15840"/>';
  const sect = `<w:sectPr>${ms ? '<w:headerReference w:type="default" r:id="rId3"/>' : '<w:footerReference w:type="default" r:id="rId4"/>'}${page}<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:titlePg/></w:sectPr>`;
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body.join('')}${sect}</w:body></w:document>`;

  const font = ms ? 'Times New Roman' : 'Georgia';
  const size = ms ? 24 : 22;
  const line = ms ? 480 : 276;
  const rightTab = a4 ? 9026 : 9360;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}" w:eastAsia="${font}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/><w:lang w:val="${ws.spelling ?? 'en-GB'}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="${line}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="SwtBody"><w:name w:val="Manuscript Body"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:firstLine="${ms ? 720 : 432}"/></w:pPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="SwtFirst"><w:name w:val="Manuscript First Paragraph"/><w:basedOn w:val="SwtBody"/><w:next w:val="SwtBody"/><w:qFormat/><w:pPr><w:ind w:firstLine="${ms ? 720 : 0}"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="SwtFirst"/><w:qFormat/><w:pPr><w:keepNext/><w:pageBreakBefore/><w:spacing w:before="${ms ? 2880 : 1440}" w:after="${ms ? 480 : 480}"/><w:jc w:val="center"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr>${ms ? '' : '<w:b/><w:sz w:val="32"/>'}</w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="SwtFirst"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="SwtFirst"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="SwtSceneBreak"><w:name w:val="Scene Break"/><w:basedOn w:val="Normal"/><w:next w:val="SwtFirst"/><w:pPr><w:keepNext/><w:jc w:val="center"/></w:pPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="SwtSceneSep"><w:name w:val="Scene Separator"/><w:basedOn w:val="SwtSceneBreak"/><w:next w:val="SwtFirst"/><w:pPr><w:keepNext/><w:jc w:val="center"/></w:pPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="SwtTitlePage"><w:name w:val="Title Page"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:line="240" w:lineRule="auto"/><w:tabs><w:tab w:val="right" w:pos="${rightTab}"/></w:tabs></w:pPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="SwtEnd"><w:name w:val="The End"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="480"/><w:jc w:val="center"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:line="240" w:lineRule="auto"/><w:jc w:val="right"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr></w:style>
</w:styles>`;
  const pageField = '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
  const shortTitle = book.title.split(/[:—–]/)[0].trim().toUpperCase().split(/\s+/).slice(0, 4).join(' ');
  const headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${W}><w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr>${textRun(`${surname ? surname + ' / ' : ''}${shortTitle} / `)}${pageField}</w:p></w:hdr>`;
  const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${W}><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr>${pageField}</w:p></w:ftr>`;

  const zip = new JSZip();
  const add = (name: string, xml: string) => zip.file(name, xml, { createFolders: false });
  add('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
  add('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  add('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`);
  add('word/document.xml', documentXml);
  add('word/styles.xml', stylesXml);
  add('word/settings.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings ${W}><w:defaultTabStop w:val="720"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`);
  add('word/header1.xml', headerXml);
  add('word/footer1.xml', footerXml);
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  add('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(book.title)}</dc:title><dc:creator>${esc(author)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
