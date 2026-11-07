/** Desktop platform (Tauri): each world is a .world SQLite file the user picks. */
import { open, save } from '@tauri-apps/plugin-dialog';
import { exists, mkdir, readDir, readFile, remove, rename, stat, writeFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { openPath } from '@tauri-apps/plugin-opener';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { documentDir } from '@tauri-apps/api/path';
import { ClaudePlatform, Platform, WorldHandle, backupFileName } from './types';

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
    return { name: path.split(/[\\/]/).pop()!, bytes: await readFile(path), path };
  },
  readPath(path) {
    return readFile(path);
  },
  async modifiedAt(path) {
    try {
      const s = await stat(path);
      return s.mtime ? new Date(s.mtime).getTime() : null;
    } catch {
      return null;
    }
  },
  async openExternally(path) {
    await openPath(path);
  },
  async writeTextCopies(worldName, files, folder) {
    // Write the new copy beside the old one, then swap, so a failure never leaves a half copy.
    const safe = worldName.replace(/[<>:"/\\|?*]+/g, ' ').trim() || 'world';
    const dir = join(folder, `${safe} text`);
    const tmp = join(folder, `${safe} text (writing)`);
    if (await exists(tmp)) await remove(tmp, { recursive: true });
    await mkdir(tmp, { recursive: true });
    const made = new Set<string>();
    for (const f of files) {
      let at = tmp;
      for (const part of f.path.slice(0, -1)) {
        at = join(at, part);
        if (!made.has(at)) { await mkdir(at, { recursive: true }); made.add(at); }
      }
      await writeTextFile(join(at, f.path[f.path.length - 1]), f.text);
    }
    if (await exists(dir)) await remove(dir, { recursive: true });
    await rename(tmp, dir);
    return dir;
  },
  async setFullscreen(on) {
    await getCurrentWindow().setFullscreen(on);
  },
};

/** AI-1: the list of files the app wrote into a Claude folder, so it only ever removes its own. */
const MANIFEST = '.story-world-files.json';
/** Last text written per file, so an unchanged page is not written again on every save. */
const written = new Map<string, string>();

function fileIn(folder: string, rel: string) {
  return rel.split('/').reduce((at, part) => join(at, part), folder);
}

async function readManifest(folder: string): Promise<string[]> {
  try {
    return JSON.parse(new TextDecoder().decode(await readFile(join(folder, MANIFEST))));
  } catch {
    return [];
  }
}

type Run = { onLine: (l: string) => void; onDone: (code: number | null, error: string) => void };
const runs = new Map<number, Run>();
/** Output that arrived before the run was registered (the first lines can beat the answer to claude_ask). */
const early = new Map<number, { lines: string[]; done?: [number | null, string] }>();
const earlyOf = (run: number) => { let e = early.get(run); if (!e) early.set(run, (e = { lines: [] })); return e; };
let mcpHandler: ((id: number, auth: string, body: string) => void) | null = null;
let listening: Promise<void> | null = null;
function listenOnce() {
  listening ??= (async () => {
    await listen<{ id: number; auth: string; body: string }>('claude-mcp', (e) => mcpHandler?.(e.payload.id, e.payload.auth, e.payload.body));
    await listen<{ run: number; line: string }>('claude-out', (e) => {
      const r = runs.get(e.payload.run);
      if (r) r.onLine(e.payload.line); else earlyOf(e.payload.run).lines.push(e.payload.line);
    });
    await listen<{ run: number; code: number | null; error: string }>('claude-done', (e) => {
      const r = runs.get(e.payload.run);
      if (r) { r.onDone(e.payload.code, e.payload.error); runs.delete(e.payload.run); } else earlyOf(e.payload.run).done = [e.payload.code, e.payload.error];
    });
  })();
  return listening;
}

export const desktopClaude: ClaudePlatform = {
  async defaultFolder(worldName) {
    const safe = worldName.replace(/[<>:"/\\|?*]+/g, ' ').trim() || 'world';
    return join(join(join(await documentDir(), 'Story World Tracker'), 'Claude'), safe);
  },
  async chooseFolder() {
    const dir = await open({ directory: true, multiple: false });
    return typeof dir === 'string' ? dir : null;
  },
  async syncFolder(folder, files) {
    if (!(await exists(folder))) await mkdir(folder, { recursive: true });
    const before = new Set(await readManifest(folder));
    const now = new Set(files.map((f) => f.path));
    const dirs = new Set<string>();
    let n = 0;
    for (const f of files) {
      const path = fileIn(folder, f.path);
      if (written.get(path) === f.text && before.has(f.path)) continue;
      const dir = f.path.split('/').slice(0, -1).join('/');
      if (dir && !dirs.has(dir)) { await mkdir(fileIn(folder, dir), { recursive: true }); dirs.add(dir); }
      if (f.bytes) await writeFile(path, f.bytes);
      else await writeTextFile(path, f.text);
      written.set(path, f.text);
      n++;
    }
    let removed = 0;
    for (const old of before) {
      if (now.has(old)) continue;
      await remove(fileIn(folder, old)).catch(() => undefined);
      written.delete(fileIn(folder, old));
      removed++;
    }
    if (n || removed || before.size !== now.size) await writeTextFile(join(folder, MANIFEST), JSON.stringify([...now].sort(), null, 0));
    return { written: n, removed };
  },
  async clearFolder(folder) {
    if (!(await exists(folder))) return;
    const files = await readManifest(folder);
    for (const f of files) {
      await remove(fileIn(folder, f)).catch(() => undefined);
      written.delete(fileIn(folder, f));
    }
    await remove(join(folder, MANIFEST)).catch(() => undefined);
    // Then the folders the app made, deepest first. A folder that still holds something of the writer's stays.
    const dirs = new Set<string>();
    for (const f of files) { const parts = f.split('/'); for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/')); }
    for (const d of [...dirs].sort((a, b) => b.split('/').length - a.split('/').length)) await remove(fileIn(folder, d)).catch(() => undefined);
    await remove(folder).catch(() => undefined);
  },
  async startConnector(onRequest) {
    mcpHandler = onRequest;
    await listenOnce();
    return invoke<number>('claude_bridge_start');
  },
  async reply(id, status, body) {
    await invoke('claude_bridge_reply', { id, status, body });
  },
  version() {
    return invoke<string>('claude_version');
  },
  async ask(folder, prompt, session, onLine, onDone) {
    await listenOnce();
    const run = await invoke<number>('claude_ask', { folder, prompt, session: session ?? null, model: null });
    const e = early.get(run);
    early.delete(run);
    e?.lines.forEach(onLine);
    if (e?.done) onDone(...e.done);
    else runs.set(run, { onLine, onDone });
    return run;
  },
  async stop(run) {
    await invoke('claude_stop', { run });
  },
  async openFolder(folder) {
    await openPath(folder);
  },
  async openInVsCode(folder) {
    await invoke('open_in_vscode', { folder });
  },
  async openTerminal(folder) {
    await invoke('open_claude_terminal', { folder });
  },
};

desktopPlatform.claude = desktopClaude;
