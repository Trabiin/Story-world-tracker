/**
 * AI-3, AI-9: Claude's proposals in the running app. Every accepted or direct change is one world
 * undo step; scene text that changes gets a "Before Claude" version first (WR-6), and direct changes
 * a "Before Claude" copy in version history (PL-3), so everything Claude did is labelled and can be undone.
 */
import {
  ApplyOptions, ApplyResult, ClaudeSuggestion, Id, ProposalCheck, ProposalInput, World, acceptSuggestion, addSuggestion, addVersion, applyProposal, makeVersion,
  rejectSuggestion, undoAllDirect, undoLogEntry,
} from '../../core';
import { newId, nowIso } from '../../storage';
import type { WorldStore } from '../store';

export const claudeOpts: ApplyOptions = { newId, now: nowIso };

/** WR-6: keep the scene text as it was before Claude's change. */
async function keepTextVersions(store: WorldStore, result: ApplyResult, title: string) {
  for (const t of result.texts) {
    if (!t.before) continue;
    const v = await makeVersion(t.sceneId, t.before, `Before Claude: ${title}`.slice(0, 80));
    store.update((w) => addVersion(w, v), false);
  }
}

export async function acceptInStore(store: WorldStore, s: ClaudeSuggestion, only?: number[]): Promise<string[] | null> {
  const done = acceptSuggestion(store.world, s.id, claudeOpts, only);
  if ('errors' in done) return done.errors;
  if (done.result.terrain) await store.snapshotNow(`Before Claude's suggestion #${s.number}: ${s.title}`.slice(0, 100));
  // Applied to the world as it is after the snapshot (nothing else can change in between: this runs on one thread).
  store.update(() => done.world, true, true);
  await keepTextVersions(store, done.result, `#${s.number} ${s.title}`);
  return null;
}

export function rejectInStore(store: WorldStore, id: Id, note: string) {
  store.update((w) => rejectSuggestion(w, id, note, nowIso()), false, true);
}

export function undoEntryInStore(store: WorldStore, entryId: Id): string | null {
  const r = undoLogEntry(store.world, entryId);
  if ('error' in r) return r.error;
  store.update(() => r.world, true, true);
  return null;
}

export function undoAllInStore(store: WorldStore): { undone: number; error?: string } {
  const r = undoAllDirect(store.world);
  if (r.undone) store.update(() => r.world, true, true);
  return { undone: r.undone, error: r.error };
}

const warningText = (c: ProposalCheck) => (c.newWarnings.length ? ` The app's checks flag ${c.newWarnings.length} new warning(s): ${c.newWarnings.join(' | ')}` : ' No new warnings.');

/**
 * A checked proposal from Claude (the connector's propose_changes). With direct editing on (AI-9)
 * it is applied at once; otherwise it waits in the Suggestions list (AI-3).
 */
export function proposeInStore(store: WorldStore, p: ProposalInput, check: ProposalCheck, onNew?: (s: ClaudeSuggestion) => void): string {
  const c = store.world.settings.claude;
  if (c?.directEdit && !store.readOnly) {
    const before: World = store.world;
    const done = applyProposal(before, p, 'direct', claudeOpts);
    if ('errors' in done) return `Refused: ${done.errors.join(' | ')}`;
    void store.snapshotNow(`Before Claude: ${p.title}`.slice(0, 100));
    store.update(() => done.world, true, true);
    void keepTextVersions(store, done.result, p.title);
    return `Applied directly, as direct editing is on. It is labelled as yours in the Claude activity log and Ojon can undo it.${warningText(check)}${p.asScenario ? ` It is in the new what-if scenario "${p.asScenario.name}".` : ''}`;
  }
  const { world, suggestion } = addSuggestion(store.world, p, check, claudeOpts);
  store.update(() => world, false, true);
  onNew?.(suggestion);
  const why = c?.directEdit && store.readOnly ? ' (Direct editing is on, but the app is showing the reader\'s view, where editing is off, so it was sent as a suggestion.)' : '';
  return `Sent as suggestion #${suggestion.number} "${suggestion.title}". It waits in the app's Suggestions list for Ojon to accept or reject; call the suggestions tool later to see what happened.${why}${warningText(check)}`;
}
