/**
 * AI-3, AI-7, AI-8, AI-9: Claude's proposals. A proposal is checked in full when it arrives
 * (AI-10) and refused with reasons if anything is wrong; otherwise it waits in the Suggestions list
 * with the new warnings it would cause (AI-8). Accepting applies it as one undo step; with direct
 * editing on (AI-9) it is applied at once and logged.
 */
import { CANON, ClaudeChange, ClaudeLogEntry, Id, Scenario, ClaudeSuggestion, World } from '../model';
import { newScenario, scenarioView } from '../structure';
import { checkWorld } from '../warnings';
import { ApplyOptions, ApplyResult, applyChanges, touchedRecords, undoTouched } from './apply';

export interface ProposalInput {
  title: string;
  reason?: string;
  changes: ClaudeChange[];
  /** The scenario the changes are for (default canon). */
  scenarioId?: Id;
  /** AI-7: keep it as a what-if scenario instead. */
  asScenario?: { name: string; description?: string };
}

export interface ProposalCheck {
  errors: string[];
  notes: string[];
  /** AI-8: warnings that would be new after the changes. */
  newWarnings: string[];
  result?: ApplyResult;
  /** The scenario the changes were checked in (a scratch one for an AI-7 proposal). */
  scenarioId?: Id;
}

/** Messages of open warnings in a scenario's view of the world. */
function warningSet(world: World, scenarioId: Id): Map<string, string> {
  return new Map(checkWorld(scenarioView(world, scenarioId)).filter((w) => !w.dismissed).map((w) => [w.key, w.message]));
}

/** A scratch scenario for checking an AI-7 proposal before the real one exists. */
function withScratchScenario(world: World, opts: ApplyOptions, name: string): { world: World; id: Id } {
  const now = opts.now();
  const sc: Scenario = newScenario({ id: opts.newId(), createdAt: now, updatedAt: now }, name);
  return { world: { ...world, scenarios: [...world.scenarios, sc] }, id: sc.id };
}

/** AI-10, AI-8: check a proposal without keeping it. */
export function checkProposal(world: World, p: ProposalInput, opts: ApplyOptions): ProposalCheck {
  const errors: string[] = [];
  if (!p || typeof p !== 'object') return { errors: ['The proposal must be an object.'], notes: [], newWarnings: [] };
  if (typeof p.title !== 'string' || !p.title.trim()) errors.push('Give the proposal a short title.');
  if (!Array.isArray(p.changes) || !p.changes.length) errors.push('changes must be a list with at least one change.');
  if (p.asScenario && (typeof p.asScenario.name !== 'string' || !p.asScenario.name.trim())) errors.push('asScenario needs a name.');
  if (errors.length) return { errors, notes: [], newWarnings: [] };
  let base = world;
  let sid = p.scenarioId ?? CANON;
  if (p.asScenario) ({ world: base, id: sid } = withScratchScenario(world, opts, p.asScenario.name));
  const result = applyChanges(base, sid, p.changes, opts);
  if (result.errors.length) return { errors: result.errors, notes: result.notes, newWarnings: [], result };
  const before = warningSet(base, sid);
  const after = warningSet(result.world, sid);
  const newWarnings = [...after].filter(([k]) => !before.has(k)).map(([, m]) => m);
  return { errors: [], notes: result.notes, newWarnings, result, scenarioId: sid };
}

/** Keep a checked proposal in the Suggestions list. */
export function addSuggestion(world: World, p: ProposalInput, check: ProposalCheck, opts: ApplyOptions): { world: World; suggestion: ClaudeSuggestion } {
  const number = world.suggestions.reduce((n, s) => Math.max(n, s.number), 0) + 1;
  const suggestion: ClaudeSuggestion = {
    id: opts.newId(), number, createdAt: opts.now(), title: p.title.trim(), reason: (p.reason ?? '').trim(), scenarioId: p.scenarioId ?? CANON,
    ...(p.asScenario ? { asScenario: { name: p.asScenario.name.trim(), description: (p.asScenario.description ?? '').trim() } } : {}),
    changes: p.changes, newWarnings: [...check.newWarnings, ...check.notes], state: 'open',
  };
  return { world: { ...world, suggestions: [...world.suggestions, suggestion] }, suggestion };
}

export interface Applied {
  world: World;
  entry: ClaudeLogEntry;
  result: ApplyResult;
  /** AI-7: the scenario that was made for it. */
  scenarioId: Id;
}

/**
 * Apply a proposal (all of it, or only some of its changes) to the world as it is now. A proposal
 * made against an older state of the world is checked again and refused if it no longer fits.
 */
