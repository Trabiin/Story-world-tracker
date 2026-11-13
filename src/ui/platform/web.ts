/**
 * The app installed from Chrome (Chromebook): worlds are real .world files, opened and saved with
 * Chrome's file access, so they can sit in Google Drive or My files and also open on Windows. The
 * list of recent worlds keeps the file handles; backups and settings stay in this browser.
 */
import { browserPlatform } from './browser';
import { Platform, WorldHandle } from './types';

// Chrome's File System Access API (not yet in TypeScript's DOM types).
interface FileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: BlobPart): Promise<void>; close(): Promise<void> }>;
  queryPermission(o: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission(o: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}
type PickerType = { description: string; accept: Record<string, string[]> };
interface FsWindow {
  showOpenFilePicker(o?: { types?: PickerType[]; multiple?: boolean; excludeAcceptAllOption?: boolean; id?: string }): Promise<FileHandle[]>;
  showSaveFilePicker(o?: { suggestedName?: string; types?: PickerType[]; id?: string }): Promise<FileHandle>;
}
const fsw = () => window as unknown as FsWindow;

export const hasFileAccess = () => typeof window !== 'undefined' && 'showSaveFilePicker' in window && 'showOpenFilePicker' in window;

const WORLD_TYPE: PickerType = { description: 'Story world', accept: { 'application/octet-stream': ['.world'] } };

const DB = 'story-world-tracker-files';
const FILES = 'files';
interface Row { id: string; name: string; updatedAt: string; handle: FileHandle }

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(FILES, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(FILES, mode);
    const r = fn(t.objectStore(FILES));
    t.oncomplete = () => resolve(r ? (r as IDBRequest<T>).result : (undefined as T));
    t.onerror = () => reject(t.error);
  });
}

const cancelled = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';
const baseName = (n: string) => n.replace(/\.world$/i, '');

/** Handles already read this visit. */
const known = new Map<string, FileHandle>();

async function remember(handle: FileHandle): Promise<WorldHandle> {
  // The same file opened twice keeps one entry.
  const rows = await tx<Row[]>('readonly', (s) => s.getAll());
  for (const r of rows) {
    try { if (await (r.handle as unknown as { isSameEntry(o: unknown): Promise<boolean> }).isSameEntry(handle)) { await tx('readwrite', (s) => s.delete(r.id)); } } catch { /* ignore */ }
  }
  const row: Row = { id: crypto.randomUUID(), name: baseName(handle.name), updatedAt: new Date().toISOString(), handle };
  await tx('readwrite', (s) => s.put(row));
  known.set(row.id, handle);
  return { id: row.id, name: row.name, updatedAt: row.updatedAt };
}

async function handleFor(h: WorldHandle): Promise<FileHandle> {
  const mem = known.get(h.id);
  if (mem) return mem;
  const row = await tx<Row | undefined>('readonly', (s) => s.get(h.id));
  if (!row) throw new Error('This world is no longer in the list. Open its .world file again.');
  known.set(h.id, row.handle);
  return row.handle;
}

/** Chrome asks once per visit (or remembers "allow on every visit" for an installed app). */
async function allow(handle: FileHandle): Promise<void> {
  if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') return;
  if ((await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('Chrome was not allowed to open the file. Open it again and choose Allow.');
}

async function saveAs(suggestedName: string, data: BlobPart, type?: PickerType): Promise<boolean> {
  try {
    const handle = await fsw().showSaveFilePicker({ suggestedName, types: type ? [type] : undefined });
    const w = await handle.createWritable();
    await w.write(data);
    await w.close();
    return true;
  } catch (e) {
    if (cancelled(e)) return false;
    throw e;
  }
}

/** Whether a world can be reopened at start-up without asking (Chrome remembered the permission). */
export async function canReopenQuietly(h: WorldHandle): Promise<boolean> {
  try { return (await (await handleFor(h)).queryPermission({ mode: 'readwrite' })) === 'granted'; } catch { return false; }
}

export const webPlatform: Platform = {
  kind: 'web',
  async listWorlds() {
    const rows = await tx<Row[]>('readonly', (s) => s.getAll());
    return rows.map(({ id, name, updatedAt }) => ({ id, name, updatedAt })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  async createWorld(name, bytes) {
    try {
      const handle = await fsw().showSaveFilePicker({ suggestedName: `${name || 'World'}.world`, types: [WORLD_TYPE], id: 'worlds' });
      const w = await handle.createWritable();
      await w.write(new Blob([bytes as BlobPart]));
      await w.close();
      return remember(handle);
    } catch (e) {
      if (cancelled(e)) return null;
      throw e;
    }
  },
  async openWorldFile() {
    try {
      const [handle] = await fsw().showOpenFilePicker({ types: [WORLD_TYPE], multiple: false, id: 'worlds' });
      if (!handle) return null;
      await allow(handle);
      return remember(handle);
    } catch (e) {
      if (cancelled(e)) return null;
      throw e;
    }
  },
  async load(h) {
    const handle = await handleFor(h);
    await allow(handle);
    const f = await handle.getFile();
    await tx('readwrite', (s) => s.put({ id: h.id, name: h.name, updatedAt: new Date().toISOString(), handle }));
    return new Uint8Array(await f.arrayBuffer());
  },
  async save(h, bytes) {
    const handle = await handleFor(h);
    // createWritable writes to a copy that replaces the file only on close, so a crash never leaves half a world.
    const w = await handle.createWritable();
    await w.write(new Blob([bytes as BlobPart]));
    await w.close();
  },
  async forget(h) {
    await tx('readwrite', (s) => s.delete(h.id));
    known.delete(h.id);
  },
  backup: (h, bytes) => browserPlatform.backup(h, bytes),
  saveTextFile: (name, text, mime) => saveAs(name, new Blob([text], { type: mime })),
  saveBinaryFile: (name, bytes) => saveAs(name, bytes as BlobPart),
  pickFile: (accept) => browserPlatform.pickFile(accept),
  setFullscreen: (on) => browserPlatform.setFullscreen!(on),
};
