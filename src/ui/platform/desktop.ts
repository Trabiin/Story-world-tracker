/** Desktop platform (Tauri): each world is a .world SQLite file the user picks. */
import { open, save } from '@tauri-apps/plugin-dialog';
import { exists, mkdir, readDir, readFile, remove, rename, writeFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { Platform, WorldHandle, backupFileName } from './types';

const RECENT_KEY = 'swt.recentWorlds';
const KEEP_BACKUPS = 30;

function readRecent(): WorldHandle[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  } catch {
    return [];
  }
}
function writeRecent(list: WorldHandle[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 20)));
  } catch {
    /* ignore */
  }
}
function remember(h: WorldHandle) {
  writeRecent([{ ...h, updatedAt: new Date().toISOString() }, ...readRecent().filter((r) => r.path !== h.path)]);
}
function baseName(path: string) {
  return path.split(/[\\/]/).pop()!.replace(/\.world$/i, '');
}
function join(folder: string, file: string) {
  return folder.replace(/[\\/]+$/, '') + (folder.includes('\\') ? '\\' : '/') + file;
}

export const desktopPlatform: Platform = {
  kind: 'desktop',
  async listWorlds() {
    const list = readRecent();
    const alive: WorldHandle[] = [];
    for (const h of list) if (h.path && (await exists(h.path).catch(() => false))) alive.push(h);
    return alive;
  },
  async createWorld(name, bytes) {
    const path = await save({ defaultPath: `${name}.world`, filters: [{ name: 'Story world', extensions: ['world'] }] });
    if (!path) return null;
    await writeFile(path, bytes);
    const h = { id: path, name, path };
    remember(h);
    return h;
  },
  async openWorldFile() {
    const path = await open({ multiple: false, filters: [{ name: 'Story world', extensions: ['world'] }] });
    if (!path || Array.isArray(path)) return null;
    const h = { id: path, name: baseName(path), path };
    remember(h);
    return h;
  },
  async load(h) {
    remember(h);
    return readFile(h.path!);
  },
  async save(h, bytes) {
    // Write to a temp file first so a crash mid-write never corrupts the world.
    const tmp = h.path! + '.saving';
    await writeFile(tmp, bytes);
    await rename(tmp, h.path!);
  },
  async forget(h) {
    writeRecent(readRecent().filter((r) => r.path !== h.path));
  },
  async chooseBackupFolder() {
    const dir = await open({ directory: true, multiple: false });
    return typeof dir === 'string' ? dir : null;
  },
  async backup(h, bytes, folder) {
    if (!folder) return null;
    if (!(await exists(folder))) await mkdir(folder, { recursive: true });
    const file = join(folder, backupFileName(h.name));
    await writeFile(file, bytes);
    const prefix = backupFileName(h.name).slice(0, -'YYYY-MM-DD-HH-MM-SS.world'.length);
    const entries = (await readDir(folder)).filter((e) => e.isFile && e.name.startsWith(prefix) && e.name.endsWith('.world')).map((e) => e.name).sort();
    for (const old of entries.slice(0, Math.max(0, entries.length - KEEP_BACKUPS))) await remove(join(folder, old)).catch(() => undefined);
    return file;
  },
  async saveTextFile(name, text) {
    const path = await save({ defaultPath: name });
    if (!path) return false;
    await writeTextFile(path, text);
    return true;
  },
  async saveBinaryFile(name, bytes) {
    const path = await save({ defaultPath: name });
    if (!path) return false;
    await writeFile(path, bytes);
    return true;
  },
  async pickFile(accept) {
    const path = await open({ multiple: false, filters: [{ name: 'File', extensions: accept.map((a) => a.replace(/^\./, '')) }] });
    if (!path || Array.isArray(path)) return null;
    return { name: path.split(/[\\/]/).pop()!, bytes: await readFile(path) };
  },
};
