/**
 * World state for the UI: immutable updates, undo/redo, debounced autosave, periodic backups.
 */
import { useSyncExternalStore } from 'react';
import { CANON, Id, World, applyScenarioEdit, resolveRelativeDates, safetyCopyFiles, scenarioView } from '../core';
import { COLLECTIONS, CollectionName, Snapshot, makeSnapshot, nowIso, pruneSnapshots, restoreSnapshot, worldToBytes } from '../storage';
import type { Platform, WorldHandle } from './platform';

const AUTOSAVE_MS = 800;
const BACKUP_EVERY_MS = 10 * 60 * 1000;
const MAX_UNDO = 200;
const SNAPSHOT_EVERY_MS = 10 * 60 * 1000;

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
  /** EU-8: while the reader's view is on, the world shown is filtered, so edits are blocked. */
  readOnly = false;
  /** ST-7: the scenario being viewed and edited. Edits made in a scenario are kept apart from canon. */
  scenarioId: Id = CANON;
  onBlocked: (() => void) | null = null;
  private lastSnapshotAt = 0;
  private snapshotWorld: World | null = null;

  constructor(public world: World, public handle: WorldHandle, public readonly platform: Platform, public snapshots: Snapshot[] = []) {
    this.snapshotWorld = world;
    this.lastSnapshotAt = snapshots[0] ? Date.parse(snapshots[0].at) : 0;
  }

  /** PL-3: keep a compressed copy of the world now and then, inside the world file. */
  private async maybeSnapshot() {
    if (this.world === this.snapshotWorld || Date.now() - this.lastSnapshotAt < SNAPSHOT_EVERY_MS) return;
    await this.snapshotNow('Automatic');
  }

  async snapshotNow(label: string) {
    const s = await makeSnapshot(this.world, label);
    this.snapshots = pruneSnapshots([s, ...this.snapshots]);
    this.lastSnapshotAt = Date.now();
    this.snapshotWorld = this.world;
    this.emit();
  }

  async restore(id: string) {
    const s = this.snapshots.find((x) => x.id === id);
    if (!s) return;
    await this.snapshotNow(`Before restoring ${new Date(s.at).toLocaleString()}`);
    const restored = await restoreSnapshot(s, this.world);
    this.update(() => restored, true, true);
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

  /**
   * Apply a change. undoable=false for view state like the current moment. The change is made on the
   * active scenario's view of the world (ST-7) and written back into canon or the scenario.
   * raw=true replaces the stored world as a whole (version restore, scenario management).
   */
  update(fn: (w: World) => World, undoable = true, raw = false) {
    if (undoable && this.readOnly) {
      this.onBlocked?.();
      return;
    }
    let next: World;
    if (raw) next = fn(this.world);
    else {
      const before = scenarioView(this.world, this.scenarioId);
      const edited = fn(before);
      if (edited === before) return;
      // TL-4: dates tied to an event, chapter or scene follow it when it moves.
      next = applyScenarioEdit(this.world, this.scenarioId, before, undoable ? resolveRelativeDates(edited) : edited);
    }
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

  /**
   * WR-2, WR-6: scene text has its own undo (in the editor) and its own history, so world undo and
   * redo keep the text as it is now (and the WR-12 words-per-day log with it). Text of scenes that come back (an undone delete) comes back too.
   */
  private keepText(target: World): World {
    const cur = this.world;
    const ids = new Set(cur.sceneTexts.map((t) => t.id));
    const back = target.sceneTexts.filter((t) => !ids.has(t.id));
    // AI-3: proposals that arrived since stay (an undone accept puts its proposal back to open); AI-9: the activity log is history.
    const had = new Set(target.suggestions.map((s) => s.id));
    const arrived = cur.suggestions.filter((s) => !had.has(s.id));
    return {
      ...target, sceneTexts: back.length ? [...cur.sceneTexts, ...back] : cur.sceneTexts, sceneVersions: cur.sceneVersions, writingDays: cur.writingDays,
      suggestions: arrived.length ? [...target.suggestions, ...arrived] : target.suggestions, claudeLog: cur.claudeLog,
      settings: { ...target.settings, currentMoment: cur.settings.currentMoment, claude: cur.settings.claude },
    };
  }

  undo() {
    if (this.readOnly) return this.onBlocked?.();
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(this.world);
    this.world = this.keepText(prev);
    this.scheduleSave();
    this.emit();
  }
  redo() {
    if (this.readOnly) return this.onBlocked?.();
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.world);
    this.world = this.keepText(next);
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

  /** exact: keep a fraction of a day, so playback moves markers smoothly (VW-2). */
  setMoment(day: number, exact = false) {
    this.setSettings({ currentMoment: exact ? day : Math.round(day) }, false);
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
      await this.maybeSnapshot();
      const bytes = await worldToBytes(this.world, this.snapshots);
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
    const b = bytes ?? (await worldToBytes(this.world, this.snapshots));
    try {
      const folder = this.world.settings.backupFolder;
      const where = await this.platform.backup(this.handle, b, folder);
      this.lastBackup = Date.now();
      this.lastBackupInfo = where ? `Backed up ${new Date().toLocaleTimeString()} to ${where}` : 'No backup folder chosen';
      // WR-7: every scene as a plain text file beside the backup.
      if (where && folder && this.platform.writeTextCopies && this.world.sceneTexts.length) {
        try {
          const dir = await this.platform.writeTextCopies(this.world.settings.name, safetyCopyFiles(this.world), folder);
          if (dir) this.lastBackupInfo += `, text copies in ${dir}`;
        } catch (e) {
          this.lastBackupInfo += ` (text copies failed: ${e})`;
        }
      }
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
