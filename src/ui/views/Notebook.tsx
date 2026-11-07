/**
 * NT-2 the notebook: free notes and research pages in folders, each linked to the records it is
 * about. NT-3 quick captures land in the Inbox to sort later. NT-4 research files (images, PDFs)
 * are attached to notes and records and can be looked at here.
 */
import { useEffect, useMemo, useState } from 'react';
import { Attachment, FolderNode, Note, cleanFolder, dmy, fileKind, fileSize, folderPaths, folderTree, inFolder, moveFolder } from '../../core';
import { nowIso, recordBase } from '../../storage';
import { ask } from '../components/Dialogs';
import { RefChip, RefPicker } from '../components/Refs';
import { FilesFor, FileViewer, useAddFiles, useFileUrl } from '../components/Research';
import { useApp } from '../context';

type Place = { kind: 'inbox' } | { kind: 'all' } | { kind: 'files' } | { kind: 'folder'; path: string };
const PLACE_KEY = 'swt.notebook.place';
const DRAG = 'application/x-swt-note';

const byRecent = (a: Note, b: Note) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt.localeCompare(a.updatedAt);

export function Notebook() {
  const { world, store, selected, select } = useApp();
  const [place, setPlaceState] = useState<Place>(() => { try { return JSON.parse(localStorage.getItem(PLACE_KEY) ?? 'null') ?? { kind: 'all' }; } catch { return { kind: 'all' }; } });
  const setPlace = (p: Place) => { setPlaceState(p); try { localStorage.setItem(PLACE_KEY, JSON.stringify(p)); } catch { /* ignore */ } };
  const [q, setQ] = useState('');
  const tree = useMemo(() => folderTree(world.notes), [world.notes]);
  const inbox = world.notes.filter((n) => n.inbox);
  const curNote = world.notes.find((n) => n.id === selected);
  const curFile = world.attachments.find((a) => a.id === selected);
  const addFiles = useAddFiles();

  // Opened from elsewhere (a record page, search): show the list it is in.
  useEffect(() => {
    if (curNote && !shownIn(place, curNote)) setPlace(curNote.inbox ? { kind: 'inbox' } : curNote.folder ? { kind: 'folder', path: cleanFolder(curNote.folder) } : { kind: 'all' });
    if (curFile && place.kind !== 'files') setPlace({ kind: 'files' });
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const match = (s: string) => terms.every((t) => s.toLowerCase().includes(t));
  const notes = place.kind === 'files' ? [] : world.notes.filter((n) => shownIn(place, n) && match(`${n.title} ${n.body}`)).sort(byRecent);
  const files = place.kind === 'files' ? world.attachments.filter((a) => match(`${a.name} ${a.caption}`)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : [];

  const newNote = (folder = place.kind === 'folder' ? place.path : '') => {
    if (store.readOnly) return store.onBlocked?.();
    const n: Note = { ...recordBase(), title: 'New note', body: '', folder, refs: [] };
    store.upsert('notes', n);
    if (place.kind === 'inbox' || place.kind === 'files') setPlace(folder ? { kind: 'folder', path: folder } : { kind: 'all' });
    select(n.id);
    setTimeout(() => (document.querySelector('.note-title') as HTMLInputElement | null)?.select(), 50);
  };
  const newFolder = async () => {
    const name = cleanFolder((await ask.prompt('Name of the new folder (use / for a folder inside another, e.g. "Research/Ships"):', place.kind === 'folder' ? `${place.path}/` : '')) ?? '');
    if (name) newNote(name);
  };
  const renameFolder = async (path: string) => {
    const to = cleanFolder((await ask.prompt(`Rename or move the folder “${path}” (its notes go with it):`, path)) ?? '');
    if (!to || to === path) return;
    store.update((w) => moveFolder(w, path, to, nowIso()));
    setPlace({ kind: 'folder', path: to });
  };
  const dropOn = (folder: string) => (e: React.DragEvent) => {
    const id = e.dataTransfer.getData(DRAG);
    const n = world.notes.find((x) => x.id === id);
    if (!n) return;
    e.preventDefault();
    store.upsert('notes', { ...n, folder, inbox: undefined });
  };
  const dropProps = (folder: string) => ({ onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes(DRAG)) e.preventDefault(); }, onDrop: dropOn(folder) });

  const Folder = ({ f, depth }: { f: FolderNode; depth: number }) => (
    <>
      <li className={place.kind === 'folder' && place.path === f.path ? 'active' : ''} style={{ paddingLeft: 12 + depth * 14 }} onClick={() => setPlace({ kind: 'folder', path: f.path })} onDoubleClick={() => void renameFolder(f.path)} title="Double-click to rename" {...dropProps(f.path)}>
        <span className="folder-icon" aria-hidden>▸</span> {f.name} <span className="muted small">{f.total}</span>
      </li>
      {f.children.map((c) => <Folder key={c.path} f={c} depth={depth + 1} />)}
    </>
  );

  const placeTitle = place.kind === 'inbox' ? 'Inbox' : place.kind === 'files' ? 'Research files' : place.kind === 'folder' ? place.path : 'All notes';
  return (
    <div className="notebook">
      <aside className="master notebook-folders">
        <div className="master-tools">
          <button className="primary" onClick={() => newNote()}>+ Note</button>
          <input placeholder="Search notes" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <ul className="list">
          <li className={place.kind === 'inbox' ? 'active' : ''} onClick={() => setPlace({ kind: 'inbox' })} title="NT-3: quick notes (Ctrl+Shift+N) wait here until you sort them">Inbox {inbox.length > 0 && <span className="count">{inbox.length}</span>}</li>
          <li className={place.kind === 'all' ? 'active' : ''} onClick={() => setPlace({ kind: 'all' })} {...dropProps('')}>All notes <span className="muted small">{world.notes.length - inbox.length}</span></li>
          <li className="list-group"><div className="list-heading">Folders</div></li>
          {tree.map((f) => <Folder key={f.path} f={f} depth={0} />)}
          <li className="muted small" onClick={() => void newFolder()}>+ New folder</li>
          <li className="list-group"><div className="list-heading">Research</div></li>
          <li className={place.kind === 'files' ? 'active' : ''} onClick={() => setPlace({ kind: 'files' })}>Research files <span className="muted small">{world.attachments.length}</span></li>
        </ul>
      </aside>
      <aside className="master notebook-list">
        <div className="master-tools">
          <div className="row">
            <b className="grow">{placeTitle}</b>
            {place.kind === 'folder' && <button className="small" onClick={() => void renameFolder(place.path)}>Rename</button>}
          </div>
          {place.kind === 'files' && (
            <label className="button small">+ Add files<input type="file" accept="image/*,application/pdf,.pdf" multiple hidden onChange={(e) => { void addFiles(e.target.files, []).then((a) => a[0] && select(a[0].id)); e.target.value = ''; }} /></label>
          )}
        </div>
        <ul className="list notes">
          {notes.map((n) => (
            <li key={n.id} className={n.id === selected ? 'active' : ''} onClick={() => select(n.id)} draggable onDragStart={(e) => e.dataTransfer.setData(DRAG, n.id)}>
              <div className="note-row-title">{n.pinned && <span title="Pinned">📌 </span>}{n.title || 'Untitled note'}</div>
              <div className="muted small note-row-sub">{(place.kind === 'all' || place.kind === 'folder') && n.folder && cleanFolder(n.folder) !== (place.kind === 'folder' ? place.path : '') ? `${n.folder} · ` : ''}{n.body.replace(/\s+/g, ' ').slice(0, 70) || 'No text'}</div>
            </li>
          ))}
          {files.map((a) => (
            <li key={a.id} className={a.id === selected ? 'active' : ''} onClick={() => select(a.id)}>
              <div className="note-row-title"><span className="file-badge small">{fileKind(a.mime, a.name) === 'pdf' ? 'PDF' : 'IMG'}</span> {a.caption || a.name}</div>
              <div className="muted small note-row-sub">{fileSize(a.size)}{a.refs.length ? ` · ${a.refs.length} linked` : ' · not linked yet'}</div>
            </li>
          ))}
          {!notes.length && !files.length && (
            <li className="list-group muted small empty-list">
              {q ? 'Nothing matches.' : place.kind === 'inbox' ? 'The Inbox is empty. Press Ctrl+Shift+N anywhere to jot something down; it waits here until you sort it.' : place.kind === 'files' ? 'No research files yet. Add images and PDFs here, or on any note or record page.' : 'No notes here yet.'}
            </li>
          )}
        </ul>
      </aside>
      <section className="detail">
        {curNote ? <NoteDetail key={curNote.id} n={curNote} />
          : curFile ? <FileDetail key={curFile.id} a={curFile} />
          : <div className="empty">Your notebook: research, ideas, lists of names, whatever you want to keep beside the story. Put notes in folders, link them to characters, places, scenes or anything else (they then show on those pages), and attach images and PDFs.</div>}
      </section>
    </div>
  );
}

function shownIn(place: Place, n: Note): boolean {
  if (place.kind === 'inbox') return !!n.inbox;
  if (n.inbox) return false;
  if (place.kind === 'folder') return inFolder(n, place.path);
  return place.kind === 'all';
}

function NoteDetail({ n }: { n: Note }) {
  const { world, store, select } = useApp();
  const set = (p: Partial<Note>) => store.upsert('notes', { ...n, ...p });
  const paths = useMemo(() => folderPaths(world.notes), [world.notes]);
  const remove = async () => {
    const files = world.attachments.filter((a) => a.refs.length === 1 && a.refs[0].kind === 'note' && a.refs[0].id === n.id);
    if (!(await ask.confirm(`Delete the note “${n.title}”?${files.length ? ` Its ${files.length} file${files.length === 1 ? '' : 's'} go too.` : ''}`, { okLabel: 'Delete', danger: true }))) return;
    store.update((w) => ({
      ...w,
      notes: w.notes.filter((x) => x.id !== n.id),
      attachments: w.attachments.filter((a) => !files.includes(a)).map((a) => (a.refs.some((r) => r.kind === 'note' && r.id === n.id) ? { ...a, refs: a.refs.filter((r) => !(r.kind === 'note' && r.id === n.id)) } : a)),
    }));
    select(undefined);
  };
  return (
    <div className="page note-page">
      <div className="page-head">
        <input className="note-title" value={n.title} placeholder="Title" onChange={(e) => set({ title: e.target.value })} aria-label="Title" />
        <div className="row">
          <button className={n.pinned ? 'on' : ''} onClick={() => set({ pinned: n.pinned ? undefined : true })} title="Keep at the top of its folder">{n.pinned ? 'Pinned' : 'Pin'}</button>
          <button className="danger" onClick={remove}>Delete</button>
        </div>
      </div>
      <div className="row wrap note-meta">
        {n.inbox ? (
          <span className="inbox-sort">
            <span className="tag">Inbox</span>
            <input list="note-folders" placeholder="Folder to file it in" defaultValue="" onKeyDown={(e) => { if (e.key === 'Enter') set({ folder: cleanFolder((e.target as HTMLInputElement).value), inbox: undefined }); }} />
            <button className="small" onClick={(e) => { const inp = (e.currentTarget.previousSibling as HTMLInputElement); set({ folder: cleanFolder(inp.value), inbox: undefined }); }}>File it</button>
          </span>
        ) : (
          <label className="row">Folder <input list="note-folders" value={n.folder} placeholder="Top of the notebook" onChange={(e) => set({ folder: e.target.value })} onBlur={(e) => { const f = cleanFolder(e.target.value); if (f !== n.folder) set({ folder: f }); }} /></label>
        )}
        <datalist id="note-folders">{paths.map((p) => <option key={p} value={p} />)}</datalist>
        <span className="muted small">Changed {dmy(n.updatedAt, true)}</span>
      </div>
      <textarea className="note-body" value={n.body} placeholder="Write anything: research, ideas, a list of names…" onChange={(e) => set({ body: e.target.value })} />
      <section>
        <h2>About</h2>
        <p className="muted small">Link the characters, places, scenes or other records this note is about. It shows on their pages.</p>
        <div className="stack">
          {n.refs.length > 0 && <div className="row wrap">{n.refs.map((r, i) => <RefChip key={r.kind + r.id} r={r} onRemove={() => set({ refs: n.refs.filter((_, k) => k !== i) })} />)}</div>}
          <RefPicker exclude={[...n.refs, { kind: 'note', id: n.id }]} onPick={(r) => set({ refs: [...n.refs, r] })} />
        </div>
      </section>
      <FilesFor kind="note" id={n.id} title="Files" />
    </div>
  );
}

function FileDetail({ a }: { a: Attachment }) {
  const { store, select } = useApp();
  const [big, setBig] = useState(false);
  const url = useFileUrl(a);
  const kind = fileKind(a.mime, a.name);
  const set = (p: Partial<Attachment>) => store.upsert('attachments', { ...a, ...p });
  const remove = async () => {
    if (!(await ask.confirm(`Remove the file “${a.name}” from the world?`, { okLabel: 'Remove', danger: true }))) return;
    store.removeMany([{ c: 'attachments', id: a.id }]);
    select(undefined);
  };
  return (
    <div className="page file-page">
      <div className="page-head">
        <h1>{a.name}</h1>
        <div className="row">
          <button onClick={() => setBig(true)}>Open</button>
          <button className="danger" onClick={remove}>Remove</button>
        </div>
      </div>
      <p className="muted small">{kind === 'pdf' ? 'PDF' : 'Image'} · {fileSize(a.size)} · added {dmy(a.createdAt)}</p>
      <div className="file-preview">
        {!url ? <p className="muted">The file's contents are missing.</p> : kind === 'image' ? <img src={url} alt={a.caption || a.name} onClick={() => setBig(true)} /> : <iframe src={url} title={a.name} />}
      </div>
      <label className="field"><span className="label">Caption</span><input value={a.caption} placeholder="What it is, where it came from" onChange={(e) => set({ caption: e.target.value })} /></label>
      <section>
        <h2>Attached to</h2>
        <div className="stack">
          {a.refs.length > 0 ? <div className="row wrap">{a.refs.map((r, i) => <RefChip key={r.kind + r.id} r={r} onRemove={() => set({ refs: a.refs.filter((_, k) => k !== i) })} />)}</div> : <p className="muted small">Not attached to anything yet.</p>}
          <RefPicker placeholder="+ Attach to a note, character, place…" exclude={[...a.refs, { kind: 'file', id: a.id }]} onPick={(r) => set({ refs: [...a.refs, r] })} />
        </div>
      </section>
      {big && <FileViewer a={a} onClose={() => setBig(false)} />}
    </div>
  );
}
