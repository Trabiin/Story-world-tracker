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
  /** AI-1..AI-5 (desktop): the Claude folder, the local connector and Claude Code. */
  claude?: ClaudePlatform;
}

/** AI-1..AI-5: what the desktop app does for the Claude integration. */
export interface ClaudePlatform {
  /** Where a world's Claude folder goes unless the writer picks another place. */
  defaultFolder(worldName: string): Promise<string>;
  chooseFolder(): Promise<string | null>;
  /** AI-1: write the files that changed since the last call and remove the ones that are gone. Files not written by the app are left alone. */
  syncFolder(folder: string, files: { path: string; text: string; bytes?: Uint8Array }[]): Promise<{ written: number; removed: number }>;
  /** Remove every file the app wrote into the folder (and the folder, if it is then empty). */
  clearFolder(folder: string): Promise<void>;
  /** AI-2: start the local connector; requests arrive at onRequest, answers go back with reply. Returns the port. */
  startConnector(onRequest: (id: number, auth: string, body: string) => void): Promise<number>;
  reply(id: number, status: number, body: string): Promise<void>;
  /** AI-5: Claude Code's version, or an error when it is not installed. */
  version(): Promise<string>;
  /** AI-4: ask Claude Code in the folder; each stream-json line goes to onLine. Returns a run id. */
  ask(folder: string, prompt: string, session: string | undefined, onLine: (line: string) => void, onDone: (code: number | null, error: string) => void): Promise<number>;
  stop(run: number): Promise<void>;
  openFolder(folder: string): Promise<void>;
  openInVsCode(folder: string): Promise<void>;
  openTerminal(folder: string): Promise<void>;
}

export function backupFileName(name: string, d = new Date()): string {
  const safe = name.replace(/[^\w\- ]+/g, '').trim() || 'world';
  const stamp = d.toISOString().replace(/[:T]/g, '-').slice(0, 19);
  return `${safe} ${stamp}.world`;
}
