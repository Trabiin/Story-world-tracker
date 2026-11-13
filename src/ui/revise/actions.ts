/**
 * RV-1, RV-3, RV-6 in the running app: changes to many scenes at once. Each changed scene keeps a
 * "Before …" version first (WR-6), since scene text has its own history and world undo leaves it alone;
 * the change can also be taken back at once while the text is still as it was left.
 */
import { Id, RenameKind, TextChange, TextNode, World, addVersion, docWords, logWords, makeVersion, withTexts } from '../../core';
import { nowIso } from '../../storage';
import type { WorldStore } from '../store';

/** Put new text into scenes, keeping a "Before …" version of each first. */
export async function applyTextChanges(store: WorldStore, changes: TextChange[], label: string, also?: (w: World) => World) {
  for (const c of changes) {
    const v = await makeVersion(c.sceneId, c.before, `Before ${label}`.slice(0, 80));
    store.update((w) => addVersion(w, v), false);
  }
  const delta = changes.reduce((n, c) => n + docWords(c.after) - docWords(c.before), 0);
  store.update((w) => logWords(withTexts(also ? also(w) : w, changes, docWords, nowIso()), delta), false);
}

/** Take a change back where the text is still exactly as the change left it. Returns how many scenes came back. */
export function undoTextChanges(store: WorldStore, changes: TextChange[]): number {
  const cur = new Map(store.world.sceneTexts.map((t) => [t.sceneId, t.doc]));
  const back = changes.filter((c) => cur.get(c.sceneId) === c.after).map((c) => ({ sceneId: c.sceneId, before: c.after, after: c.before as TextNode }));
  if (back.length) store.update((w) => withTexts(w, back, docWords, nowIso()), false);
  return back.length;
}

/** Open the Revise page at a tab, with a search or a rename ready (from the Write page, Warnings or a record page). */
export type ReviseRequest =
  | { tab: 'find'; query?: string; replace?: string; scope?: { kind: 'scene'; sceneId: Id } | { kind: 'book'; bookId: Id }; wholeWord?: boolean; matchCase?: boolean }
  | { tab: 'names'; rename?: { kind: RenameKind; id: Id } };
let pending: ReviseRequest | undefined;
export function requestRevise(r: ReviseRequest) { pending = r; }
export function takeReviseRequest(): ReviseRequest | undefined { const r = pending; pending = undefined; return r; }
