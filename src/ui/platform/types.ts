export interface WorldHandle {
  id: string;
  name: string;
  /** Desktop: absolute path of the .world file. */
  path?: string;
  updatedAt?: string;
}

export interface Platform {
  kind: 'desktop' | 'browser';
  listWorlds(): Promise<WorldHandle[]>;
  /** Create a new world location. Desktop asks where to save the file. */
  createWorld(name: string, bytes: Uint8Array): Promise<WorldHandle | null>;
  /** Desktop only: open an existing .world file from disk. */
  openWorldFile?(): Promise<WorldHandle | null>;
  load(h: WorldHandle): Promise<Uint8Array>;
  save(h: WorldHandle, bytes: Uint8Array): Promise<void>;
  /** Browser: deletes the world. Desktop: removes it from the recent list (file stays). */
  forget(h: WorldHandle): Promise<void>;
  /** EU-17: pick a backup folder (desktop). */
  chooseBackupFolder?(): Promise<string | null>;
  /** EU-17: write a timestamped backup copy. Returns where it went. */
  backup(h: WorldHandle, bytes: Uint8Array, folder?: string): Promise<string | null>;
  saveTextFile(suggestedName: string, text: string, mime: string): Promise<boolean>;
  saveBinaryFile(suggestedName: string, bytes: Uint8Array): Promise<boolean>;
  /** Desktop also returns the file's path, so it can be read again later (manuscripts). */
  pickFile(accept: string[]): Promise<{ name: string; bytes: Uint8Array; path?: string } | null>;
  /** Desktop: read a file again by path (manuscript refresh). */
  readPath?(path: string): Promise<Uint8Array>;
  /** Desktop: when the file was last changed (ms), to notice manuscript edits. */
  modifiedAt?(path: string): Promise<number | null>;
  /** Desktop: open a file in its usual program (e.g. Word). */
  openExternally?(path: string): Promise<void>;
  /** WR-7 (desktop): write every scene as a plain text file into "<world> text" inside the folder, replacing the last copy. Returns the folder. */
  writeTextCopies?(worldName: string, files: { path: string[]; text: string }[], folder: string): Promise<string | null>;
  /** WR-3: full screen for focus mode. */
  setFullscreen?(on: boolean): Promise<void>;
}

export function backupFileName(name: string, d = new Date()): string {
  const safe = name.replace(/[^\w\- ]+/g, '').trim() || 'world';
  const stamp = d.toISOString().replace(/[:T]/g, '-').slice(0, 19);
  return `${safe} ${stamp}.world`;
}
