import JSZip from 'jszip';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Build a minimal .docx: [style, text] pairs; style 'H1'/'H2' map to localized style ids. */
export async function makeDocx(paras: [string | null, string][]): Promise<Uint8Array> {
  const zip = new JSZip();
  const body = paras
    .map(([style, text]) => {
      const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
      const runs = text.split('\t').map((t, i) => `${i ? '<w:r><w:tab/></w:r>' : ''}<w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`).join('');
      return `<w:p>${pPr}${runs}</w:p>`;
    })
    .join('');
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:p/><w:p><w:r><w:delText>deleted</w:delText></w:r></w:p></w:body></w:document>`);
  zip.file('word/styles.xml', `<?xml version="1.0"?><w:styles xmlns:w="x"><w:style w:type="paragraph" w:styleId="berschrift1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="H2x"><w:name w:val="heading 2"/></w:style></w:styles>`);
  return zip.generateAsync({ type: 'uint8array' });
}
