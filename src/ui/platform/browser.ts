/** Browser preview platform: worlds live in IndexedDB in this browser only. */
import { Platform, WorldHandle, backupFileName } from './types';

const DB = 'story-world-tracker';
const WORLDS = 'worlds';
const BACKUPS = 'backups';
const KEEP_BACKUPS = 10;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore(WORLDS, { keyPath: 'id' });
      const b = db.createObjectStore(BACKUPS, { keyPath: 'key' });
      b.createIndex('worldId', 'worldId');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r ? (r as IDBRequest<T>).result : (undefined as T));
    t.onerror = () => reject(t.error);
  });
}

interface Row extends WorldHandle {
  bytes: Uint8Array;
}

function download(name: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export const browserPlatform: Platform = {
  kind: 'browser',
  async listWorlds() {
    const rows = await tx<Row[]>(WORLDS, 'readonly', (s) => s.getAll());
    return rows.map(({ id, name, updatedAt }) => ({ id, name, updatedAt })).sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  },
  async createWorld(name, bytes) {
    const h: Row = { id: crypto.randomUUID(), name, updatedAt: new Date().toISOString(), bytes };
    await tx(WORLDS, 'readwrite', (s) => s.put(h));
    return { id: h.id, name, updatedAt: h.updatedAt };
  },
  async load(h) {
    const row = await tx<Row>(WORLDS, 'readonly', (s) => s.get(h.id));
    if (!row) throw new Error('World not found in this browser.');
    return row.bytes;
  },
  async save(h, bytes) {
    await tx(WORLDS, 'readwrite', (s) => s.put({ id: h.id, name: h.name, updatedAt: new Date().toISOString(), bytes }));
  },
  async forget(h) {
    await tx(WORLDS, 'readwrite', (s) => s.delete(h.id));
  },
  async backup(h, bytes) {
    const key = `${h.id}:${Date.now()}`;
    await tx(BACKUPS, 'readwrite', (s) => s.put({ key, worldId: h.id, at: new Date().toISOString(), bytes }));
    const keys = await tx<IDBValidKey[]>(BACKUPS, 'readonly', (s) => s.index('worldId').getAllKeys(h.id));
    const old = (keys as string[]).sort().slice(0, Math.max(0, keys.length - KEEP_BACKUPS));
    if (old.length) await tx(BACKUPS, 'readwrite', (s) => old.forEach((k) => s.delete(k)));
    return `browser storage (${backupFileName(h.name)})`;
  },
  async saveTextFile(name, text, mime) {
    download(name, new Blob([text], { type: mime }));
    return true;
  },
  async saveBinaryFile(name, bytes) {
    download(name, new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
    return true;
  },
  pickFile(accept) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept.map((a) => (a.startsWith('.') ? a : `.${a}`)).join(',');
      input.onchange = async () => {
        const f = input.files?.[0];
        if (!f) return resolve(null);
        resolve({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
      };
      input.click();
    });
  },
};
