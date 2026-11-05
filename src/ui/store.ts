/**
 * World state for the UI: immutable updates, undo/redo, debounced autosave, periodic backups.
 */
import { useSyncExternalStore } from 'react';
import type { World } from '../core';
import { COLLECTIONS, CollectionName, nowIso, worldToBytes } from '../storage';
import type { Platform, WorldHandle } from './platform';

const AUTOSAVE_MS = 800;
const BACKUP_EVERY_MS = 10 * 60 * 1000;
const MAX_UNDO = 200;

type Rec<C extends CollectionName> = World[C][number];

export type SaveState = 'saved' | 'saving' | 'unsaved' | 'error';

export class WorldStore {
  private listeners = new Set<() => void>();
  private past: World[] = [];
  private future: World[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastBackup = 0;
  saveState: SaveState = 'saved';
  saveError = '';
  lastBackupInfo = '';
  version = 0;

  constructor(public world: World, public handle: WorldHandle, private platform: Platform) {
    if (world.settings.currentMoment === undefined) world.settings.currentMoment = undefined;
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  private emit() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }

  /** Apply a change. undoable=false for view state like the current moment. */
  update(fn: (w: World) => World, undoable = true) {
    const next = fn(this.world);
    if (next === this.world) return;
    if (undoable) {
      this.past.push(this.world);
      if (this.past.length > MAX_UNDO) this.past.shift();
      this.future = [];
    }
    this.world = next;
    this.scheduleSave();
    this.emit();
  }

  undo() {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(this.world);
    this.world = { ...prev, settings: { ...prev.settings, currentMoment: this.world.settings.currentMoment } };
    this.scheduleSave();
    this.emit();
  }
  redo() {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.world);
    this.world = { ...next, settings: { ...next.settings, currentMoment: this.world.settings.currentMoment } };
    this.scheduleSave();
    this.emit();
  }

  upsert<C extends CollectionName>(c: C, rec: Rec<C>) {
    this.update((w) => {
      const list = w[c] as Rec<C>[];
      const key = (r: Rec<C>) => ('id' in r ? r.id : (r as { key: string }).key);
      const stamped = ('updatedAt' in rec ? { ...rec, updatedAt: nowIso() } : rec) as Rec<C>;
      const i = list.findIndex((r) => key(r) === key(rec));
      const next = i >= 0 ? list.map((r, j) => (j === i ? stamped : r)) : [...list, stamped];
      return { ...w, [c]: next };
    });
  }

  removeMany(items: { c: CollectionName; id: string }[]) {
    this.update((w) => {
      const out = { ...w };
      for (const c of COLLECTIONS) {
        const ids = new Set(items.filter((i) => i.c === c).map((i) => i.id));
        if (ids.size) (out as Record<string, unknown>)[c] = (w[c] as { id?: string; key?: string }[]).filter((r) => !ids.has(r.id ?? r.key!));
      }
      return out;
    });
  }

  setSettings(patch: Partial<World['settings']>, undoable = true) {
    this.update((w) => ({ ...w, settings: { ...w.settings, ...patch } }), undoable);
  }

  setMoment(day: number) {
    this.setSettings({ currentMoment: Math.round(day) }, false);
  }

  private scheduleSave() {
    this.saveState = 'unsaved';
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.saveNow(), AUTOSAVE_MS);
  }

  async saveNow() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.saveState = 'saving';
    this.emit();
    try {
      const bytes = await worldToBytes(this.world);
      const h = { ...this.handle, name: this.world.settings.name };
      await this.platform.save(h, bytes);
      this.handle = h;
      this.saveState = this.timer ? 'unsaved' : 'saved';
      if (Date.now() - this.lastBackup > BACKUP_EVERY_MS) await this.backupNow(bytes);
    } catch (e) {
      this.saveState = 'error';
      this.saveError = String(e);
    }
    this.emit();
  }

  async backupNow(bytes?: Uint8Array) {
    const b = bytes ?? (await worldToBytes(this.world));
    try {
      const where = await this.platform.backup(this.handle, b, this.world.settings.backupFolder);
      this.lastBackup = Date.now();
      this.lastBackupInfo = where ? `Backed up ${new Date().toLocaleTimeString()} to ${where}` : 'No backup folder chosen';
    } catch (e) {
      this.lastBackupInfo = `Backup failed: ${e}`;
    }
    this.emit();
  }

  get hasPendingSave() {
    return this.timer !== null || this.saveState === 'saving';
  }
}

export function useStore(store: WorldStore): World {
  useSyncExternalStore(store.subscribe, () => store.version);
  return store.world;
}
