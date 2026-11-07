/**
 * NT-2 notes about a record and NT-4 research files, as they appear on a record's page (and on a
 * note): a list to open, a quick way to add one, and a viewer for images and PDFs.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Attachment, Id, Note, RefKind, TodoRef, fileKind, fileSize, filesFor, notesFor } from '../../core';
import { MAX_FILE_BYTES, getFile, putFile, recordBase } from '../../storage';
import { useApp } from '../context';
import { ask } from './Dialogs';

const ACCEPT = 'image/*,application/pdf,.pdf';

/** A blob: URL for a stored file, freed when the component goes. */
export function useFileUrl(a: Attachment | undefined): string | undefined {
  const url = useMemo(() => {
    const bytes = a && getFile(a.fileKey);
    return bytes ? URL.createObjectURL(new Blob([bytes as BlobPart], { type: a!.mime || 'application/octet-stream' })) : undefined;
  }, [a?.fileKey, a?.mime]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return url;
}

/** NT-4: read files the writer picked or dropped, keep their bytes and attach them to refs. Returns the new records. */
export function useAddFiles() {
  const { store } = useApp();
  return async (files: FileList | File[] | null, refs: TodoRef[]): Promise<Attachment[]> => {
    if (store.readOnly) { store.onBlocked?.(); return []; }
    const out: Attachment[] = [];
    const refused: string[] = [];
    for (const f of Array.from(files ?? [])) {
      const kind = fileKind(f.type, f.name);
      if (kind === 'other') { refused.push(`${f.name} (only images and PDFs)`); continue; }
      if (f.size > MAX_FILE_BYTES) { refused.push(`${f.name} (bigger than ${fileSize(MAX_FILE_BYTES)})`); continue; }
      const bytes = new Uint8Array(await f.arrayBuffer());
      const fileKey = await putFile(bytes);
      out.push({ ...recordBase(), name: f.name, mime: f.type || (kind === 'pdf' ? 'application/pdf' : 'image/png'), size: bytes.length, fileKey, caption: '', refs });
    }
    if (out.length) store.update((w) => ({ ...w, attachments: [...w.attachments, ...out] }));
    if (refused.length) void ask.alert(`Not added: ${refused.join(', ')}.`);
    return out;
  };
}

/** A small preview: the picture itself, or a PDF badge. */
export function FileThumb({ a, onOpen }: { a: Attachment; onOpen: () => void }) {
  const url = useFileUrl(fileKind(a.mime, a.name) === 'image' ? a : undefined);
  return (
    <button className="file-thumb" onClick={onOpen} title={`${a.name} · ${fileSize(a.size)}`}>
      {url ? <img src={url} alt={a.caption || a.name} /> : <span className="file-badge">{fileKind(a.mime, a.name) === 'pdf' ? 'PDF' : 'FILE'}</span>}
      <span className="file-name">{a.caption || a.name}</span>
    </button>
  );
}

/** NT-4: look at a file in the app: pictures full size, PDFs in the built-in reader. */
export function FileViewer({ a, onClose }: { a: Attachment; onClose: () => void }) {
  const { platform, go } = useApp();
  const url = useFileUrl(a);
  const kind = fileKind(a.mime, a.name);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const save = () => { const b = getFile(a.fileKey); if (b) void platform.saveBinaryFile(a.name, b); };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`file-viewer ${kind}`} role="dialog" aria-label={a.name}>
        <header>
          <b>{a.name}</b> <span className="muted small">{fileSize(a.size)}</span>
          <span className="spacer" />
          <button className="small" onClick={() => { onClose(); go('notes', a.id); }}>Details</button>
          <button className="small" onClick={save}>Save a copy…</button>
          <button className="icon" onClick={onClose} aria-label="Close">×</button>
        </header>
        {!url ? <p className="muted pad">The file's contents are missing from this world file.</p>
          : kind === 'image' ? <div className="file-view-body"><img src={url} alt={a.caption || a.name} /></div>
          : <iframe className="file-view-body" src={url} title={a.name} />}
        {a.caption && <footer className="muted small">{a.caption}</footer>}
      </div>
    </div>
  );
}

/** NT-4: the research files attached to a record or a note, with an Add button and drag and drop. */
export function FilesFor({ kind, id, title = 'Research files' }: { kind: RefKind; id: Id; title?: string }) {
  const { world, store } = useApp();
  const list = filesFor(world, kind, id);
  const add = useAddFiles();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState<Attachment | null>(null);
  const [over, setOver] = useState(false);
  const detach = (a: Attachment) => {
    const refs = a.refs.filter((r) => !(r.kind === kind && r.id === id));
    if (refs.length) store.upsert('attachments', { ...a, refs });
    else store.removeMany([{ c: 'attachments', id: a.id }]);
  };
  return (
    <section className={`files-for ${over ? 'drop' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); void add(e.dataTransfer.files, [{ kind, id }]); }}>
      <div className="section-head">
        <h2>{title} {list.length > 0 && <span className="muted">({list.length})</span>}</h2>
        <button className="small" disabled={store.readOnly} onClick={() => input.current?.click()}>+ Add file</button>
        <input ref={input} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { void add(e.target.files, [{ kind, id }]); e.target.value = ''; }} />
      </div>
      {list.length === 0 ? <p className="muted small">Images and PDFs: maps, articles, photos of places, old letters. Drop them here. They are kept in the world file.</p> : (
        <div className="file-grid">
          {list.map((a) => (
            <div key={a.id} className="file-cell">
              <FileThumb a={a} onOpen={() => setOpen(a)} />
              {!store.readOnly && <button className="icon file-remove" aria-label={`Remove ${a.name}`} title={a.refs.length > 1 ? 'Take it off here (it stays where else it is attached)' : 'Remove the file'} onClick={() => detach(a)}>×</button>}
            </div>
          ))}
        </div>
      )}
      {open && <FileViewer a={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

/** NT-2: notes about this record, and a button to write one. */
export function NotesFor({ kind, id }: { kind: RefKind; id: Id }) {
  const { world, store, go } = useApp();
  const list = notesFor(world, kind, id);
  const write = () => {
    if (store.readOnly) return store.onBlocked?.();
    const n: Note = { ...recordBase(), title: 'New note', body: '', folder: '', refs: [{ kind, id }] };
    store.upsert('notes', n);
    go('notes', n.id);
  };
  return (
    <section className="notes-for">
      <div className="section-head">
        <h2>Notes {list.length > 0 && <span className="muted">({list.length})</span>}</h2>
        <button className="small" onClick={write}>+ Note</button>
      </div>
      {list.length === 0 ? <p className="muted small">Research and ideas about this live in the Notebook. Notes linked here show up on this page.</p> : (
        <ul className="plain note-list">
          {list.map((n) => (
            <li key={n.id}>
              <button className="link" onClick={() => go('notes', n.id)}>{n.title || 'Untitled note'}</button>
              {n.inbox ? <span className="tag">Inbox</span> : n.folder ? <span className="muted small"> · {n.folder}</span> : null}
              {n.body && <div className="muted small note-snippet">{n.body.slice(0, 160)}{n.body.length > 160 ? '…' : ''}</div>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Both, as the record pages show them. */
export function Research({ kind, id }: { kind: RefKind; id: Id }) {
  return <><NotesFor kind={kind} id={id} /><FilesFor kind={kind} id={id} /></>;
}
