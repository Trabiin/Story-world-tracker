/** WR-4: bring a Word file into the app, split into chapters and scenes. */
import { useMemo, useState } from 'react';
import { DocxContent, Id, ImportOptions, addVersion, applyImport, guessChapterLevel, makeVersion, moveLinks, planImport, plainParas, readDocxRich, textOf } from '../../core';
import { nowIso, recordBase } from '../../storage';
import { ask } from '../components/Dialogs';
import { Field, Modal } from '../components/Modal';
import { useApp } from '../context';

export function ImportDialog({ onClose, onDone, manuscriptId }: { onClose: () => void; onDone?: (bookId: Id) => void; manuscriptId?: Id }) {
  const { world, store, platform, go } = useApp();
  const manuscript = world.manuscripts.find((m) => m.id === manuscriptId);
  const [file, setFile] = useState<{ name: string; content: DocxContent } | null>(null);
  const [error, setError] = useState('');
  const [opts, setOpts] = useState<ImportOptions>({ chapterLevel: 1, splitAtBreaks: true, splitAtSubheadings: false, fallbackTitle: 'Opening' });
  const [target, setTarget] = useState<string>(manuscript?.bookId ?? '');
  const [newTitle, setNewTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (bytes: Uint8Array, name: string) => {
    try {
      const content = await readDocxRich(bytes);
      const level = guessChapterLevel(content);
      setOpts((o) => ({ ...o, chapterLevel: level, fallbackTitle: level ? 'Opening' : name.replace(/\.docx$/i, '') }));
      setNewTitle(content.title ?? manuscript?.name.replace(/\.docx$/i, '') ?? name.replace(/\.docx$/i, ''));
      setFile({ name, content });
      setError('');
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  };
  const pick = async () => {
    const f = await platform.pickFile(['.docx']);
    if (f) await load(f.bytes, f.name);
  };
  const fromManuscript = async () => {
    if (!manuscript?.path || !platform.readPath) return pick();
    try { await load(await platform.readPath(manuscript.path), manuscript.name); } catch { await pick(); }
  };

  const levels = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of file?.content.paras ?? []) if (p.heading) m.set(p.heading, (m.get(p.heading) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [file]);
  const plan = useMemo(() => (file ? planImport(file.content, opts) : undefined), [file, opts]);
  const links = manuscript ? world.links.filter((l) => l.manuscriptId === manuscript.id) : [];

  const run = async () => {
    if (!file || !plan) return;
    setBusy(true);
    // Links move onto a copy of the plan, so the preview stays as it was.
    const working = structuredClone(plan);
    const moved = links.length ? moveLinks(working, plainParas(file.content), links) : { moved: 0, lost: [] };
    let bookId = '';
    let sceneIds: Id[] = [];
    store.update((w) => {
      const r = applyImport(w, working, file.content, target ? { bookId: target } : { newBookTitle: newTitle.trim() || 'Imported book' }, recordBase);
      bookId = r.bookId;
      sceneIds = r.sceneIds;
      const manuscripts = manuscript ? r.world.manuscripts.map((m) => (m.id === manuscript.id ? { ...m, importedAt: nowIso(), importedBookId: r.bookId, updatedAt: nowIso() } : m)) : r.world.manuscripts;
      return { ...r.world, manuscripts };
    });
    // WR-6: each imported scene starts its history with the text as it came in.
    for (const id of sceneIds) {
      const t = textOf(store.world, id);
      if (!t) continue;
      const v = await makeVersion(id, t.doc, `Imported from ${file.name}`, true);
      store.update((w) => addVersion(w, v), false);
    }
    setBusy(false);
    onClose();
    onDone?.(bookId);
    go('write', bookId);
    const parts = [`Imported ${plan.chapters.length} chapter${plan.chapters.length === 1 ? '' : 's'} and ${plan.scenes} scene${plan.scenes === 1 ? '' : 's'} (${plan.words.toLocaleString('en-US')} words).`];
    if (links.length) parts.push(`${moved.moved} of ${links.length} linked passages moved with their text${moved.lost.length ? `; ${moved.lost.length} could not be found and stay in the manuscript reader` : ''}.`);
    if (plan.skipped.length) parts.push(`Headings above the chapters were left out: ${plan.skipped.slice(0, 5).join(', ')}${plan.skipped.length > 5 ? '…' : ''}.`);
    parts.push('The Word file was not changed.');
    void ask.alert(parts.join(' '));
  };

  const comments = file?.content.comments.length ?? 0;
  return (
    <Modal title={manuscript ? `Import ${manuscript.name} into the app` : 'Import from Word'} onClose={onClose} wide
      footer={<><button className="primary" disabled={!plan || busy || store.readOnly} onClick={() => void run()}>{busy ? 'Importing…' : 'Import'}</button><button onClick={onClose}>Cancel</button></>}>
      {!file && (
        <div className="stack">
          <p>The Word file is split into chapters and scenes and its text comes into the editor, with headings, bold, italics and scene breaks. Word comments become margin comments{manuscript ? ', and passages you linked move with their text' : ''}. The file itself is never changed.</p>
          <div className="row">
            {manuscript ? <button className="primary" onClick={() => void fromManuscript()}>Read {manuscript.name}</button> : <button className="primary" onClick={() => void pick()}>Choose a .docx file…</button>}
          </div>
          {error && <p className="danger">{error}</p>}
        </div>
      )}
      {file && plan && (
        <div className="import-grid">
          <div className="form-grid">
            <Field label="Chapters start at" hint={levels.length ? `This file uses ${levels.map(([l, n]) => `${n} × Heading ${l}`).join(', ')}.` : 'This file has no headings, so it comes in as one chapter.'}>
              <select value={opts.chapterLevel} onChange={(e) => setOpts({ ...opts, chapterLevel: Number(e.target.value) })}>
                {levels.map(([l]) => <option key={l} value={l}>Heading {l}</option>)}
                <option value={0}>No split: one chapter</option>
              </select>
            </Field>
            <label className="checkbox"><input type="checkbox" checked={opts.splitAtBreaks} onChange={(e) => setOpts({ ...opts, splitAtBreaks: e.target.checked })} /> A line of *** or # starts a new scene</label>
            <label className="checkbox"><input type="checkbox" checked={opts.splitAtSubheadings} onChange={(e) => setOpts({ ...opts, splitAtSubheadings: e.target.checked })} /> Smaller headings start a new scene (and name it)</label>
            <Field label="Into">
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">A new book</option>
                {world.books.map((b) => <option key={b.id} value={b.id}>{b.title} (add at the end)</option>)}
              </select>
            </Field>
            {!target && <Field label="New book title"><input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} /></Field>}
            <p className="muted small">{file.name}: {plan.chapters.length} chapters, {plan.scenes} scenes, {plan.words.toLocaleString('en-US')} words{comments ? `, ${comments} comment${comments === 1 ? '' : 's'}` : ''}{links.length ? `, ${links.length} linked passage${links.length === 1 ? '' : 's'}` : ''}.</p>
          </div>
          <div className="import-preview">
            <ol>
              {plan.chapters.map((c, i) => (
                <li key={i}><b>{c.title}</b> <span className="muted small">{c.scenes.length === 1 ? '1 scene' : `${c.scenes.length} scenes`}</span>
                  {c.scenes.length > 1 && <ul className="muted small">{c.scenes.map((s, j) => <li key={j}>{s.title}: “{previewText(s)}”</li>)}</ul>}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </Modal>
  );
}

function previewText(s: { blocks: { kind: string; runs?: { text: string }[] }[] }): string {
  const first = s.blocks.find((b) => b.kind === 'p');
  const t = (first?.runs ?? []).map((r) => r.text).join('');
  return t.length > 60 ? `${t.slice(0, 60)}…` : t;
}