export function applyProposal(world: World, p: ProposalInput & { id?: Id }, kind: ClaudeLogEntry['kind'], opts: ApplyOptions, only?: number[]): Applied | { errors: string[] } {
  const changes = only ? p.changes.filter((_, i) => only.includes(i)) : p.changes;
  let base = world;
  let sid = p.scenarioId ?? CANON;
  if (p.asScenario) {
    const now = opts.now();
    const sc: Scenario = { ...newScenario({ id: opts.newId(), createdAt: now, updatedAt: now }, p.asScenario.name), description: p.asScenario.description ?? '' };
    base = { ...world, scenarios: [...world.scenarios, sc] };
    sid = sc.id;
  }
  const result = applyChanges(base, sid, changes, opts);
  if (result.errors.length) return { errors: result.errors };
  const entry: ClaudeLogEntry = {
    id: opts.newId(), at: opts.now(), kind, title: p.title, suggestionId: p.id, scenarioId: sid,
    touched: touchedRecords(world, result.world), ...(result.terrain ? { terrain: true } : {}),
  };
  return { world: { ...result.world, claudeLog: [...result.world.claudeLog, entry] }, entry, result, scenarioId: sid };
}

/** AI-3: accept an open suggestion (or some of its changes). */
export function acceptSuggestion(world: World, id: Id, opts: ApplyOptions, only?: number[]): Applied | { errors: string[] } {
  const s = world.suggestions.find((x) => x.id === id);
  if (!s) return { errors: ['That suggestion is gone.'] };
  if (s.state !== 'open') return { errors: [`ClaudeSuggestion #${s.number} is already ${s.state}.`] };
  const pending = s.changes.map((_, i) => i).filter((i) => !(s.acceptedChanges ?? []).includes(i));
  const pick = only ? only.filter((i) => pending.includes(i)) : pending;
  if (!pick.length) return { errors: ['Nothing left to accept in this suggestion.'] };
  const done = applyProposal(world, { ...s, asScenario: s.acceptedChanges?.length ? undefined : s.asScenario }, 'accepted', opts, pick);
  if ('errors' in done) return done;
  const accepted = [...(s.acceptedChanges ?? []), ...pick].sort((a, b) => a - b);
  const all = accepted.length === s.changes.length;
  const suggestions = done.world.suggestions.map((x) => (x.id === id ? { ...x, acceptedChanges: all ? undefined : accepted, state: all ? 'accepted' as const : 'open' as const, resolvedAt: all ? opts.now() : undefined, scenarioId: s.asScenario ? done.scenarioId : s.scenarioId } : x));
  return { ...done, world: { ...done.world, suggestions } };
}

export function rejectSuggestion(world: World, id: Id, note: string, now: string): World {
  return { ...world, suggestions: world.suggestions.map((s) => (s.id === id && s.state === 'open' ? { ...s, state: 'rejected', note: note.trim() || undefined, resolvedAt: now } : s)) };
}

/** AI-9: undo one entry of the activity log. Terrain changes are undone through version history. */
export function undoLogEntry(world: World, entryId: Id): { world: World } | { error: string } {
  const e = world.claudeLog.find((x) => x.id === entryId);
  if (!e) return { error: 'That entry is gone.' };
  if (e.undone) return { error: 'Already undone.' };
  const r = undoTouched(world, e.touched);
  if ('error' in r) return r;
  const base = 'already' in r ? world : r.world;
  const claudeLog = base.claudeLog.map((x) => (x.id === entryId ? { ...x, undone: true } : x));
  // An undone accept puts its suggestion back to open, so it can be looked at again.
  const suggestions = e.kind === 'accepted' && e.suggestionId ? base.suggestions.map((s) => (s.id === e.suggestionId ? { ...s, state: 'open' as const, acceptedChanges: undefined, resolvedAt: undefined } : s)) : base.suggestions;
  return { world: { ...base, claudeLog, suggestions } };
}

/** AI-9: undo every change Claude made directly that is not undone yet, newest first. Stops at the first that cannot be undone. */
export function undoAllDirect(world: World): { world: World; undone: number; error?: string } {
  let w = world;
  let n = 0;
  for (const e of [...world.claudeLog].reverse()) {
    if (e.kind !== 'direct' || e.undone) continue;
    const r = undoLogEntry(w, e.id);
    if ('error' in r) return { world: w, undone: n, error: `${e.title}: ${r.error}` };
    w = r.world;
    n++;
  }
  return { world: w, undone: n };
}
