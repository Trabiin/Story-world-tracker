/** WR-5: export a book, or some of its chapters, as a Word file. */
import { useState } from 'react';
import { Id, buildDocx, exportContent, outline, roundedWords } from '../../core';
import { ask } from '../components/Dialogs';
import { Field, Modal } from '../components/Modal';
import { useApp } from '../context';

export function ExportDialog({ bookId: initial, onClose }: { bookId: Id; onClose: () => void }) {
  const { world, store, platform } = useApp();
  const tree = outline(world);
  const [bookId, setBookId] = useState(initial);
  const book = tree.find((b) => b.book.id === bookId) ?? tree[0];
  const n = book?.chapters.length ?? 0;
  const [from, setFrom] = useState(0);
  const [to, setTo] = useState(Math.max(0, n - 1));
  const [style, setStyle] = useState<'manuscript' | 'reading'>('manuscript');
  const [sceneTitles, setSceneTitles] = useState(false);
  const ws = world.settings.writing ?? {};
  const setWriting = (patch: Partial<typeof ws>) => store.setSettings({ writing: { ...ws, ...patch } }, false);
  const [busy, setBusy] = useState(false);
  if (!book) return null;
  const lo = Math.min(from, n - 1), hi = Math.min(Math.max(to, lo), n - 1);
  const words = exportContent(world, { bookId: book.book.id, fromChapter: lo, toChapter: hi, style }).words;

  const run = async () => {
    setBusy(true);
    try {
      const bytes = await buildDocx(world, { bookId: book.book.id, fromChapter: lo, toChapter: hi, style, sceneTitles });
      const part = lo === 0 && hi === n - 1 ? '' : ` (${book.chapters[lo].chapter.title}${hi > lo ? ` to ${book.chapters[hi].chapter.title}` : ''})`;
      const name = `${book.book.title}${part}${style === 'reading' ? ' - reading copy' : ''}.docx`.replace(/[<>:"/\\|?*]+/g, ' ');
      if (await platform.saveBinaryFile(name, bytes)) onClose();
    } catch (e) {
      void ask.alert(`Export failed: ${e instanceof Error ? e.message : e}`);
    }
    setBusy(false);
  };

  return (
    <Modal title="Export to Word" onClose={onClose}
      footer={<><button className="primary" disabled={busy || n === 0} onClick={() => void run()}>{busy ? 'Exporting…' : 'Export .docx'}</button><button onClick={onClose}>Cancel</button></>}>
      <div className="form-grid">
        <Field label="Book">
          <select value={book.book.id} onChange={(e) => { setBookId(e.target.value); setFrom(0); setTo(9999); }}>
            {tree.map(({ book: b }) => <option key={b.id} value={b.id}>{b.title}</option>)}
          </select>
        </Field>
        {n > 1 && (
          <Field label="Chapters">
            <div className="row wrap">
              <select value={lo} onChange={(e) => setFrom(Number(e.target.value))}>{book.chapters.map((c, i) => <option key={c.chapter.id} value={i}>{c.chapter.title}</option>)}</select>
              <span className="muted">to</span>
              <select value={hi} onChange={(e) => setTo(Number(e.target.value))}>{book.chapters.map((c, i) => <option key={c.chapter.id} value={i} disabled={i < lo}>{c.chapter.title}</option>)}</select>
            </div>
          </Field>
        )}
        <Field label="Format">
          <div className="stack">
            <label className="checkbox"><input type="radio" checked={style === 'manuscript'} onChange={() => setStyle('manuscript')} /> Standard manuscript: title page, Times New Roman 12, double spaced, page numbers, # between scenes</label>
            <label className="checkbox"><input type="radio" checked={style === 'reading'} onChange={() => setStyle('reading')} /> Reading copy: book-like, single spaced, * * * between scenes</label>
          </div>
        </Field>
        <label className="checkbox"><input type="checkbox" checked={sceneTitles} onChange={(e) => setSceneTitles(e.target.checked)} /> Put scene titles above each scene</label>
        {style === 'manuscript' && (
          <>
            <Field label="Author name (title page and header)"><input value={ws.authorName ?? ''} onChange={(e) => setWriting({ authorName: e.target.value })} placeholder="Your name or pen name" /></Field>
            <Field label="Contact (top left of the title page)" hint="Address, email, phone or agent, one per line."><textarea rows={3} value={ws.contact ?? ''} onChange={(e) => setWriting({ contact: e.target.value })} /></Field>
          </>
        )}
        <p className="muted small">{roundedWords(words).replace(/^about/, 'About')} · {ws.spelling === 'en-US' ? 'US Letter' : 'A4'} pages (follows the spelling setting). The world keeps the text; the Word file is a copy.</p>
      </div>
    </Modal>
  );
}
